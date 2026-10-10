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
 * Repair legacy SALE_CREATE payloads stored by the till bug that wrote the
 * cart-discount PICKER STATE ({type, value}) where the wire expects the
 * computed amount. Recomputing from the stored lines lets an already-failed
 * outbox row sync after the fix, instead of being stuck rejected forever.
 */
function normalizeSalePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;
  const discount = p.cartDiscount;
  if (discount === null || typeof discount !== 'object') return payload;

  const { type = 'NONE', value = 0 } = discount as { type?: string; value?: number };
  const gross = Array.isArray(p.lines)
    ? (p.lines as Array<{ qtyMilli?: unknown; unitPrice?: unknown }>).reduce(
        (sum, line) => sum + Math.round((Number(line.qtyMilli) || 0) * (Number(line.unitPrice) || 0) / 1000),
        0,
      )
    : 0;

  let amount = 0;
  if (type === 'FIXED') amount = Number(value) || 0;
  else if (type === 'PERCENT') amount = Math.round((gross * (Number(value) || 0)) / 10000); // value is basis points
  p.cartDiscount = Math.max(0, Math.min(amount, gross));
  return payload;
}

/** Repair legacy HOLD payloads stored under the pre-fix key names. */
function normalizeHoldPayload(type: string, payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;
  if (type === 'HOLD_CREATE' && p.payload === undefined && p.cart !== undefined) {
    p.payload = p.cart;
    delete p.cart;
  }
  if (type === 'HOLD_RELEASE' && p.holdId === undefined && p.holdClientTxnId !== undefined) {
    p.holdId = p.holdClientTxnId;
    delete p.holdClientTxnId;
  }
  return payload;
}

/**
 * Shape an outbox row for the wire.
 *
 * The payload is passed through untouched apart from the legacy repairs above:
 * it was validated by the server when a previous attempt arrived, and
 * re-shaping it here would be a second, weaker copy of the server's schema.
 * `payload` is `unknown` in the contract, and this function does not pretend
 * otherwise.
 */
export function toPushItem(entry: OutboxEntry): SyncPushItem {
  let payload = entry.payload;
  if (entry.type === 'SALE_CREATE') payload = normalizeSalePayload(payload);
  if (entry.type === 'HOLD_CREATE' || entry.type === 'HOLD_RELEASE') payload = normalizeHoldPayload(entry.type, payload);
  return {
    clientTxnId: entry.clientTxnId,
    type: entry.type,
    capturedAt: entry.capturedAt,
    registerId: entry.registerId,
    payload,
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
