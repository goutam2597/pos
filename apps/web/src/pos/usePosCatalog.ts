/**
 * Local catalog for the till.
 *
 * Everything the grid shows comes from IndexedDB, never from the network. That
 * is not an optimisation — it is the requirement: a cashier standing at a till
 * with no connectivity must still see yesterday's price and yesterday's stock,
 * and must never see a price the server has not confirmed.
 *
 * The hook loads once per branch and re-reads when `refreshToken` changes. The
 * page bumps the token after a sale (local stock moved) and whenever the sync
 * engine reports progress (the catalog just changed underneath us).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, type CachedProduct } from '../lib/db';
import type { ProductView } from './types';

function toView(product: CachedProduct): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    price: product.price,
    costPrice: product.costPrice,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    imageUrl: product.imageUrl ?? null,
    taxRate: product.taxRate,
    qtyOnHand: product.qtyOnHand,
    trackInventory: product.trackInventory,
    allowNegativeStock: product.allowNegativeStock,
    deleted: product.deleted === true,
  };
}

export interface CatalogCategory {
  id: string;
  name: string;
  count: number;
}

export interface PosCatalog {
  products: ProductView[];
  categories: CatalogCategory[];
  /** Catalogue size before filtering — used to render an honest empty state. */
  catalogSize: number;
  loading: boolean;
  /** True when the till has genuinely never synced a catalog. */
  catalogEmpty: boolean;
  reload: () => void;
}

/**
 * Case-insensitive match on name, SKU or barcode.
 *
 * Barcode matching is exact and runs first: a scanner types digits faster than
 * a human can read, and a partial-name match on "12" must never steal the
 * keystroke that was meant for a real barcode.
 */
export function matchesQuery(product: ProductView, query: string): boolean {
  if (query === '') return true;
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (product.barcode && product.barcode.toLowerCase() === needle) return true;
  if (product.sku && product.sku.toLowerCase() === needle) return true;
  if (product.name.toLowerCase().includes(needle)) return true;
  return false;
}

/**
 * Exact-match lookup for a scanned or typed code: barcode first, then SKU.
 *
 * Scanning must never fall back to a fuzzy match — a till that adds "whatever
 * looked closest" sells the wrong item silently, and the cashier is looking at
 * the customer, not the screen. Case-insensitive because Code128 payloads can
 * carry letters and the till cannot know which case a scanner sent.
 */
export async function findProductByCode(code: string): Promise<ProductView | null> {
  const needle = code.trim();
  if (needle === '') return null;

  const byBarcode = await db.products.where('barcode').equals(needle).and((p) => p.deleted !== true).first();
  if (byBarcode) return toView(byBarcode);

  const bySku = await db.products.where('sku').equals(needle).and((p) => p.deleted !== true).first();
  if (bySku) return toView(bySku);

  const lower = needle.toLowerCase();
  const rows = await db.products.toArray();
  const hit = rows.find(
    (p) => p.deleted !== true && ((p.barcode ?? '').toLowerCase() === lower || (p.sku ?? '').toLowerCase() === lower),
  );
  return hit ? toView(hit) : null;
}

export function usePosCatalog(query: string, categoryId: string | null, refreshToken: number): PosCatalog {
  const [all, setAll] = useState<ProductView[]>([]);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    void db.products
      .toArray()
      .then((rows) => {
        if (cancelled) return;
        setAll(rows.map(toView));
        loaded.current = true;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => reload(), [reload, refreshToken]);

  const visible = useMemo(
    () => all.filter((product) => !product.deleted && (categoryId === null || product.categoryId === categoryId)),
    [all, categoryId],
  );

  const products = useMemo(() => visible.filter((product) => matchesQuery(product, query)), [visible, query]);

  const categories = useMemo<CatalogCategory[]>(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const product of all) {
      if (product.deleted || product.categoryId === null) continue;
      const existing = counts.get(product.categoryId);
      const name = product.categoryName ?? product.categoryId;
      if (existing) existing.count += 1;
      else counts.set(product.categoryId, { name, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  return {
    products,
    categories,
    catalogSize: all.filter((p) => !p.deleted).length,
    loading,
    catalogEmpty: !loading && all.length === 0,
    reload,
  };
}

/** Customers for the picker. Small table, loaded the same way. */
export function useCustomers(refreshToken: number) {
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    void db.customers
      .toArray()
      .then((rows) => {
        if (cancelled) return;
        setCustomers(
          rows
            .filter((row) => row.deleted !== true)
            .map((row) => ({ id: row.id, name: row.name, phone: row.phone }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return customers;
}
