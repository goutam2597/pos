/**
 * Pull — delta ingestion from the server into IndexedDB.
 *
 * The pull is how an offline till learns what it missed: price changes, new
 * products, stock movements from other tills, customers created at the back
 * office. It runs after a successful push and on a slow timer when there is
 * nothing to push.
 *
 * TWO RULES THAT PREVENT DATA LOSS:
 *
 *  1. THE CURSOR IS ADVANCED ONLY AFTER THE BATCH IS FULLY WRITTEN. If the tab
 *     dies between "received deltas" and "wrote deltas", the next pull re-fetches
 *     the same page. Re-fetching is free; skipping a page means the till shows
 *     a stock level that never existed.
 *
 *  2. `deleted` IS A TOMBSTONE, NOT A `remove()`. A till that was offline while
 *     a product was retired must keep the row so that open carts, held sales and
 *     unsynced sale lines referencing it can still be reconciled and explained
 *     to the operator. Hard-deleting turns a recoverable situation into an
 *     inexplicable one.
 */

import {
  SYNC_PROTOCOL_VERSION,
  type SyncDelta,
  type SyncEntity,
  type SyncPullResponse,
} from '@monopos/shared';
import type { ApiClient } from '../api';
import { db, getDeviceId, getMeta, getPullCursor, setMeta, setPullCursor, type CachedParty, type CachedProduct, type CachedTax, type CachedWarehouse } from '../db';
import { mergeProductDelta, recordConflictNote } from './conflicts';

export const PULL_PAGE_SIZE = 200;
/** Hard stop so a server that never stops reporting `hasMore` cannot spin forever. */
const MAX_PAGES = 25;

const CATEGORY_NAMES_KEY = 'sync.categoryNames';
const BRAND_NAMES_KEY = 'sync.brandNames';
const BRANCHES_KEY = 'sync.branches';

export interface PullSummary {
  applied: number;
  pages: number;
  caughtUp: boolean;
}

export interface PullOptions {
  limit?: number;
  maxPages?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function projectParty(id: string, data: Record<string, unknown> | null, updatedAt: number, deleted: boolean): CachedParty {
  return {
    id,
    name: typeof data?.name === 'string' ? data.name : id,
    phone: typeof data?.phone === 'string' ? data.phone : null,
    email: typeof data?.email === 'string' ? data.email : null,
    tier: typeof data?.tier === 'string' ? data.tier : 'RETAIL',
    updatedAt,
    deleted,
  };
}

function projectTax(id: string, data: Record<string, unknown> | null, updatedAt: number, deleted: boolean): CachedTax {
  return {
    id,
    name: typeof data?.name === 'string' ? data.name : id,
    rate: typeof data?.rate === 'number' ? data.rate : 0,
    type: typeof data?.type === 'string' ? data.type : 'PERCENTAGE',
    updatedAt,
    deleted,
  };
}

function projectWarehouse(id: string, data: Record<string, unknown> | null, updatedAt: number, deleted: boolean): CachedWarehouse {
  return {
    id,
    name: typeof data?.name === 'string' ? data.name : id,
    code: typeof data?.code === 'string' ? data.code : '',
    branchId: typeof data?.branchId === 'string' ? data.branchId : null,
    updatedAt,
    deleted,
  };
}

/**
 * Unsynced sale lines per product, used to detect the business conflict where
 * the server moved stock that this till has already sold but not yet sent.
 * Computed once per pull rather than per delta.
 */
async function pendingSaleIndex(): Promise<Map<string, { name: string; qtyMilli: number; clientTxnId: string }[]>> {
  const index = new Map<string, { name: string; qtyMilli: number; clientTxnId: string }[]>();
  const pending = await db.outbox.where('state').anyOf('pending', 'syncing').toArray();

  for (const entry of pending) {
    if (entry.type !== 'SALE_CREATE') continue;
    const payload = entry.payload;
    if (!isRecord(payload) || !Array.isArray(payload.lines)) continue;

    for (const raw of payload.lines) {
      if (!isRecord(raw)) continue;
      const productId = typeof raw.productId === 'string' ? raw.productId : null;
      if (!productId) continue;
      const name = typeof raw.name === 'string' ? raw.name : productId;
      const qtyMilli = typeof raw.qtyMilli === 'number' ? raw.qtyMilli : 0;
      const bucket = index.get(productId);
      if (bucket) bucket.push({ name, qtyMilli, clientTxnId: entry.clientTxnId });
      else index.set(productId, [{ name, qtyMilli, clientTxnId: entry.clientTxnId }]);
    }
  }
  return index;
}

/**
 * Write one page of deltas. All tables commit in a single Dexie transaction, so
 * a crash mid-page leaves the cursor pointing at the previous page.
 */
export async function applyDeltas(deltas: SyncDelta[]): Promise<number> {
  if (deltas.length === 0) return 0;
  const index = await pendingSaleIndex();

  const productIds = deltas.filter((d) => d.entity === 'product' || d.entity === 'stock').map((d) => d.id);
  const existingProducts = new Map(
    (await db.products.bulkGet(productIds)).flatMap((p) => (p ? [[p.id, p] as const] : [])),
  );

  // Keyed by product id, NOT a list. A single page routinely carries BOTH a
  // `product` delta and a `stock` delta for the same item, and both are applied
  // through `applyProduct`. Pushing both into one `bulkPut` duplicates the row
  // (Dexie does not merge duplicate keys within a single call), which shows up
  // as every product appearing twice on the till.
  const productPuts = new Map<string, CachedProduct>();
  const customerPuts: CachedParty[] = [];
  const supplierPuts: CachedParty[] = [];
  const taxPuts: CachedTax[] = [];
  const warehousePuts: CachedWarehouse[] = [];
  const categoryNames = new Map(Object.entries(await getMeta<Record<string, string>>(CATEGORY_NAMES_KEY, {})));
  const brandNames = new Map(Object.entries(await getMeta<Record<string, string>>(BRAND_NAMES_KEY, {})));
  const branches = new Map(Object.entries(await getMeta<Record<string, { id: string; name: string; code: string }>>(BRANCHES_KEY, {})));

  const applyProduct = (delta: SyncDelta): void => {
    const productId = delta.entity === 'stock' && delta.data && typeof delta.data.productId === 'string'
      ? delta.data.productId
      : delta.id;

    // Merge onto whatever this page has already staged for this product, so a
    // product delta followed by a stock delta composes instead of overwriting.
    const local = productPuts.get(productId) ?? existingProducts.get(productId);
    const linked = index.get(productId) ?? [];
    const { product, note } = mergeProductDelta(local, delta, linked);
    productPuts.set(productId, product);

    if (note && local) {
      void recordConflictNote({
        entity: 'product',
        entityId: productId,
        entityName: product.name,
        message: note,
        clientTxnId: linked[0]?.clientTxnId ?? null,
      }).catch(() => undefined);
    }
  };

  // Name-only lookups first. A product and its category frequently share an
  // `updatedAt`, so whichever order they arrive in determines whether the
  // product gets "Groceries" or a raw cuid. Resolving labels first makes the
  // projection order-independent.
  for (const delta of deltas) {
    switch (delta.entity) {
      case 'category':
        if (delta.deleted) categoryNames.delete(delta.id);
        else categoryNames.set(delta.id, (delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id));
        break;
      case 'brand':
        if (delta.deleted) brandNames.delete(delta.id);
        else brandNames.set(delta.id, (delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id));
        break;
      case 'branch':
        if (delta.deleted) branches.delete(delta.id);
        else {
          branches.set(delta.id, {
            id: delta.id,
            name: delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id,
            code: delta.data && typeof delta.data.code === 'string' ? delta.data.code : '',
          });
        }
        break;
    }
  }

  for (const delta of deltas) {
    const entity: SyncEntity = delta.entity;
    switch (entity) {
      case 'product':
      case 'stock':
        applyProduct(delta);
        break;
      case 'customer':
        customerPuts.push(projectParty(delta.id, delta.data, delta.updatedAt, delta.deleted));
        break;
      case 'supplier':
        supplierPuts.push(projectParty(delta.id, delta.data, delta.updatedAt, delta.deleted));
        break;
      case 'tax':
        taxPuts.push(projectTax(delta.id, delta.data, delta.updatedAt, delta.deleted));
        break;
      case 'warehouse':
        warehousePuts.push(projectWarehouse(delta.id, delta.data, delta.updatedAt, delta.deleted));
        break;
      case 'category':
        if (delta.deleted) categoryNames.delete(delta.id);
        else categoryNames.set(delta.id, (delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id));
        break;
      case 'brand':
        if (delta.deleted) brandNames.delete(delta.id);
        else brandNames.set(delta.id, (delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id));
        break;
      case 'branch':
        if (delta.deleted) branches.delete(delta.id);
        else {
          branches.set(delta.id, {
            id: delta.id,
            name: delta.data && typeof delta.data.name === 'string' ? delta.data.name : delta.id,
            code: delta.data && typeof delta.data.code === 'string' ? delta.data.code : '',
          });
        }
        break;
    }
  }

  await db.transaction(
    'rw',
    [db.products, db.customers, db.suppliers, db.taxes, db.warehouses, db.meta],
    async () => {
      await Promise.all([
        db.products.bulkPut([...productPuts.values()]),
        db.customers.bulkPut(customerPuts),
        db.suppliers.bulkPut(supplierPuts),
        db.taxes.bulkPut(taxPuts),
        db.warehouses.bulkPut(warehousePuts),
        db.meta.put({ key: CATEGORY_NAMES_KEY, value: Object.fromEntries(categoryNames) }),
        db.meta.put({ key: BRAND_NAMES_KEY, value: Object.fromEntries(brandNames) }),
        db.meta.put({ key: BRANCHES_KEY, value: Object.fromEntries(branches) }),
      ]);
    },
  );

  return deltas.length;
}

/**
 * Drain the delta feed until this till is caught up.
 *
 * Throws `ApiError` on transport failure so the caller can decide whether that
 * is worth retrying; the cursor is left exactly where it was.
 */
export async function pullDeltas(api: ApiClient, options: PullOptions = {}): Promise<PullSummary> {
  const deviceId = await getDeviceId();
  const limit = options.limit ?? PULL_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_PAGES;

  let cursor = await getPullCursor();
  let applied = 0;
  let pages = 0;
  let caughtUp = false;

  while (pages < maxPages) {
    const response = await api.post<SyncPullResponse>('/sync/pull', {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId,
      cursor,
      limit,
    });

    if (response.protocolVersion !== SYNC_PROTOCOL_VERSION) {
      throw new Error(
        `Sync protocol mismatch: server speaks v${response.protocolVersion}, this till speaks v${SYNC_PROTOCOL_VERSION}. ` +
          `Update the POS client before taking more sales.`,
      );
    }

    const deltas = Array.isArray(response.deltas) ? response.deltas : [];
    applied += await applyDeltas(deltas);

    // Cursor advances only now — after the batch is durably written.
    const next = response.nextCursor ?? null;
    if (next !== null) await setPullCursor(next);

    pages += 1;
    caughtUp = !response.hasMore || next === null;

    if (caughtUp) break;
    // A server that returns the same cursor with `hasMore` would otherwise loop
    // forever making no progress.
    if (next === cursor) break;
    cursor = next;
  }

  return { applied, pages, caughtUp };
}

/** Category id -> name, for the POS category filter chips. */
export async function getCategoryNames(): Promise<{ id: string; name: string }[]> {
  const map = await getMeta<Record<string, string>>(CATEGORY_NAMES_KEY, {});
  return Object.entries(map)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
