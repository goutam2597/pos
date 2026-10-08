import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpFromLine, ClipboardCheck, Warehouse as WarehouseIcon } from 'lucide-react';

import { dateTime, money, qty } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiMutation,
  useApiQuery,

  type Product,
  type StockLevel,
  type StockMove,
  type StockValueRow,
  type Warehouse,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, FilterBar, FilterField, type Column } from '../components/data';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import { FormDialog } from '../components/ui/Modal';
import { FormField } from '../components/ui/Form';
import { QuantityInput } from '../components/ui/NumberInput';
import { TabPanel, Tabs, useTabs } from '../components/ui/Tabs';
import { KpiGrid, KpiTile } from '../components/ui/KpiTile';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState } from './_shared';

/**
 * Inventory.
 *
 * Three questions a shop asks in the back room: what do I have, what moved, and
 * what is it all worth. They are tabs rather than separate pages because the
 * answer to one is usually a filter on the next — you notice a low count, then
 * ask when it happened, then ask what it cost.
 */

const MOVE_DIRECTION: Record<string, 1 | -1> = {
  PURCHASE: 1,
  RETURN_IN: 1,
  ADJUSTMENT_IN: 1,
  TRANSFER_IN: 1,
  OPENING: 1,
  SALE: -1,
  RETURN_OUT: -1,
  ADJUSTMENT_OUT: -1,
  TRANSFER_OUT: -1,
  SHRINKAGE: -1,
};

export function InventoryPage() {
  const [tab, setTab] = useTabs('stock');

  return (
    <Page>
      <PageHeader
        title="Inventory"
        description="Stock on hand, every movement that touched it, and what it is worth."
      />

      <Tabs
        label="Inventory views"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'stock', label: 'Stock on hand', icon: <WarehouseIcon size={15} strokeWidth={1.75} /> },
          { value: 'moves', label: 'Movements', icon: <ArrowUpFromLine size={15} strokeWidth={1.75} /> },
          { value: 'value', label: 'Valuation', icon: <ClipboardCheck size={15} strokeWidth={1.75} /> },
        ]}
        className="mb-4"
      />

      <TabPanel value="stock" active={tab}>
        <StockTab />
      </TabPanel>
      <TabPanel value="moves" active={tab}>
        <MovesTab />
      </TabPanel>
      <TabPanel value="value" active={tab}>
        <ValuationTab />
      </TabPanel>
    </Page>
  );
}

function StockTab() {
  const { api, business, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    warehouseId: '',
    lowStock: '',
  });
  const [adjusting, setAdjusting] = useState(false);
  const [lines, setLines] = useState<Array<{ productId: string; productName: string; countedQtyMilli: number }>>([]);
  const [note, setNote] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const warehouses = useApiQuery<Warehouse[]>(
    queryKeys.warehouses,
    (signal) => api.data<Warehouse[]>('/warehouses', { signal }),
    { staleTime: 10 * 60_000 },
  );

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      warehouseId: query.warehouseId || undefined,
      lowStock: query.lowStock || undefined,
    }),
    [query],
  );

  const list = useApiList<StockLevel>(queryKeys.stock(params), '/inventory/stock', params);

  const adjust = useApiMutation<Record<string, unknown>, unknown>({
    invalidate: [queryKeys.stock({}), queryKeys.stockMoves({}), queryKeys.stockValue({}), ['inventory']],
    mutationFn: (body) => api.post('/inventory/adjust', body),
    successMessage: 'Stock adjusted — the ledger and stock levels agree again',
    onSuccess: () => setAdjusting(false),
  });

  const columns: Column<StockLevel>[] = [
    {
      key: 'product',
      header: 'Product',
      value: (row) => row.productName,
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName ?? 'Product'}</p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">
            {[row.sku, row.warehouseName].filter(Boolean).join(' · ') || 'All warehouses'}
          </p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'On hand',
      align: 'end',
      value: (row) => row.qtyOnHand,
      cell: (row) => (
        <span
          className={
            row.isLow || (row.reorderLevel !== undefined && row.qtyOnHand <= row.reorderLevel)
              ? 'font-medium text-[var(--warning-text)]'
              : 'tabular-nums'
          }
        >
          {qty(row.qtyOnHand, row.unitName)}
        </span>
      ),
    },
    {
      key: 'reorder',
      header: 'Reorder at',
      align: 'end',
      optional: true,
      value: (row) => row.reorderLevel ?? null,
      cell: (row) => (row.reorderLevel === undefined || row.reorderLevel === null ? '—' : qty(row.reorderLevel)),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'end',
      optional: true,
      value: (row) => row.reservedQty ?? null,
      cell: (row) => (row.reservedQty ? qty(row.reservedQty) : '—'),
    },
    {
      key: 'cost',
      header: 'Unit cost',
      align: 'end',
      optional: true,
      value: (row) => row.costPrice ?? null,
      cell: (row) => (row.costPrice ? money(row.costPrice) : '—'),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'end',
      value: (row) => row.value ?? (row.qtyOnHand * (row.costPrice ?? 0)),
      cell: (row) => (
        <span className="font-medium tabular-nums">
          {money(row.value ?? Math.trunc((row.qtyOnHand * (row.costPrice ?? 0)) / 1000))}
        </span>
      ),
    },
    {
      key: 'status',
      header: '',
      width: '6rem',
      value: (row) => (row.isLow ? 1 : 0),
      cell: (row) =>
        row.isLow ? (
          <Badge tone="warning" dot>
            Low
          </Badge>
        ) : (
          <span className="text-[12px] text-[var(--text-tertiary)]">OK</span>
        ),
    },
  ];

  const totalValue = (list.data?.rows ?? []).reduce(
    (sum, row) => sum + (row.value ?? Math.trunc((row.qtyOnHand * (row.costPrice ?? 0)) / 1000)),
    0,
  );
  const lowCount = (list.data?.rows ?? []).filter(
    (row) => row.isLow || (row.reorderLevel !== undefined && row.qtyOnHand <= row.reorderLevel),
  ).length;

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiTile label="Lines on this page" value={list.data?.meta.total ?? 0} />
        <KpiTile label="Low stock lines" value={lowCount} tone={lowCount > 0 ? 'warning' : 'default'} />
        <KpiTile
          label="Value on this page"
          value={list.data ? money(totalValue) : '—'}
          caption="At the current unit cost"
        />
        <KpiTile
          label="Warehouses"
          value={warehouses.data?.length ?? 0}
          icon={WarehouseIcon}
          caption="Stock is counted per warehouse"
        />
      </KpiGrid>

      <DataTable
        tableId="inventory-stock"
        columns={columns}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 25, pageCount: 1 }}
        getRowId={(row) => row.id ?? `${row.productId}-${row.warehouseId ?? "all"}`}
        isLoading={list.isPending}
        isRefetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page) => patch({ page })}
        onPageSizeChange={(pageSize) => patch({ pageSize })}
        exportName="stock-levels"
        toolbar={
          <FilterBar className="w-full">
            <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search product or SKU" />
          </FilterBar>
        }
        filters={
          <>
            <FilterField width="w-[12rem]">
              <Select
                label="Warehouse"
                placeholder="All warehouses"
                value={query.warehouseId}
                onChange={(event) => patch({ warehouseId: event.target.value })}
                options={(warehouses.data ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
              />
            </FilterField>
            <FilterField width="w-[9rem]">
              <Select
                label="Stock"
                placeholder="Any"
                value={query.lowStock}
                onChange={(event) => patch({ lowStock: event.target.value })}
                options={[{ value: 'true', label: 'Low only' }]}
              />
            </FilterField>
          </>
        }
        emptyTitle={query.lowStock ? 'Nothing is running low' : 'No stock records'}
        emptyDescription={
          query.lowStock
            ? 'Every tracked product is above its reorder level.'
            : 'Stock appears once you receive a purchase or record an opening balance.'
        }
      />

      {can('stock:update') && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={<ClipboardCheck size={16} strokeWidth={1.75} />}
            onClick={() => {
              setLines([]);
              setNote('');
              setWarehouseId(query.warehouseId || warehouses.data?.[0]?.id || '');
              setAdjusting(true);
            }}
          >
            Stock count adjustment
          </Button>
        </div>
      )}

      <FormDialog
        open={adjusting}
        onClose={() => setAdjusting(false)}
        title="Stock count adjustment"
        description="Enter the counted quantity for each product. Every line posts an adjustment movement."
        submitLabel="Post adjustment"
        onSubmit={() =>
          adjust.mutate({
            warehouseId: warehouseId || undefined,
            note: note.trim() || undefined,
            lines: lines
              .filter((line) => line.productId)
              .map((line) => ({ productId: line.productId, countedQtyMilli: line.countedQtyMilli, note: note.trim() || undefined })),
          })
        }
        submitting={adjust.isPending}
        disabled={lines.length === 0}
      >
        <div className="space-y-4">
          <FormField label="Warehouse" required>
            {(id) => (
              <Select
                id={id}
                placeholder="Select a warehouse"
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
                options={(warehouses.data ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
              />
            )}
          </FormField>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[var(--text-secondary)]">Counted lines</p>
            {lines.length === 0 ? (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-3 py-6 text-center">
                <p className="text-[13px] text-[var(--text-tertiary)]">
                  Add a product and enter what you actually counted.
                </p>
                <ProductPicker
                  onPick={(product) =>
                    setLines((current) => [
                      ...current,
                      { productId: product.id, productName: product.name, countedQtyMilli: 0 },
                    ])
                  }
                />
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {lines.map((line, index) => (
                    <li key={line.productId} className="flex items-end gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2">
                      <span className="min-w-0 flex-1 truncate py-2 text-[13px]">{line.productName}</span>
                      <QuantityInput
                        value={line.countedQtyMilli}
                        onValueChange={(value) =>
                          setLines((current) =>
                            current.map((entry, i) => (i === index ? { ...entry, countedQtyMilli: value } : entry)),
                          )
                        }
                        size="sm"
                        className="w-32"
                        aria-label={`Counted quantity for ${line.productName}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                        aria-label={`Remove ${line.productName}`}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <ProductPicker
                  onPick={(product) =>
                    setLines((current) => [...current, { productId: product.id, productName: product.name, countedQtyMilli: 0 }])
                  }
                />
              </>
            )}
          </div>

          <FormField label="Note">
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Monday stocktake" />}
          </FormField>

          <p className="flex items-start gap-2 text-[12px] text-[var(--text-tertiary)]">
            <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-[1px] shrink-0" />
            An adjustment writes off or creates stock value against the profit and loss account. It is recorded in
            the audit log with your name on it.
          </p>
        </div>
      </FormDialog>
    </div>
  );
}

/** Product picker used by the adjustment dialog. */
function ProductPicker({ onPick }: { onPick: (product: Product) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isFetching } = useApiList<Product>(
    ['adjust-product-picker', search],
    '/products',
    { page: 1, pageSize: 12, search: search || undefined },
    { enabled: open, staleTime: 30_000 },
  );

  return (
    <div className="mt-2">
      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Add a product
        </Button>
      ) : (
        <div className="space-y-1.5">
          <SearchInput
            autoFocus
            size="sm"
            value={search}
            onValueChange={setSearch}
            placeholder="Search products…"
          />
          <ul className="max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] scrollbar-thin">
            {(data?.rows ?? []).map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(product);
                    setSearch("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-[13px] hover:bg-[var(--bg-sunken)]"
                >
                  <span className="min-w-0 truncate">{product.name}</span>
                  <span className="shrink-0 text-[12px] text-[var(--text-tertiary)] tabular-nums">
                    {money(product.price)}
                  </span>
                </button>
              </li>
            ))}
            {(data?.rows.length ?? 0) === 0 && !isFetching && (
              <li className="px-3 py-6 text-center text-[13px] text-[var(--text-tertiary)]">No products found.</li>
            )}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function MovesTab() {
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    type: '',
    from: isoDaysAgo(30),
    to: todayIso(),
  });

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      type: query.type || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<StockMove>(queryKeys.stockMoves(params), '/inventory/moves', params);

  const columns: Column<StockMove>[] = [
    {
      key: 'date',
      header: 'When',
      value: (row) => row.createdAt,
      width: '11rem',
      sticky: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{dateTime(row.createdAt)}</span>,
    },
    {
      key: 'product',
      header: 'Product',
      value: (row) => row.productName,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName ?? '—'}</p>
          {row.warehouseName && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.warehouseName}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Reason',
      value: (row) => row.type,
      width: '11rem',
      cell: (row) => <StatusBadge status={row.type} />,
    },
    {
      key: 'qty',
      header: 'Change',
      align: 'end',
      value: (row) => row.qtyMilli,
      cell: (row) => {
        const direction = MOVE_DIRECTION[row.type] ?? 1;
        return (
          <span
            className={`font-medium tabular-nums ${direction > 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}`}
          >
            {direction > 0 ? '+' : '−'}
            {qty(Math.abs(row.qtyMilli), row.unitName).replace('−', '')}
          </span>
        );
      },
    },
    {
      key: 'reference',
      header: 'Reference',
      optional: true,
      value: (row) => row.referenceNumber,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.referenceNumber ?? row.note ?? '—'}</span>,
    },
    {
      key: 'user',
      header: 'By',
      optional: true,
      value: (row) => row.userName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.userName ?? '—'}</span>,
    },
  ];

  return (
    <DataTable
      tableId="inventory-moves"
      columns={columns}
      rows={list.data?.rows ?? []}
      meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 25, pageCount: 1 }}
      getRowId={(row) => row.id}
      isLoading={list.isPending}
      error={list.error}
      onRetry={() => void list.refetch()}
      onPageChange={(page) => patch({ page })}
      onPageSizeChange={(pageSize) => patch({ pageSize })}
      exportName="stock-moves"
      toolbar={
        <div className="flex w-full flex-wrap items-end gap-2">
          <FilterBar className="w-full sm:w-auto">
            <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search product" />
          </FilterBar>
          <DateRangePicker
            className="ms-auto"
            from={query.from}
            to={query.to}
            onChange={(range) => patch({ from: range.from, to: range.to })}
          />
        </div>
      }
      filters={
        <FilterField width="w-[13rem]">
          <Select
            label="Movement"
            placeholder="All movements"
            value={query.type}
            onChange={(event) => patch({ type: event.target.value })}
            options={Object.keys(MOVE_DIRECTION).map((value) => ({ value, label: value.replace('_', ' ').toLowerCase() }))}
          />
        </FilterField>
      }
      emptyTitle="No stock movements in this period"
      emptyDescription="Every sale, receipt and adjustment appears here as it happens."
    />
  );
}

function ValuationTab() {
  const { api } = useAuth();
  const [warehouseId, setWarehouseId] = useState('');

  const warehouses = useApiQuery<Warehouse[]>(
    queryKeys.warehouses,
    (signal) => api.data<Warehouse[]>('/warehouses', { signal }),
    { staleTime: 10 * 60_000 },
  );

  const list = useApiList<StockValueRow>(
    queryKeys.stockValue({ warehouseId: warehouseId || undefined }),
    '/inventory/value',
    { page: 1, pageSize: 200, warehouseId: warehouseId || undefined },
  );

  const rows = list.data?.rows ?? [];
  const totalValue = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + (row.qtyMilli ?? 0), 0);

  const columns: Column<StockValueRow>[] = [
    {
      key: 'product',
      header: 'Product',
      value: (row) => row.productName,
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName ?? '—'}</p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.sku ?? row.warehouseName ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'end',
      value: (row) => row.qtyMilli ?? 0,
      cell: (row) => <span className="tabular-nums">{qty(row.qtyMilli ?? 0)}</span>,
    },
    {
      key: 'cost',
      header: 'Unit cost',
      align: 'end',
      value: (row) => row.costPrice ?? 0,
      cell: (row) => <span className="tabular-nums">{money(row.costPrice ?? 0)}</span>,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'end',
      value: (row) => row.value ?? 0,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.value ?? 0)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiTile label="Lines valued" value={list.data?.meta.total ?? 0} />
        <KpiTile label="Total quantity" value={qty(totalQty)} />
        <KpiTile label="Stock value" value={money(totalValue)} tone="default" caption="At the current cost basis" />
        <KpiTile label="Warehouses" value={warehouses.data?.length ?? 0} />
      </KpiGrid>

      <DataTable
        tableId="inventory-value"
        columns={columns}
        rows={rows}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 200, pageCount: 1 }}
        getRowId={(row) => row.productId ?? row.sku ?? "row"}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        exportName="inventory-valuation"
        toolbar={
          <div className="w-[14rem]">
            <Select
              label="Warehouse"
              placeholder="All warehouses"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              options={(warehouses.data ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
            />
          </div>
        }
        emptyTitle="Nothing to value"
        emptyDescription="Stock value appears once products have a cost price and stock on hand."
      />

      <Card flush>
        <CardHeader
          title="How this is calculated"
          description="Read this before quoting a stock figure to a buyer."
        />
        <ul className="space-y-1.5 px-4 py-3 text-[13px] text-[var(--text-secondary)]">
          <li>Value uses the costing method set on each product: weighted average, FIFO or lifetime.</li>
          <li>Quantities are stored in thousandths, so fractional stock never rounds away.</li>
          <li>Stock on sale but not yet shipped is still counted — this is a balance, not a forecast.</li>
        </ul>
      </Card>
    </div>
  );
}

