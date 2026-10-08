/**
 * Product grid — the left half of the till.
 *
 * Designed for a scanner and a fast typist rather than a mouse: Enter in the
 * search box adds the best match, the grid is a flat list of large targets,
 * and an out-of-stock item is dimmed and badged rather than hidden — a cashier
 * needs to be able to sell it anyway (returns, substitutions, stock the server
 * has not told us about yet) without the UI silently lying about what exists.
 */

import { useMemo, type RefObject } from 'react';
import { Package, PackageX, ScanLine, Search } from 'lucide-react';
import { money, qty } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { ProductView } from '../../pos/types';
import type { CatalogCategory } from '../../pos/usePosCatalog';
import { Badge, Button, EmptyState, Input, Spinner, cx } from './ui';

export interface ProductGridProps {
  products: ProductView[];
  categories: CatalogCategory[];
  catalogEmpty: boolean;
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  onSelect: (product: ProductView) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Product to highlight (the one just added), so the eye can find it. */
  flashId: string | null;
  onSyncNow: () => void;
}

export function ProductGrid({
  products,
  categories,
  catalogEmpty,
  loading,
  query,
  onQueryChange,
  onQuerySubmit,
  categoryId,
  onCategoryChange,
  onSelect,
  searchRef,
  flashId,
  onSyncNow,
}: ProductGridProps) {
  const t = useT();

  const filters = useMemo(
    () => [{ id: null, name: t('common.all'), count: products.length }, ...categories] as Array<{
      id: string | null;
      name: string;
      count?: number;
    }>,
    [categories, products.length, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onQuerySubmit();
        }}
      >
        <div className="relative flex-1">
          <Search
            size={15}
            strokeWidth={1.75}
            className="pointer-events-none absolute inset-inline-start-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Scan barcode or type a name, SKU or code, then press Enter"
            className="ps-8"
            autoComplete="off"
            spellCheck={false}
            aria-label="Product search"
          />
        </div>
        <span className="hidden items-center gap-1 text-[11px] text-[var(--text-tertiary)] md:flex">
          <ScanLine size={13} strokeWidth={1.75} />
          F2
        </span>
      </form>

      {categories.length > 0 ? (
        <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {filters.map((filter) => {
            const active = filter.id === categoryId;
            return (
              <button
                key={filter.id ?? 'all'}
                type="button"
                onClick={() => onCategoryChange(filter.id)}
                className={cx(
                  'shrink-0 rounded-[var(--radius-sm)] border px-2 py-1 text-[12px] transition-colors',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-sunken)]',
                )}
              >
                {filter.name}
                {filter.count !== undefined ? <span className="ms-1 tabular text-[11px] opacity-70">{filter.count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {catalogEmpty ? (
          <EmptyState
            icon={<PackageX size={24} strokeWidth={1.75} />}
            title="No products on this till yet"
            description="This terminal has never received a catalogue, so it cannot sell anything. Sync once to download the product list — after that the till keeps working with no connection at all."
            action={
              <Button variant="primary" onClick={onSyncNow}>
                {t('sync.syncNow')}
              </Button>
            }
          />
        ) : loading && products.length === 0 ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Search size={22} strokeWidth={1.75} />}
            title="Nothing matches that search"
            description={`No product matches "${query}" in the local catalogue.`}
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 p-2">
            {products.map((product) => {
              const outOfStock = product.trackInventory && product.qtyOnHand <= 0 && !product.allowNegativeStock;
              const flash = product.id === flashId;

              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(product)}
                    title={outOfStock ? `${product.name} — out of stock` : product.name}
                    className={cx(
                      'flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius-md)] border p-2 text-start transition-colors',
                      flash
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]',
                      outOfStock && 'opacity-60',
                    )}
                  >
                    <span className="flex w-full items-start gap-1.5">
                      <Package size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
                      <span className="line-clamp-2 text-[12px] leading-snug font-medium text-[var(--text-primary)]">
                        {product.name}
                      </span>
                    </span>

                    <span className="tabular text-[13px] font-semibold text-[var(--text-primary)]">{money(product.price)}</span>

                    <span className="mt-auto flex w-full items-center gap-1">
                      {outOfStock ? <Badge tone="danger">Out of stock</Badge> : null}
                      {product.trackInventory ? (
                        <span className="tabular ms-auto text-[11px] text-[var(--text-tertiary)]">
                          {qty(product.qtyOnHand)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
