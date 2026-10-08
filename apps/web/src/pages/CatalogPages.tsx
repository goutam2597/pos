import { Layers, Ruler, Tags } from 'lucide-react';


import { CrudPage, type Column, type CrudField } from '../components/data';
import { ActiveBadge, StatusBadge } from '../components/ui/Badge';
import { useAuth } from '../lib/auth';
import type { Brand, Category, Tax, Unit } from '../lib/queries';
import { queryKeys } from '../lib/queries';

/**
 * Reference data: categories, brands, units and taxes.
 *
 * Four small, nearly identical screens, so they share the CrudPage shape. The
 * difference that matters is that these lists are short — a shop has tens of
 * categories, not tens of thousands — so they do not paginate and the search
 * field is the whole navigation model.
 */

const activeColumn = <T extends { isActive?: boolean }>(header = 'Status'): Column<T> => ({
  key: 'status',
  header,
  value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
  width: '7rem',
  cell: (row) => <ActiveBadge isActive={row.isActive} />,
});

export function CategoriesPage() {
  return (
    <CrudPage<Category>
      tableId="categories"
      title="Categories"
      description="Group products so reports and the till grid stay readable."
      path="/categories"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'category:create', update: 'category:update', delete: 'category:delete' }}
      searchPlaceholder="Search categories"
      paginated={false}
      invalidate={[queryKeys.categories]}
      emptyTitle="No categories yet"
      emptyDescription="Categories keep the till grid and product reports from turning into one long list."
      createLabel="New category"
      columns={[
        {
          key: 'name',
          header: 'Category',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
                <Layers size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                {row.parentName && <p className="truncate text-[12px] text-[var(--text-tertiary)]">in {row.parentName}</p>}
              </div>
            </div>
          ),
        },
        {
          key: 'products',
          header: 'Products',
          align: 'end',
          value: (row) => row.productCount ?? 0,
          width: '6rem',
          cell: (row) => <span className="tabular-nums">{row.productCount ?? 0}</span>,
        },
        {
          key: 'description',
          header: 'Description',
          optional: true,
          value: (row) => row.description,
          cell: (row) => <span className="text-[var(--text-secondary)]">{row.description ?? '—'}</span>,
        },
        activeColumn<Category>(),
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, section: 'Details', placeholder: 'e.g. Dairy' },
        { name: 'parentId', label: 'Parent category', type: 'select', section: 'Details', placeholder: 'None (top level)', optionsFor: () => [] },
        { name: 'description', label: 'Description', type: 'textarea', full: true, section: 'Details' },
        { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Availability', defaultValue: true, hint: 'Inactive categories keep their products but are hidden on the till.' },
      ]}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        parentId: form.parentId ? String(form.parentId) : null,
        description: String(form.description ?? '').trim() || null,
        isActive: Boolean(form.isActive),
      })}
      fromRow={(row) => ({
        name: row.name,
        parentId: row.parentId ?? '',
        description: row.description ?? '',
        isActive: row.isActive !== false,
      })}
    />
  );
}

export function BrandsPage() {
  return (
    <CrudPage<Brand>
      tableId="brands"
      title="Brands"
      description="Optional grouping for products that share a manufacturer."
      path="/brands"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'brand:create', update: 'brand:update', delete: 'brand:delete' }}
      searchPlaceholder="Search brands"
      paginated={false}
      invalidate={[queryKeys.brands]}
      emptyTitle="No brands yet"
      createLabel="New brand"
      columns={[
        {
          key: 'name',
          header: 'Brand',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
                <Tags size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="truncate font-medium">{row.name}</span>
            </div>
          ),
        },
        {
          key: 'products',
          header: 'Products',
          align: 'end',
          value: (row) => row.productCount ?? 0,
          width: '6rem',
          cell: (row) => <span className="tabular-nums">{row.productCount ?? 0}</span>,
        },
        {
          key: 'description',
          header: 'Description',
          optional: true,
          value: (row) => row.description,
          cell: (row) => <span className="text-[var(--text-secondary)]">{row.description ?? '—'}</span>,
        },
        activeColumn<Brand>(),
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, section: 'Details', placeholder: 'e.g. Nestlé' },
        { name: 'description', label: 'Description', type: 'textarea', full: true, section: 'Details' },
        { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Availability', defaultValue: true },
      ]}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        description: String(form.description ?? '').trim() || null,
        isActive: Boolean(form.isActive),
      })}
      fromRow={(row) => ({ name: row.name, description: row.description ?? '', isActive: row.isActive !== false })}
    />
  );
}

export function UnitsPage() {
  return (
    <CrudPage<Unit>
      tableId="units"
      title="Units of measure"
      description="Each, kg, litre, box — the label printed beside a quantity."
      path="/units"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'product:create', update: 'product:update', delete: 'product:delete' }}
      searchPlaceholder="Search units"
      paginated={false}
      invalidate={[queryKeys.units]}
      emptyTitle="No units yet"
      createLabel="New unit"
      columns={[
        {
          key: 'name',
          header: 'Unit',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
                <Ruler size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="truncate font-medium">{row.name}</span>
            </div>
          ),
        },
        {
          key: 'shortName',
          header: 'Abbreviation',
          value: (row) => row.shortName,
          width: '8rem',
          cell: (row) => <span className="tabular-nums">{row.shortName ?? '—'}</span>,
        },
        {
          key: 'precision',
          header: 'Decimals',
          align: 'end',
          value: (row) => row.precision ?? 0,
          width: '6rem',
          cell: (row) => <span className="tabular-nums">{row.precision ?? 0}</span>,
        },
        activeColumn<Unit>(),
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, section: 'Details', placeholder: 'e.g. Kilogram' },
        { name: 'shortName', label: 'Abbreviation', type: 'text', section: 'Details', placeholder: 'kg' },
        {
          name: 'precision',
          label: 'Decimal places',
          type: 'number',
          section: 'Details',
          defaultValue: 3,
          hint: 'Quantities are stored in thousandths regardless; this only controls display.',
        },
        { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Availability', defaultValue: true },
      ]}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        shortName: String(form.shortName ?? '').trim() || null,
        precision: Number(form.precision ?? 3),
        isActive: Boolean(form.isActive),
      })}
      fromRow={(row) => ({ name: row.name, shortName: row.shortName ?? '', precision: row.precision ?? 3, isActive: row.isActive !== false })}
    />
  );
}

export function TaxesPage() {
  const { business } = useAuth();

  const rateFields: CrudField[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, section: 'Tax', placeholder: 'e.g. VAT 17%' },
    { name: 'code', label: 'Code', type: 'text', section: 'Tax', placeholder: 'VAT17' },
    {
      name: 'rate',
      label: 'Rate (%)',
      type: 'number',
      required: true,
      section: 'Tax',
      hint: 'Percentage points, e.g. 17 for 17%. Zero is a valid rate for a non-taxable item.',
    },
    {
      name: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      section: 'Tax',
      defaultValue: 'PERCENTAGE',
      options: [
        { value: 'PERCENTAGE', label: 'Percentage' },
        { value: 'FIXED', label: 'Fixed amount per line' },
        { value: 'INCLUSIVE', label: 'Included in the price' },
        { value: 'EXCLUSIVE', label: 'Added on top of the price' },
      ],
    },
    {
      name: 'scope',
      label: 'Applies to',
      type: 'select',
      required: true,
      section: 'Tax',
      defaultValue: 'BOTH',
      options: [
        { value: 'BOTH', label: 'Sales and purchases' },
        { value: 'SALE', label: 'Sales only' },
        { value: 'PURCHASE', label: 'Purchases only' },
      ],
    },
    { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Availability', defaultValue: true },
    { name: 'isDefault', label: 'Apply by default', type: 'switch', full: true, section: 'Availability', hint: 'New products pick this tax unless another is chosen.' },
  ];

  return (
    <CrudPage<Tax>
      tableId="taxes"
      title="Taxes"
      description={`Applied to sales and purchases. Amounts are stored in ${business?.currency ?? 'the business currency'}.`}
      path="/taxes"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'tax:create', update: 'tax:update', delete: 'tax:delete' }}
      searchPlaceholder="Search taxes"
      paginated={false}
      currency={business?.currency ?? 'USD'}
      invalidate={[queryKeys.taxes]}
      emptyTitle="No taxes configured"
      emptyDescription="Without a tax, invoices total exactly what you charged. Add one before your first taxable sale."
      createLabel="New tax"
      columns={[
        {
          key: 'name',
          header: 'Tax',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              {row.code && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.code}</p>}
            </div>
          ),
        },
        {
          key: 'rate',
          header: 'Rate',
          align: 'end',
          value: (row) => row.rate ?? 0,
          width: '7rem',
          cell: (row) => <span className="font-medium tabular-nums">{(row.rate ?? 0).toFixed(2)}%</span>,
        },
        {
          key: 'type',
          header: 'Type',
          value: (row) => row.type ?? '',
          width: '9rem',
          cell: (row) => <span className="text-[var(--text-secondary)]">{(row.type ?? '—').replace('_', ' ')}</span>,
        },
        {
          key: 'scope',
          header: 'Applies to',
          value: (row) => row.scope ?? '',
          optional: true,
          cell: (row) => <span className="text-[var(--text-secondary)]">{(row.scope ?? '—').toLowerCase()}</span>,
        },
        {
          key: 'default',
          header: 'Default',
          align: 'center',
          value: (row) => (row.isDefault ? 1 : 0),
          width: '5rem',
          cell: (row) => (row.isDefault ? <StatusBadge status="ACTIVE" label="Default" /> : <span className="text-[var(--text-tertiary)]">—</span>),
        },
        activeColumn<Tax>(),
      ]}
      fields={rateFields}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        code: String(form.code ?? '').trim() || null,
        rate: Number(form.rate ?? 0),
        type: String(form.type ?? 'PERCENTAGE'),
        scope: String(form.scope ?? 'BOTH'),
        isActive: Boolean(form.isActive),
        isDefault: Boolean(form.isDefault),
      })}
      fromRow={(row) => ({
        name: row.name,
        code: row.code ?? '',
        rate: row.rate ?? 0,
        type: row.type ?? 'PERCENTAGE',
        scope: row.scope ?? 'BOTH',
        isActive: row.isActive !== false,
        isDefault: row.isDefault === true,
      })}
    />
  );
}

