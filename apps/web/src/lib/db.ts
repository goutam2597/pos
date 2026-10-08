import Dexie, { type Table } from 'dexie';
import type { SyncState, SyncPushItem } from '@monopos/shared';

/**
 * Local persistence for the POS terminal.
 *
 * The offline requirement is not "cache the last response" — it is "keep taking
 * real sales when the network is gone". That demands a real embedded database
 * with a durable outbox, which is what IndexedDB via Dexie provides.
 *
 * WHY THE OUTBOX IS A TABLE, NOT AN ARRAY. A queued operation must survive a
 * tab crash, a browser restart and a laptop lid closing at 3am mid-shift. An
 * in-memory array loses a shift's takings; a table does not.
 *
 * WHY `clientTxnId` IS THE PRIMARY KEY. It is minted by the device at capture
 * time and never changes. That makes enqueueing naturally idempotent (the same
 * operation queued twice is one row) and makes replaying safe: pushing a row the
 * server already has returns `duplicate`, not a second sale.
 */

export interface CachedProduct {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  price: number;
  costPrice: number;
  categoryId: string | null;
  categoryName: string | null;
  brandName: string | null;
  imageUrl: string | null;
  trackInventory: boolean;
  allowNegativeStock: boolean;
  taxRate: number;
  qtyOnHand: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface CachedParty {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tier: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface CachedTax {
  id: string;
  name: string;
  rate: number;
  type: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface CachedWarehouse {
  id: string;
  name: string;
  code: string;
  branchId: string | null;
  updatedAt: number;
  deleted?: boolean;
}

/** One queued business operation awaiting acknowledgement from the server. */
export interface OutboxEntry {
  /** Client-minted UUID. Primary key, and the server's idempotency key. */
  clientTxnId: string;
  type: SyncPushItem['type'];
  /** JSON payload; shape validated server-side per operation type. */
  payload: unknown;
  /** Device wall-clock at capture, preserved through sync. */
  capturedAt: number;
  branchId: string | null;
  registerId: string | null;
  state: SyncState;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /** Server document code once known, so the till can print the right receipt. */
  serverRef: string | null;
  syncedAt: number | null;
}

/** A sale captured offline, retained for reprint and for audit. */
export interface LocalSale {
  clientTxnId: string;
  branchId: string;
  registerId: string | null;
  total: number;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  lineCount: number;
  occurredAt: number;
  cashierName: string | null;
  state: SyncState;
  serverCode: string | null;
  paymentsJson: string;
  linesJson: string;
  note: string | null;
}

export interface LocalHold {
  clientTxnId: string;
  branchId: string;
  label: string;
  payloadJson: string;
  createdAt: number;
  state: SyncState;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

class MonoPosDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  customers!: Table<CachedParty, string>;
  suppliers!: Table<CachedParty, string>;
  taxes!: Table<CachedTax, string>;
  warehouses!: Table<CachedWarehouse, string>;
  outbox!: Table<OutboxEntry, string>;
  sales!: Table<LocalSale, string>;
  holds!: Table<LocalHold, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('monopos');

    // Indexed on the fields the sync feed filters and searches by. `updatedAt`
    // is the pull cursor; without these indexes a pull would table-scan.
    this.version(1).stores({
      products: 'id, sku, barcode, name, categoryId, updatedAt, deleted',
      customers: 'id, name, phone, updatedAt, deleted',
      suppliers: 'id, name, phone, updatedAt, deleted',
      taxes: 'id, name, updatedAt, deleted',
      warehouses: 'id, branchId, code, updatedAt, deleted',
      outbox: 'clientTxnId, state, nextAttemptAt, capturedAt, [branchId+state]',
      sales: 'clientTxnId, state, occurredAt, branchId, serverCode',
      holds: 'clientTxnId, state, branchId, createdAt',
      meta: 'key',
    });
  }
}

export const db = new MonoPosDatabase();

/**
 * Stable per-device identifier.
 *
 * Generated once and kept forever: it is how the server attributes an offline
 * sale to a physical terminal, and regenerating it would orphan a device's sync
 * history. Falls back to a localStorage copy if IndexedDB is unavailable.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await db.meta.get('deviceId');
  if (existing?.value) return existing.value as string;

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  await db.meta.put({ key: 'deviceId', value: id });
  return id;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const record = await db.meta.get(key);
  return record === undefined ? fallback : (record.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function getPullCursor(): Promise<string | null> {
  return getMeta<string | null>('pullCursor', null);
}

export async function setPullCursor(cursor: string | null): Promise<void> {
  await setMeta('pullCursor', cursor);
}

/** Wipe all local data. Used by "reset till" and on sign-out. */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.products, db.customers, db.suppliers, db.taxes, db.warehouses, db.outbox, db.sales, db.holds],
    async () => {
      await Promise.all([
        db.products.clear(),
        db.customers.clear(),
        db.suppliers.clear(),
        db.taxes.clear(),
        db.warehouses.clear(),
        db.outbox.clear(),
        db.sales.clear(),
        db.holds.clear(),
      ]);
    },
  );
}

/**
 * Count of entries still needing attention, for the persistent sync banner.
 * Cheap enough to run on every outbox mutation.
 */
export async function outboxCounts(): Promise<Record<SyncState, number>> {
  const entries = await db.outbox.toArray();
  const counts: Record<SyncState, number> = {
    pending: 0,
    syncing: 0,
    synced: 0,
    duplicate: 0,
    failed: 0,
    conflict: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}
