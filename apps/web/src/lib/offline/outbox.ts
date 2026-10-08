/**
 * Outbox — the write side of the no-loss guarantee.
 *
 * Every business operation the till performs goes through `enqueue` BEFORE any
 * network call. That single rule is what removes the whole class of bug where a
 * sale exists on the server but not on the till (or worse, exists on neither,
 * because the tab closed between "user pressed Charge" and "fetch resolved").
 *
 * The identity of an operation is the `clientTxnId`, minted here at capture
 * time and never regenerated. Because it is the table's primary key, enqueueing
 * twice is a no-op rather than a duplicate sale, and because it is the server's
 * idempotency key, retrying forever is safe.
 */

import type { OfflineOpType, SyncPushItem } from '@monopos/shared';
import { db, type OutboxEntry } from '../db';

export interface EnqueueContext {
  branchId: string;
  registerId?: string | null;
  /** Overridable for deterministic tests; defaults to the device clock. */
  capturedAt?: number;
}

/**
 * UUIDv4 where available. The id is minted on the client and is the only thing
 * standing between a flaky network and a duplicate sale, so it is generated
 * before anything can fail — never derived from the payload, never from a
 * counter that a `clearLocalData()` would reset.
 */
export function mintClientTxnId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts where `randomUUID` is unavailable.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function newEntry(
  clientTxnId: string,
  type: OfflineOpType,
  payload: unknown,
  context: EnqueueContext,
): OutboxEntry {
  return {
    clientTxnId,
    type,
    payload,
    capturedAt: context.capturedAt ?? Date.now(),
    branchId: context.branchId,
    registerId: context.registerId ?? null,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    serverRef: null,
    syncedAt: null,
  };
}

/**
 * Write one operation. Idempotent: an id already present is returned untouched.
 *
 * Callers that must also write elsewhere (a sale row, a hold row) should use
 * `enqueueWithId` inside their own `db.transaction` so both halves commit or
 * neither does.
 */
export async function enqueue(
  type: OfflineOpType,
  payload: unknown,
  context: EnqueueContext,
  clientTxnId: string = mintClientTxnId(),
): Promise<OutboxEntry> {
  return enqueueWithId(clientTxnId, type, payload, context);
}

/** Enqueue under an id the caller already minted (a sale uses one id for both rows). */
export async function enqueueWithId(
  clientTxnId: string,
  type: OfflineOpType,
  payload: unknown,
  context: EnqueueContext,
): Promise<OutboxEntry> {
  return db.transaction('rw', db.outbox, async () => {
    const existing = await db.outbox.get(clientTxnId);
    if (existing) return existing;
    const entry = newEntry(clientTxnId, type, payload, context);
    await db.outbox.add(entry);
    return entry;
  });
}

/**
 * Shape an outbox row for the wire.
 *
 * The payload is passed through untouched: it was validated by the server when
 * a previous attempt arrived, and re-shaping it here would be a second, weaker
 * copy of the server's schema. `payload` is `unknown` in the contract, and this
 * function does not pretend otherwise.
 */
export function toPushItem(entry: OutboxEntry): SyncPushItem {
  return {
    clientTxnId: entry.clientTxnId,
    type: entry.type,
    capturedAt: entry.capturedAt,
    registerId: entry.registerId,
    payload: entry.payload,
  };
}

/** Entries a human needs to look at. Ordered oldest first. */
export async function listAttentionEntries(): Promise<OutboxEntry[]> {
  const entries = await db.outbox.where('state').anyOf('failed', 'conflict').toArray();
  return entries.sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Entries still owed to the server, oldest first — FIFO keeps sale numbering sane. */
export async function listPendingEntries(): Promise<OutboxEntry[]> {
  const entries = await db.outbox.where('state').anyOf('pending', 'syncing').toArray();
  return entries.sort((a, b) => a.capturedAt - b.capturedAt);
}
