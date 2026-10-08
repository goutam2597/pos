import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { money, qty } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiQuery,
  useCreate,
  useRemove,
  useUpdate,
  type Brand,
  type Category,
  type Product,
  type Tax,
  type Unit,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, FilterBar, FilterField, type Column } from '../components/data';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';
import { FormDialog } from '../components/ui/Modal';
import { FormField, FormGrid, FormSection } from '../components/ui/Form';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Switch } from '../components/ui/Toggle';
import { MoneyInput } from '../components/ui/NumberInput';
import { SearchInput } from '../components/ui/SearchInput';
import { ConfirmRequestDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState, useServerFieldErrors } from './_shared';

/**
 * Product catalogue.
 *
 * The screen every shop touches dozens of times a day, so it is optimised for
 * *finding*, not for browsing: search first, filters behind one toggle, and the
 * identifying column is the product name with the SKU underneath.
 */
export function ProductsPage() {
  const { api, business, can } = useAuth();
  const [query, patch] = useQueryState({ page: 1, pageSize: 25, search: '', categoryId: '', status: '', lowStock: '' });
  const { errors, formError, capture, clear } = useServerFieldErrors();

  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const [form, setForm] = useState<ProductForm>(emptyProductForm);

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      categoryId: query.categoryId || undefined,
      status: query.status || undefined,
      lowStock: query.lowStock || undefined,
    }),
    [query],
  );

  const list = useApiList<Product>(queryKeys.products(params), '/products', params);
  const categories = useApiQuery<Category[]>(queryKeys.categories, (signal) => api.data<Category[]>('/categories', { signal }), { staleTime: 10 * 60_000 });
  const brands = useApiQuery<Brand[]>(queryKeys.brands, (signal) => api.data<Brand[]>('/brands', { signal }), { staleTime: 10 * 60_000 });
  const units = useApiQuery<Unit[]>(queryKeys.units, (signal) => api.data<Unit[]>('/units', { signal }), { staleTime: 10 * 60_000 });
  const taxes = useApiQuery<Tax[]>(queryKeys.taxes, (signal) => api.data<Tax[]>('/taxes', { signal }), { staleTime: 10 * 60_000 });


  const create = useCreate<Record<string, unknown>>([queryKeys.categories], 'Product created');
  const update = useUpdate<Record<string, unknown>>([queryKeys.categories], 'Product updated');
  const remove = useRemove([queryKeys.categories], 'Product deleted');

  const openCreate = () => {
    setEditing(null);
    setForm(emptyProductForm);
    clear();
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    clear();
    setForm({
      name: product.name ?? '',
      sku: product.sku ?? '',
      barcode: product.barcode ?? '',
      description: product.description ?? '',
      categoryId: product.categoryId ?? '',
      brandId: product.brandId ?? '',
      unitId: product.unitId ?? '',
      taxId: product.taxId ?? '',
      price: product.price ?? 0,
      costPrice: product.costPrice ?? 0,
      trackInventory: product.trackInventory !== false,
      allowNegativeStock: product.allowNegativeStock === true,
      isActive: product.isActive !== false,
    });
    setDialogOpen(true);
  };

  const submit = () => {
    const body = {
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      description: form.description.trim() || undefined,
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      unitId: form.unitId || null,
      taxId: form.taxId || null,
      price: form.price,
      costPrice: form.costPrice,
      trackInventory: form.trackInventory,
      allowNegativeStock: form.allowNegativeStock,
      isActive: form.isActive,
    };

    if (editing) {
      update.mutate(
        { path: `/products/${editing.id}`, ...body },
        { onSuccess: () => setDialogOpen(false) },
      );
      return;
    }
    create.mutate({ path: '/products', ...body }, { onSuccess: () => setDialogOpen(false) });
  };

  const askDelete = (product: Product) => {
    setConfirm({
      title: `Delete ${product.name}?`,
      description:
        'Products that have been sold are archived rather than deleted, so past invoices stay correct. This cannot be undone.',
      confirmLabel: 'Delete product',
      onConfirm: () => {
        remove.mutate(
          { path: `/products/${product.id}` },
          {
            onSuccess: () => {
              setConfirm(null);
              toast.success(`${product.name} deleted`);
            },
            onError: () => setConfirm(null),
          },
        );
      },
    });
  };

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      value: (row) => row.name,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <Package size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link to={`/products/${row.id}`} className="block truncate font-medium hover:underline">
              {row.name}
            </Link>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">
              {[row.sku, row.categoryName].filter(Boolean).join(' · ') || 'No SKU'}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'brand', header: 'Brand', value: (row) => row.brandName, optional: true, cell: (row) => row.brandName ?? '—' },
    {
      key: 'price',
      header: 'Price',
      align: 'end',
      value: (row) => row.price,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.price)}</span>,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'end',
      value: (row) => row.costPrice ?? null,
      optional: true,
      cell: (row) => (row.costPrice === undefined || row.costPrice === null ? '—' : money(row.costPrice)),
    },
    {
      key: 'stock',
      header: 'On hand',
      align: 'end',
      value: (row) => row.qtyOnHand ?? null,
      cell: (row) =>
        row.trackInventory === false ? (
          <span className="text-[var(--text-tertiary)]">Not tracked</span>
        ) : (
          <span className="tabular-nums">{qty(row.qtyOnHand ?? 0, row.unitName)}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status ?? (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      cell: (row) => <StatusBadge status={row.status ?? (row.isActive === false ? 'INACTIVE' : 'ACTIVE')} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '6.5rem',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} disabled={!can('product:update')}>
            Edit
          </Button>
          {can('product:delete') && (
            <Button variant="ghost" size="sm" className="text-[var(--danger-text)]" onClick={() => askDelete(row)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const activeFilters = [
    ...(query.categoryId ? [{ key: 'category', label: `Category: ${categories.data?.find((c) => c.id === query.categoryId)?.name ?? 'selected'}`, onRemove: () => patch({ categoryId: '' }) }] : []),
    ...(query.status ? [{ key: 'status', label: `Status: ${query.status}`, onRemove: () => patch({ status: '' }) }] : []),
    ...(query.lowStock ? [{ key: 'lowStock', label: 'Low stock only', onRemove: () => patch({ lowStock: '' }) }] : []),
  ];

  return (
    <Page>
      <PageHeader
        title="Products"
        description={business ? `${business.currency} · prices include the configured tax treatment` : undefined}
        actions={
          can('product:create') ? (
            <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openCreate}>
              New product
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="products"
        columns={columns}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 25, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={list.isPending}
        isRefetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page) => patch({ page })}
        onPageSizeChange={(pageSize) => patch({ pageSize })}
        exportName="products"
        toolbar={
          <FilterBar
            className="w-full"
            active={activeFilters}
            {...(activeFilters.length > 0
              ? { onClearAll: () => patch({ categoryId: '', status: '', lowStock: '' }) }
              : {})}
          >
            <SearchInput
              value={query.search}
              onValueChange={(search) => patch({ search })}
              placeholder="Search name, SKU or barcode"
            />
          </FilterBar>
        }
        filters={
          <>
            <FilterField>
              <SearchableSelect
                label="Category"
                placeholder="All categories"
                searchPlaceholder="Search categories\u2026"
                value={query.categoryId}
                onChange={(categoryId) => patch({ categoryId })}
                options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))}
              />
            </FilterField>
            <FilterField>
              <Select
                label="Status"
                placeholder="Any status"
                value={query.status}
                onChange={(event) => patch({ status: event.target.value })}
                options={['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
            <FilterField width="w-[9rem]">
              <Select
                label="Stock"
                placeholder="Any"
                value={query.lowStock}
                onChange={(event) => patch({ lowStock: event.target.value })}
                options={[{ value: 'true', label: 'Low stock' }]}
              />
            </FilterField>
          </>
        }
        emptyTitle={query.search || query.categoryId ? 'No products match those filters' : 'No products yet'}
        emptyDescription={
          query.search || query.categoryId
            ? 'Try a shorter search, or clear the filters to see the whole catalogue.'
            : 'Add your first product to start selling. You can import a catalogue later.'
        }
        emptyAction={
          can('product:create')
            ? { label: 'New product', onClick: openCreate, icon: <Plus size={15} strokeWidth={1.75} /> }
            : undefined
        }
      />

      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New product'}
        description={editing ? 'Changes apply to the catalogue, not to past sales.' : 'Prices are stored in minor units so totals stay exact.'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing ? 'Save changes' : 'Create product'}
        size="lg"
      >
        <div className="space-y-5">
          {formError && (
            <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger-text)]">
              {formError}
            </p>
          )}

          <FormSection title="Identity">
            <FormGrid>
              <FormField label="Product name" required error={errors.name}>
                {(id) => (
                  <Input
                    id={id}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="e.g. Whole Milk 1L"
                    autoFocus
                  />
                )}
              </FormField>
              <FormField label="SKU" error={errors.sku} hint="Internal code used on reports and stock counts.">
                {(id) => (
                  <Input id={id} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="MILK-1L" />
                )}
              </FormField>
              <FormField label="Barcode" error={errors.barcode}>
                {(id) => (
                  <Input
                    id={id}
                    value={form.barcode}
                    onChange={(event) => setForm({ ...form, barcode: event.target.value })}
                    inputMode="numeric"
                    placeholder="Scan or type"
                  />
                )}
              </FormField>
              <FormField label="Category">
                {(id) => (
                  <SearchableSelect
                    id={id}
                    placeholder="Uncategorised"
                    searchPlaceholder="Search categories…"
                    value={form.categoryId}
                    onChange={(categoryId) => setForm({ ...form, categoryId })}
                    options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))}
                  />
                )}
              </FormField>
              <FormField label="Brand">
                {(id) => (
                  <SearchableSelect
                    id={id}
                    placeholder="No brand"
                    searchPlaceholder="Search brands…"
                    value={form.brandId}
                    onChange={(brandId) => setForm({ ...form, brandId })}
                    options={(brands.data ?? []).map((brand) => ({ value: brand.id, label: brand.name }))}
                  />
                )}
              </FormField>
              <FormField label="Unit of measure">
                {(id) => (
                  <Select
                    id={id}
                    placeholder="Each"
                    value={form.unitId}
                    onChange={(event) => setForm({ ...form, unitId: event.target.value })}
                    options={(units.data ?? []).map((unit) => ({ value: unit.id, label: unit.name }))}
                  />
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Pricing">
            <FormGrid>
              <FormField label="Selling price" required error={errors.price}>
                {(id) => (
                  <MoneyInput
                    id={id}
                    value={form.price}
                    onValueChange={(price) => setForm({ ...form, price })}
                    currency={business?.currency ?? 'USD'}
                  />
                )}
              </FormField>
              <FormField label="Cost price" error={errors.costPrice} hint="Used for profit and stock valuation. Never shown on the till.">
                {(id) => (
                  <MoneyInput
                    id={id}
                    value={form.costPrice}
                    onValueChange={(costPrice) => setForm({ ...form, costPrice })}
                    currency={business?.currency ?? 'USD'}
                  />
                )}
              </FormField>
              <FormField label="Tax" error={errors.taxId}>
                {(id) => (
                  <SearchableSelect
                    id={id}
                    placeholder="No tax"
                    searchPlaceholder="Search taxes…"
                    value={form.taxId}
                    onChange={(taxId) => setForm({ ...form, taxId })}
                    options={(taxes.data ?? []).map((tax) => ({
                      value: tax.id,
                      label: `${tax.name}${tax.rate !== undefined ? ` (${tax.rate}%)` : ''}`,
                    }))}
                  />
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Behaviour">
            <div className="space-y-3">
              <Switch
                label="Track stock for this product"
                description="Turn off for services, gift cards and other things you cannot run out of."
                checked={form.trackInventory}
                onChange={(event) => setForm({ ...form, trackInventory: event.target.checked })}
              />
              <Switch
                label="Allow selling below zero"
                description="Off by default: overselling a product you do not have is a stocktake problem later."
                checked={form.allowNegativeStock}
                onChange={(event) => setForm({ ...form, allowNegativeStock: event.target.checked })}
              />
              <Switch
                label="Active"
                description="Inactive products stay in reports but cannot be sold."
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
            </div>
          </FormSection>

          {Object.keys(errors).length > 0 && (
            <p className="flex items-center gap-1.5 text-[13px] text-[var(--text-tertiary)]">
              <Tags size={14} strokeWidth={1.75} aria-hidden="true" />
              Fix the highlighted fields and try again.
            </p>
          )}
        </div>
      </FormDialog>

      <ConfirmRequestDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        pending={remove.isPending}
        cancelLabel="Keep it"
      />
    </Page>
  );
}

interface ProductForm {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  taxId: string;
  price: number;
  costPrice: number;
  trackInventory: boolean;
  allowNegativeStock: boolean;
  isActive: boolean;
}

const emptyProductForm: ProductForm = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  categoryId: '',
  brandId: '',
  unitId: '',
  taxId: '',
  price: 0,
  costPrice: 0,
  trackInventory: true,
  allowNegativeStock: false,
  isActive: true,
};

