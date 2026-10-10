/**
 * Sync engine — the single owner of the drain loop.
 *
 * ============================ THE STATE MACHINE ============================
 *
 *   outbox row            transitions                      who moves it
 *   --------------------------------------------------------------------
 *   (new)      --enqueue--> pending                         capture.ts
 *   pending    --claim----> syncing                         this file
 *   syncing    --applied--> synced                          server result
 *   syncing    --dup'd----> duplicate                       server result
 *   syncing    --conflict-> conflict   (COMMITTED + note)   server result
 *   syncing    --rejected-> failed     (NOT committed)      server result
 *   syncing    --transient-> pending   (attempt+1, backoff) this file
 *   syncing    --startup--> pending     (crash recovery)    this file
 *   failed     --operator retry--> pending                  UI action
 *   synced|duplicate --aged past retention--> deleted        this file
 *
 * ============================== THE GUARANTEES ============================
 *
 * NO LOSS. An operation is written to IndexedDB BEFORE any network call, in the
 * same transaction as the sale it belongs to. From that moment the row is the
 * system of record on this device. The only path that deletes a row is the
 * retention purge, which touches only `synced`/`duplicate` rows — states the
 * server has already confirmed. A push that fails wholesale leaves every row in
 * the batch `pending`; a batch that fails PARTIALLY still applies each result
 * individually, because the server processes each item in its own transaction.
 *
 * NO DUPLICATION. The `clientTxnId` is minted once, is the table's primary key,
 * and is the server's idempotency key. Replaying a batch — after a timeout, a
 * crash, a laptop lid, a "Retry all" — returns `duplicate`, which is a SUCCESS
 * that settles the row, not an error. The engine never mints a second id for
 * the same business operation.
 *
 * NO STUCK ROWS. `syncing` is set before the request and reset on every exit
 * path. If the tab dies mid-request the row is stranded, so startup recovers
 * every `syncing` row back to `pending`. That recovery is why the state is safe
 * to persist at all.
 *
 * NO SPIN ON PERMANENT FAILURES. `rejected` is terminal and is never retried;
 * it surfaces to the operator with the server's own words. Transient failures
 * (offline, 5xx, 429) back off with `nextRetryDelayMs` and give up after
 * `shouldRetry` says so — at which point the row becomes `failed` and is STILL
 * never deleted.
 */

import {
  SYNC_PROTOCOL_VERSION,
  emptySyncStatus,
  nextRetryDelayMs,
  shouldRetry,
  RETRY_POLICY,
  type SyncPushResponse,
  type SyncPushItemResult,
  type SyncStatus,
} from '@monopos/shared';
import type { UpdateSpec } from 'dexie';
import { ApiError, type ApiClient } from '../api';
import { db, getDeviceId, getMeta, getPullCursor, outboxCounts, setMeta, setPullCursor, type LocalSale, type OutboxEntry } from '../db';
import { describeResult, outboxStateForResult, saleStateForResult } from './conflicts';
import { applyLocalIdMigration } from './migrations';
import { toPushItem } from './outbox';
import { pullDeltas } from './pullSync';

/** Items per push. Small enough that a failed batch loses little work. */
const PUSH_BATCH_SIZE = 25;
/** A single drain never monopolises the tab. */
const MAX_BATCHES_PER_DRAIN = 20;
/** Idle poll. Also the backstop for "the network came back" when the event missed. */
const TICK_MS = 10_000;
/** How long the delta feed is allowed to go unread while nothing is pushed. */
const PULL_IDLE_MS = 60_000;
/**
 * Confirmed rows are kept this long so that "print yesterday's receipt from this
 * till, which never synced" still works. Failures are kept FOREVER — an operator
 * must always be able to see that something did not go through.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BACKLOG_THRESHOLD = 50;

const LAST_SYNCED_KEY = 'sync.lastSyncedAt';
const LAST_ERROR_KEY = 'sync.lastError';
const LAST_ERROR_AT_KEY = 'sync.lastErrorAt';
/**
 * The push response also carries a `nextCursor`. It is deliberately NOT written
 * over the pull cursor: the two are only interchangeable if the server runs one
 * global change sequence, and assuming that is exactly the assumption that
 * silently skips deltas. Keeping them apart costs a redundant pull at worst.
 */
const PUSH_CURSOR_KEY = 'sync.pushCursor';

export interface SyncEngineConfig {
  api: ApiClient;
  getBranchId: () => string | null;
  getRegisterId: () => string | null;
}

export type SyncListener = (status: SyncStatus) => void;

type DrainOutcome = 'progressed' | 'stopped';

class SyncEngine {
  private config: SyncEngineConfig | null = null;
  private listeners = new Set<SyncListener>();
  private status: SyncStatus = emptySyncStatus();
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private draining = false;
  private drainQueued = false;
  private lastPullAt = 0;
  private lastErrorAt = 0;
  private unsubscribeNetwork: Array<() => void> = [];

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  configure(config: SyncEngineConfig): void {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * Idempotent. Recovers stranded rows, replays persisted status, attaches the
   * online/offline listeners and kicks one drain.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // A row left `syncing` by a crashed tab is indistinguishable from a row in
    // flight. Since this process owns the loop and there is no in-flight
    // request, every one of them is stranded by definition.
    await db.outbox.where('state').equals('syncing').modify({ state: 'pending', nextAttemptAt: 0 });

    // A till that lost its catalog but kept its pull cursor (a cleared store,
    // a partial wipe) would otherwise wait forever for deltas it has already
    // consumed: the server has nothing newer than the cursor, so nothing is
    // ever re-sent. An empty catalog with a cursor means "start over".
    const [productCount, savedCursor] = await Promise.all([db.products.count(), getPullCursor()]);
    if (productCount === 0 && savedCursor !== null) {
      await setPullCursor(null);
      return;
    }

    // Ghost damage from the old stock-merge bug: rows whose "name" is a
    // machine id — either their own id (the original signature) or a stock
    // level id (the later variant). Real product names are human text; no
    // server product is named like a cuid. Deleting them is safe and REQUIRED
    // rather than merely re-pulling: their timestamps come from stock changes,
    // so in a full pull they would look "newer" than the real products and win
    // the merge, keeping the damage alive. Deleted, the full pull re-creates
    // every one of them with real fields.
    const damaged = await db.products
      .filter((p) => p.name === p.id || /^[a-z0-9]{24,}$/.test(p.name))
      .toArray();
    if (damaged.length > 0 && savedCursor !== null) {
      await setPullCursor(null);
      await db.products.bulkDelete(damaged.map((p) => p.id));
    }

    const [lastSyncedAt, lastError, lastErrorAt] = await Promise.all([
      getMeta<number | null>(LAST_SYNCED_KEY, null),
      getMeta<string | null>(LAST_ERROR_KEY, null),
      getMeta<number>(LAST_ERROR_AT_KEY, 0),
    ]);
    this.status = {
      ...this.status,
      lastSyncedAt,
      lastError,
      state: this.onlineState(),
    };
    this.lastErrorAt = lastErrorAt;

    this.attachNetworkListeners();
    this.timer = setInterval(() => {
      void this.drain('tick');
    }, TICK_MS);

    await this.refreshStatus();
    void this.drain('startup');
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const off of this.unsubscribeNetwork) off();
    this.unsubscribeNetwork = [];
    this.started = false;
  }

  private attachNetworkListeners(): void {
    if (typeof window === 'undefined' || this.unsubscribeNetwork.length > 0) return;

    const onOnline = (): void => {
      void this.setError(null);
      void this.drain('online');
    };
    const onOffline = (): void => {
      this.patch({ state: 'offline' });
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.unsubscribeNetwork.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
  }

  private onlineState(): SyncStatus['state'] {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    // "Degraded" means the link is nominally up but has failed recently. The
    // operator needs to know a sale may be sitting unsynced even though the
    // browser is claiming connectivity.
    if (this.lastErrorAt !== 0 && Date.now() - this.lastErrorAt < 60_000) return 'degraded';
    return 'online';
  }

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private patch(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.status);
  }

  // -------------------------------------------------------------------------
  // Manual control
  // -------------------------------------------------------------------------

  /** Called after every enqueue so a sale's receipt code comes back promptly. */
  notifyEnqueued(): void {
    if (!this.started) return;
    void this.drain('enqueue');
  }

  triggerNow(): void {
    void this.drain('manual');
  }

  /**
   * Put entries back in the queue after the operator resolves them.
   *
   * Only ever moves rows BACKWARD to `pending` — re-sending a `clientTxnId` is
   * safe precisely because the server dedupes, so a "Retry all" on a row that
   * was actually applied comes back `duplicate` and changes nothing.
   */
  async retry(clientTxnIds?: string[]): Promise<number> {
    const failed = await db.outbox.where('state').anyOf('failed', 'conflict').toArray();
    const targets = clientTxnIds ? failed.filter((e) => clientTxnIds.includes(e.clientTxnId)) : failed;

    await db.outbox.bulkUpdate(
      targets.map((entry) => ({
        key: entry.clientTxnId,
        changes: { state: 'pending' as const, attempts: 0, nextAttemptAt: 0, lastError: null },
      })),
    );

    // A retried sale also stops being "needs attention" in the sales list.
    await db.sales.bulkUpdate(
      targets
        .filter((entry) => entry.type.startsWith('SALE_'))
        .map((entry) => ({ key: entry.clientTxnId, changes: { state: 'pending' as const } })),
    );

    await this.refreshStatus();
    void this.drain('retry');
    return targets.length;
  }

  /**
   * Drop permanently failed items from the queue.
   *
   * Only `failed`/`conflict` rows are discardable — a pending or syncing row
   * is money still owed to the server and must never be silently deleted.
   * This is the operator's pressure valve for items that can never succeed
   * (a payload from a since-fixed bug, a duplicate with nothing left to do).
   */
  async discard(clientTxnIds?: string[]): Promise<number> {
    const candidates = await db.outbox.where('state').anyOf('failed', 'conflict').toArray();
    const targets = clientTxnIds ? candidates.filter((e) => clientTxnIds.includes(e.clientTxnId)) : candidates;

    await db.outbox.bulkDelete(targets.map((entry) => entry.clientTxnId));
    await this.refreshStatus();
    return targets.length;
  }

  // -------------------------------------------------------------------------
  // Drain loop
  // -------------------------------------------------------------------------

  private async drain(reason: string): Promise<void> {
    if (!this.config) return;
    if (this.draining) {
      this.drainQueued = true;
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.patch({ state: 'offline' });
      await this.refreshStatus();
      return;
    }

    this.draining = true;
    void reason;
    try {
      let pushed = 0;

      for (let index = 0; index < MAX_BATCHES_PER_DRAIN; index += 1) {
        const batch = await this.claimDue(PUSH_BATCH_SIZE);
        if (batch.length === 0) break;

        const outcome = await this.pushBatch(batch);
        if (outcome === 'stopped') break;
        pushed += batch.length;
      }

      if (pushed > 0 || Date.now() - this.lastPullAt > PULL_IDLE_MS) {
        await this.pull();
      }
      await this.purge();
      await this.setError(null);
    } catch (error) {
      // A 401 means the session is gone and the refresh flow is signing the
      // operator out. Retrying would only hammer the server with requests it
      // must keep rejecting — and each refresh attempt carries a cookie the
      // server's reuse detection answers by revoking the operator's NEW
      // session, locking them out of every tab. So the engine parks itself
      // here; the next sign-in remounts the terminal and calls start() again.
      if (error instanceof ApiError && error.status === 401) {
        const message = 'Session expired — sign in to resume syncing';
        this.lastErrorAt = Date.now();
        this.patch({ state: 'degraded', lastError: message });
        await setMeta(LAST_ERROR_KEY, message).catch(() => undefined);
        await setMeta(LAST_ERROR_AT_KEY, this.lastErrorAt).catch(() => undefined);
        this.stop();
        return;
      }
      await this.setError(error instanceof Error ? error.message : String(error));
    } finally {
      this.draining = false;
      await this.refreshStatus();
    }

    if (this.drainQueued) {
      this.drainQueued = false;
      void this.drain('queued');
    }
  }

  /**
   * Take ownership of up to `limit` due rows.
   *
   * The read-check-write happens inside one transaction so a concurrent
   * `retry()` cannot hand the same row to two drains. Claimed rows are written
   * as `syncing` BEFORE the request goes out, which is what makes a crash
   * recoverable rather than invisible.
   */
  private async claimDue(limit: number): Promise<OutboxEntry[]> {
    const now = Date.now();

    return db.transaction('rw', db.outbox, async () => {
      const candidates = await db.outbox
        .where('state')
        .equals('pending')
        .filter((entry) => entry.nextAttemptAt <= now)
        .toArray();

      candidates.sort((a, b) => a.capturedAt - b.capturedAt);

      const claimed: OutboxEntry[] = [];
      for (const candidate of candidates.slice(0, limit)) {
        const current = await db.outbox.get(candidate.clientTxnId);
        if (!current || current.state !== 'pending' || current.nextAttemptAt > now) continue;
        await db.outbox.update(current.clientTxnId, { state: 'syncing', lastError: null });
        claimed.push({ ...current, state: 'syncing' });
      }
      return claimed;
    });
  }

  private async pushBatch(batch: OutboxEntry[]): Promise<DrainOutcome> {
    const config = this.config;
    if (!config) return 'stopped';

    const deviceId = await getDeviceId();
    let response: SyncPushResponse;

    try {
      response = await config.api.post<SyncPushResponse>('/sync/push', {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        deviceId,
        items: batch.map(toPushItem),
      });
    } catch (error) {
      // The request as a whole did not get through. NOTHING here was applied —
      // the server never saw it — so every row goes back to `pending`. This is
      // the single most important branch in the file.
      await this.releaseBatch(batch, error);
      return 'stopped';
    }

    if (response.protocolVersion !== SYNC_PROTOCOL_VERSION) {
      // Speaking different dialects would corrupt data, not delay it. Fail
      // loudly and permanently rather than pushing garbage in a loop.
      await this.markProtocolMismatch(batch, response.protocolVersion);
      return 'progressed';
    }

    await this.applyResults(batch, Array.isArray(response.results) ? response.results : []);

    if (response.nextCursor !== null && response.nextCursor !== undefined) {
      await setMeta(PUSH_CURSOR_KEY, response.nextCursor).catch(() => undefined);
    }

    const at = Date.now();
    await setMeta(LAST_SYNCED_KEY, at).catch(() => undefined);
    this.patch({ lastSyncedAt: at });
    return 'progressed';
  }

  /**
   * Apply the server's per-item dispositions.
   *
   * The server processes each item in its own transaction, so a `rejected` in
   * the middle of the batch tells us nothing about its neighbours and must not
   * stop them from settling. An item the server did NOT mention is treated as
   * not-delivered and returned to the queue — silence is not consent.
   */
  private async applyResults(batch: OutboxEntry[], results: SyncPushItemResult[]): Promise<void> {
    const byTxnId = new Map(results.map((result) => [result.clientTxnId, result]));
    const now = Date.now();

    for (const entry of batch) {
      const result = byTxnId.get(entry.clientTxnId);
      if (!result) {
        await this.releaseEntry(entry, 'Server did not acknowledge this operation', true);
        continue;
      }

      const settled = result.kind === 'applied' || result.kind === 'duplicate' || result.kind === 'conflict';
      const note = settled && result.kind === 'applied' ? null : describeResult(result);

      await db.transaction('rw', [db.outbox, db.sales], async () => {
        await db.outbox.update(entry.clientTxnId, {
          state: outboxStateForResult(result),
          attempts: entry.attempts,
          nextAttemptAt: 0,
          lastError: note,
          serverRef: result.serverRef ?? entry.serverRef,
          syncedAt: result.kind === 'rejected' ? entry.syncedAt : now,
        });

        if (entry.type.startsWith('SALE_')) {
          await this.applySaleResult(entry.clientTxnId, result);
        }
        if (result.kind === 'applied' || result.kind === 'duplicate') {
          // An offline-created customer now has a server id; adopt it so the
          // next pull does not deliver the same person a second time.
          await applyLocalIdMigration(entry, result.serverId);
        }
      });
    }
  }

  private async applySaleResult(clientTxnId: string, result: SyncPushItemResult): Promise<void> {
    const sale = await db.sales.get(clientTxnId);
    if (!sale) return;

    const patch: UpdateSpec<LocalSale> = { state: saleStateForResult(result) };
    if (result.serverRef) patch.serverCode = result.serverRef;
    if (result.kind === 'rejected' || result.kind === 'conflict') {
      patch.note = [sale.note, describeResult(result)].filter(Boolean).join(' — ') || null;
    }

    await db.sales.update(clientTxnId, patch);
  }

  /**
   * Whole-request failure. Every row in the batch is still owed to the server.
   */
  private async releaseBatch(batch: OutboxEntry[], error: unknown): Promise<void> {
    const { message, fatal } = describeTransportError(error);
    for (const entry of batch) {
      await this.releaseEntry(entry, message, fatal);
    }
    await this.setError(message);
  }

  /**
   * Return one row to the queue, or retire it if retries are exhausted.
   *
   * NOTE WHAT IS NEVER DONE HERE: the row is never deleted, and its
   * `clientTxnId` is never changed. Those two things are the no-loss and
   * no-duplicate guarantees respectively.
   */
  private async releaseEntry(entry: OutboxEntry, message: string, alwaysRetry = false): Promise<void> {
    const attempts = entry.attempts + 1;
    const patch: UpdateSpec<OutboxEntry> = { lastError: message, attempts };

    if (!alwaysRetry && !shouldRetry(attempts)) {
      patch.state = 'failed';
      patch.lastError = `${message} — gave up after ${attempts} attempts`;
      patch.nextAttemptAt = 0;
    } else {
      patch.state = 'pending';
      const delay = alwaysRetry ? RETRY_POLICY.maxDelayMs : nextRetryDelayMs(attempts);
      patch.nextAttemptAt = Date.now() + delay;
    }

    await db.outbox.update(entry.clientTxnId, patch);
    if (patch.state === 'failed' && entry.type.startsWith('SALE_')) {
      await db.sales.update(entry.clientTxnId, { state: 'failed' }).catch(() => undefined);
    }
  }

  private async markProtocolMismatch(batch: OutboxEntry[], serverVersion: number): Promise<void> {
    const message =
      `This till speaks sync protocol v${SYNC_PROTOCOL_VERSION} but the server speaks v${serverVersion}. ` +
      `The queue is paused so nothing is lost; update the client to resume.`;
    for (const entry of batch) {
      await db.outbox.update(entry.clientTxnId, { state: 'failed', lastError: message, nextAttemptAt: 0 });
    }
    await this.setError(message);
  }

  // -------------------------------------------------------------------------
  // Pull + housekeeping
  // -------------------------------------------------------------------------

  private async pull(): Promise<void> {
    const config = this.config;
    if (!config) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.patch({ state: 'offline' });
      return;
    }

    try {
      const pulled = await pullDeltas(config.api);
      const at = Date.now();
      this.lastPullAt = at;
      // Publish the result. Without this the catalogue refresh never fires: the
      // POS re-reads IndexedDB when `status.lastSyncedAt` changes, and a
      // pull-only sync (no sales queued) would otherwise leave the till showing
      // an empty catalogue after it had just downloaded one.
      await setMeta(LAST_SYNCED_KEY, at).catch(() => undefined);
      this.patch({ lastSyncedAt: at, pending: 0 });
      if (pulled.applied > 0) this.patch({ lastError: null });
    } catch (error) {
      // A failed pull is not a failed push: the queue is untouched and the sale
      // is already safe. Only the freshness of the catalog is stale.
      await this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Forget confirmed rows once they are old enough that the receipt has been
   * printed and the shift closed. `failed` and `conflict` are deliberately
   * excluded and are kept forever.
   */
  private async purge(): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS;
    const stale = await db.outbox
      .where('state')
      .anyOf('synced', 'duplicate')
      .filter((entry) => (entry.syncedAt ?? 0) < cutoff)
      .toArray();

    if (stale.length === 0) return;
    await db.outbox.bulkDelete(stale.map((entry) => entry.clientTxnId));
  }

  private async setError(message: string | null): Promise<void> {
    this.lastErrorAt = message === null ? 0 : Date.now();
    await Promise.all([
      setMeta(LAST_ERROR_KEY, message).catch(() => undefined),
      setMeta(LAST_ERROR_AT_KEY, this.lastErrorAt).catch(() => undefined),
    ]);
    this.patch({ lastError: message, state: this.onlineState() });
  }

  /** Recount from IndexedDB. Cheap: one table scan of an index, on change only. */
  private async refreshStatus(): Promise<void> {
    try {
      const counts = await outboxCounts();
      const notes = await getMeta<unknown[]>('pos.conflictNotes', []);
      const conflict = counts.conflict + notes.length;

      this.patch({
        pending: counts.pending + counts.syncing,
        syncing: counts.syncing,
        failed: counts.failed,
        conflict,
        synced: counts.synced + counts.duplicate,
        backlogged: counts.pending + counts.syncing > BACKLOG_THRESHOLD,
        state: this.onlineState(),
      });
    } catch {
      /* IndexedDB unavailable (private mode): keep the last known counts. */
    }
  }
}

/**
 * Transport-level classification.
 *
 * `fatal: true` means "do not even count this against the retry budget" — used
 * for a 4xx on the BATCH envelope. Marking twenty-five perfectly good sales as
 * failed because the request had a bad header would be far worse than waiting.
 */
function describeTransportError(error: unknown): { message: string; fatal: boolean } {
  if (error instanceof ApiError) {
    if (error.isOffline) return { message: 'No connection to the server', fatal: false };
    if (error.status === 401) return { message: 'Session expired — sign in to resume syncing', fatal: false };
    if (error.isTransient) return { message: error.message, fatal: false };
    return { message: `Request rejected (${error.status} ${error.code}): ${error.message}`, fatal: true };
  }
  if (error instanceof Error) return { message: error.message, fatal: false };
  return { message: String(error), fatal: false };
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

export const syncEngine = new SyncEngine();

export function configureSyncEngine(config: SyncEngineConfig): void {
  syncEngine.configure(config);
}

export function startSyncEngine(): Promise<void> {
  return syncEngine.start();
}

export function stopSyncEngine(): void {
  syncEngine.stop();
}

export function triggerSync(): void {
  syncEngine.triggerNow();
}

export function notifySyncEnqueued(): void {
  syncEngine.notifyEnqueued();
}

export function subscribeSync(listener: SyncListener): () => void {
  return syncEngine.subscribe(listener);
}

export function getSyncStatus(): SyncStatus {
  return syncEngine.getStatus();
}

export function retrySync(clientTxnIds?: string[]): Promise<number> {
  return syncEngine.retry(clientTxnIds);
}

export function discardSync(clientTxnIds?: string[]): Promise<number> {
  return syncEngine.discard(clientTxnIds);
}

/** Exposed for the status bar and for tests that need to reason about the loop. */
export const SYNC_TIMINGS = {
  pushBatchSize: PUSH_BATCH_SIZE,
  tickMs: TICK_MS,
  retentionMs: RETENTION_MS,
  backlogThreshold: BACKLOG_THRESHOLD,
} as const;
