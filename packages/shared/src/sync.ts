/**
 * Offline synchronisation wire protocol.
 *
 * The guarantee we are building: a sale taken on a register with no network is
 * either (a) applied on the server exactly once, or (b) still sitting in the
 * client's outbox with a visible, actionable error. It is never dropped, and
 * never silently duplicated.
 *
 * That guarantee rests on three rules, all implemented in this file's contract
 * and enforced in `apps/server/src/modules/sync`:
 *
 *  1. The CLIENT mints the identity. Every operation carries a `clientTxnId`
 *     (UUIDv4) generated at the moment of capture, before any network call.
 *     Retries reuse that id, so replaying a batch is a no-op server-side.
 *  2. The SERVER dedupes on that id. `clientTxnId` is UNIQUE. A replayed
 *     operation returns `duplicate` with the original server id — it does not
 *     create a second sale.
 *  3. SYNC IS ATOMIC PER OPERATION, NOT PER BATCH. A batch of 20 sales where
 *     #7 conflicts must still commit #1-6 and #8-20. A single bad operation must
 *     never block a shift's worth of sales.
 */

/** Version of the sync protocol. Bumped only on breaking wire changes. */
export const SYNC_PROTOCOL_VERSION = 1;

/** Operations the POS client is allowed to originate while offline. */
export const OFFLINE_CAPABLE_OPS = [
  'SALE_CREATE',
  'SALE_UPDATE',
  'SALE_VOID',
  'SALE_REFUND',
  'CUSTOMER_CREATE',
  'CUSTOMER_UPDATE',
  'HOLD_CREATE',
  'HOLD_RELEASE',
  'PAYMENT_ADD',
  'REGISTER_CASH_DROP',
  'REGISTER_CASH_COUNT',
] as const;
export type OfflineOpType = (typeof OFFLINE_CAPABLE_OPS)[number];

export const OFFLINE_OP_SET = new Set<string>(OFFLINE_CAPABLE_OPS);

/** Lifecycle of one operation inside the client's outbox. */
export type SyncState =
  | 'pending'    // waiting in the outbox, not yet pushed
  | 'syncing'    // a push is in flight right now
  | 'synced'     // server confirmed it
  | 'duplicate'  // server already had it; safe, nothing to do
  | 'failed'     // server rejected it permanently, or retries exhausted
  | 'conflict';  // server accepted but had to reconcile state (see `note`)

export const SYNC_STATES: SyncState[] = [
  'pending', 'syncing', 'synced', 'duplicate', 'failed', 'conflict',
];

/** States that still need attention from a human. */
export const ATTENTION_STATES: SyncState[] = ['failed', 'conflict'];

/** How the server dispositioned a single pushed operation. */
export type SyncResultKind =
  | 'applied'    // committed for the first time
  | 'duplicate'  // clientTxnId already existed; original returned
  | 'conflict'   // committed, but with a reconciliation note for the operator
  | 'rejected';  // NOT committed — permanently invalid, needs operator action

export interface SyncPushItem {
  /** Minted by the client at capture time. Unique per operation, forever. */
  clientTxnId: string;
  type: OfflineOpType;
  /** Epoch millis on the client clock when the operation was captured. */
  capturedAt: number;
  /**
   * The register that captured it. Lets the server reconcile stock for a
   * branch that may not have been reachable at capture time.
   */
  registerId: string | null;
  /** Payloads are validated per-`type` on the server; see the sync validators. */
  payload: unknown;
}

export interface SyncPushRequest {
  protocolVersion: number;
  deviceId: string;
  items: SyncPushItem[];
}

export interface SyncPushItemResult {
  clientTxnId: string;
  kind: SyncResultKind;
  /** Server-assigned id of the resulting document, when one exists. */
  serverId?: string;
  /** Server document number (invoice no. / receipt no.) for UI display. */
  serverRef?: string;
  /** Human-readable explanation, always present for `conflict`/`rejected`. */
  note?: string;
  /**
   * Machine-readable rejection reason for `rejected`, so the client can decide
   * whether a retry could ever help (it never can for `rejected`, by design).
   */
  code?: string;
  /** Fields the server changed that the client should adopt (conflict merge). */
  patch?: Record<string, unknown>;
}

export interface SyncPushResponse {
  protocolVersion: number;
  serverTime: number;
  results: SyncPushItemResult[];
  /**
   * High-water mark to store as the next pull cursor. Only advances if the push
   * was accepted, so a partial failure never skips data on the subsequent pull.
   */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Pull (delta feed)
// ---------------------------------------------------------------------------

/** Entity families the server will stream deltas for. */
export const SYNC_ENTITIES = [
  'product',
  'category',
  'brand',
  'customer',
  'supplier',
  'tax',
  'warehouse',
  'stock',
  'branch',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export interface SyncPullRequest {
  protocolVersion: number;
  deviceId: string;
  /** Opaque watermark from a previous pull; `null` means "send everything". */
  cursor: string | null;
  /** Upper bound on records returned, to keep individual pull calls small. */
  limit?: number;
}

export interface SyncDelta {
  entity: SyncEntity;
  /** Upsert if `deleted` is false, tombstone if true. */
  id: string;
  /** Server `updatedAt` as epoch millis — used for conflict resolution. */
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface SyncPullResponse {
  protocolVersion: number;
  serverTime: number;
  deltas: SyncDelta[];
  /** Pass back on the next pull. `null` means you have caught up completely. */
  nextCursor: string | null;
  /** True when more records remain beyond this page. */
  hasMore: boolean;
}

/**
 * Deterministic conflict rule, applied identically on both sides.
 *
 * When the client and server both changed a record, the winner is chosen by
 * `updatedAt` (server clock), and ties are broken by the lexicographically
 * greater id — a total order, so both sides always reach the same conclusion
 * without another round trip.
 */
export function resolveConflict<T extends { id: string; updatedAt?: number | string | Date }>(
  local: T,
  remote: T,
): { winner: 'local' | 'remote'; value: T } {
  const localMs = normalizeMs(local.updatedAt);
  const remoteMs = normalizeMs(remote.updatedAt);
  if (localMs !== remoteMs) return remoteMs > localMs ? { winner: 'remote', value: remote } : { winner: 'local', value: local };
  return local.id > remote.id ? { winner: 'local', value: local } : { winner: 'remote', value: remote };
}

function normalizeMs(value: number | string | Date | undefined): number {
  if (value === undefined) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Client-side health of the sync link, surfaced prominently in the UI. */
export interface SyncStatus {
  state: 'online' | 'offline' | 'degraded';
  pending: number;
  syncing: number;
  failed: number;
  conflict: number;
  synced: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** True when the outbox is growing faster than it drains. */
  backlogged: boolean;
}

export function emptySyncStatus(): SyncStatus {
  return {
    state: 'online',
    pending: 0,
    syncing: 0,
    failed: 0,
    conflict: 0,
    synced: 0,
    lastSyncedAt: null,
    lastError: null,
    backlogged: false,
  };
}

/**
 * Retry policy for transient failures (network errors, 5xx, 429).
 *
 * Uses capped exponential backoff with jitter. `rejected` results are NOT
 * retried — they are permanent by definition, and retrying them forever would
 * hide a real problem from the operator behind an infinite spinner.
 */
export const RETRY_POLICY = {
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  maxAttempts: 12,
  /** Attempts are multiplied by this, capped at maxDelayMs. */
  factor: 2,
  /** Fraction of the delay that is randomised, to avoid thundering herds. */
  jitterRatio: 0.25,
} as const;

export function nextRetryDelayMs(attempt: number): number {
  const raw = RETRY_POLICY.baseDelayMs * RETRY_POLICY.factor ** Math.max(0, attempt - 1);
  const capped = Math.min(raw, RETRY_POLICY.maxDelayMs);
  const jitter = capped * RETRY_POLICY.jitterRatio * Math.random();
  return Math.round(capped - capped * RETRY_POLICY.jitterRatio + jitter);
}

export function shouldRetry(attempt: number): boolean {
  return attempt < RETRY_POLICY.maxAttempts;
}
