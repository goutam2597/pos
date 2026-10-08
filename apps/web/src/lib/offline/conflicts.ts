/**
 * Conflict handling.
 *
 * There are two different things people call "a conflict" in an offline POS,
 * and conflating them is how money goes missing:
 *
 *  1. A RECORD CONFLICT — the till and the server both changed the same
 *     document (a customer's phone number, a stock level). This is resolved
 *     automatically and identically on both sides by `resolveConflict()` from
 *     `@monopos/shared`: newest `updatedAt` wins, ties broken by the
 *     lexicographically greater id so the rule is a total order and both sides
 *     reach the same conclusion without another round trip. Determinism is the
 *     entire point — an ad-hoc "prefer local" is what produces two tills that
 *     disagree about a customer's address forever.
 *
 *  2. A BUSINESS CONFLICT — an offline sale applied cleanly on the server, but
 *     it landed in a stock position the server had since moved on (another till
 *     sold the last unit an hour ago). This is NOT a record conflict: the sale
 *     is real, the money is taken, the customer has a receipt. Re-applying,
 *     discarding or silently ignoring it are all wrong. The correct outcome is
 *     to KEEP the sale and leave a human-readable note for the operator to
 *     reconcile the stock afterwards.
 *
 * This module implements both, and never the second one by mutating history.
 */

import { resolveConflict, type SyncDelta, type SyncPushItemResult } from '@monopos/shared';
import { db, getMeta, setMeta, type CachedProduct, type OutboxEntry } from '../db';

/**
 * Client clocks are not trusted to be within a second of the server's, and a
 * till whose clock runs fast would otherwise win every conflict against a
 * correct remote record. We therefore compare the local stamp as if it were
 * this far ahead. This can only ever favour the SERVER, in a narrow window,
 * which is the safe direction: the server is the system of record.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Deterministic local-vs-remote decision. See the module docblock. */
export function resolveRecord<T extends { id: string; updatedAt?: number | string | Date }>(
  local: T,
  remote: T,
): { winner: 'local' | 'remote'; value: T } {
  return resolveConflict(local, remote);
}

/**
 * Decide whether a server delta supersedes the row we are holding.
 * See `CLOCK_SKEW_TOLERANCE_MS` for why the local stamp is adjusted.
 */
export function deltaWins(localUpdatedAt: number | undefined, deltaUpdatedAt: number): boolean {
  const local = { id: 'local', updatedAt: (localUpdatedAt ?? 0) + CLOCK_SKEW_TOLERANCE_MS };
  const remote = { id: 'remote', updatedAt: deltaUpdatedAt };
  return resolveConflict(local, remote).winner === 'remote';
}

// ---------------------------------------------------------------------------
// Delta -> CachedProduct
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Project a raw delta payload onto `CachedProduct`, keeping any local field the
 * delta does not carry. The server is free to add columns; a till that drops
 * unknown-to-it fields would wipe them on the next sync.
 */
export function mergeProductDelta(
  local: CachedProduct | undefined,
  delta: SyncDelta,
  linkedPendingSales: { name: string; qtyMilli: number }[] = [],
): { product: CachedProduct; note: string | null } {
  const data = delta.data ?? {};
  const base: CachedProduct = local ?? {
    id: delta.id,
    sku: null,
    barcode: null,
    name: str(data.name) ?? delta.id,
    price: 0,
    costPrice: 0,
    categoryId: null,
    categoryName: null,
    brandName: null,
    imageUrl: null,
    trackInventory: true,
    allowNegativeStock: false,
    taxRate: 0,
    qtyOnHand: 0,
    updatedAt: 0,
  };

  // A tombstone is a MARK, never a hard delete. A till that was offline when
  // the product was retired must be able to reconcile: it still holds open
  // carts and possibly unpaid holds referencing that product, and deleting the
  // row would leave those referencing nothing at all.
  if (delta.deleted || data.deleted === true) {
    return { product: { ...base, id: delta.id, deleted: true, updatedAt: delta.updatedAt }, note: null };
  }

  if (!deltaWins(local?.updatedAt, delta.updatedAt) && local && !linkedPendingSales.length) {
    // We already hold something newer than this delta. Keeping it is correct
    // and silent: a stale delta is an expected consequence of a device clock
    // running ahead, not something an operator can act on.
    return { product: local, note: null };
  }

  const remoteQty = num(data.qtyOnHand, base.qtyOnHand);
  const product: CachedProduct = {
    id: delta.id,
    sku: str(data.sku) ?? base.sku,
    barcode: str(data.barcode) ?? base.barcode,
    name: str(data.name) ?? base.name,
    price: num(data.price, base.price),
    costPrice: num(data.costPrice, base.costPrice),
    categoryId: str(data.categoryId) ?? base.categoryId,
    categoryName: str(data.categoryName) ?? base.categoryName,
    brandName: str(data.brandName) ?? base.brandName,
    imageUrl: str(data.imageUrl) ?? base.imageUrl,
    trackInventory: bool(data.trackInventory, base.trackInventory),
    allowNegativeStock: bool(data.allowNegativeStock, base.allowNegativeStock),
    taxRate: num(data.taxRate, base.taxRate),
    qtyOnHand: remoteQty,
    updatedAt: delta.updatedAt,
    deleted: false,
  };

  // Business conflict (case 2 above): the server moved this stock while we
  // still had an unsynced sale against it. The sale stays exactly as it is —
  // it is not "undone", because the customer already paid — and we leave a
  // note the operator can act on at close of day.
  let note: string | null = null;
  if (linkedPendingSales.length > 0) {
    const detail = linkedPendingSales
      .map((s) => `${s.name} x${(s.qtyMilli / 1000).toFixed(3).replace(/\.?0+$/, '')}`)
      .join(', ');
    note =
      `Stock for "${product.name}" changed on the server to ${remoteQty / 1000} while this till had ` +
      `${linkedPendingSales.length} unsynced sale line(s) against it (${detail}). The sale is unchanged and ` +
      `has been sent; stock needs recounting.`;
  }

  return { product, note };
}

// ---------------------------------------------------------------------------
// Operator-visible conflict notes
// ---------------------------------------------------------------------------

const NOTES_KEY = 'pos.conflictNotes';
const MAX_NOTES = 50;

export interface ConflictNote {
  id: string;
  at: number;
  entity: 'product' | 'sale' | 'customer' | 'other';
  entityId: string;
  entityName: string;
  message: string;
  /** The outbox entry this note belongs to, when there is one. */
  clientTxnId: string | null;
}

export async function recordConflictNote(
  note: Omit<ConflictNote, 'id' | 'at'> & { at?: number },
): Promise<ConflictNote> {
  const stored: ConflictNote = {
    id: `${note.clientTxnId ?? note.entityId}:${note.at ?? Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    at: note.at ?? Date.now(),
    entity: note.entity,
    entityId: note.entityId,
    entityName: note.entityName,
    message: note.message,
    clientTxnId: note.clientTxnId,
  };
  const existing = await getMeta<ConflictNote[]>(NOTES_KEY, []);
  await setMeta(NOTES_KEY, [stored, ...existing].slice(0, MAX_NOTES));
  return stored;
}

export async function listConflictNotes(): Promise<ConflictNote[]> {
  return getMeta<ConflictNote[]>(NOTES_KEY, []);
}

export async function clearConflictNotes(): Promise<void> {
  await setMeta(NOTES_KEY, []);
}

// ---------------------------------------------------------------------------
// Push results
// ---------------------------------------------------------------------------

/**
 * Map a server disposition onto the local outbox state.
 *
 * The important asymmetry: `conflict` means the server COMMITTED the operation
 * and merely reconciled something around it, so it is never re-queued. Only
 * `rejected` is terminal-and-not-applied. Treating a conflict as a retryable
 * failure would double-apply the sale; treating a rejection as a conflict would
 * hide a permanent problem behind a spinner.
 */
export function outboxStateForResult(result: SyncPushItemResult): OutboxEntry['state'] {
  switch (result.kind) {
    case 'applied':
      return 'synced';
    case 'duplicate':
      return 'duplicate';
    case 'conflict':
      return 'conflict';
    case 'rejected':
      return 'failed';
  }
}

/** The sale row mirrors the outbox row, with `duplicate` counting as settled. */
export function saleStateForResult(result: SyncPushItemResult): OutboxEntry['state'] {
  return result.kind === 'duplicate' ? 'synced' : outboxStateForResult(result);
}

export function describeResult(result: SyncPushItemResult): string {
  return result.note ?? result.code ?? `Server returned "${result.kind}"`;
}
