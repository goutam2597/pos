import { Truck } from 'lucide-react';

import { date, money } from '../lib/format';
import { activeStatusColumn, CrudPage } from '../components/data';
import { Avatar } from '../components/ui/Avatar';
import { ActiveBadge, Badge, StatusBadge } from '../components/ui/Badge';
import { queryKeys, type Customer, type Employee, type Supplier } from '../lib/queries';
/**
 * People and organisations: customers, suppliers and employees.

 *
 * These three carry balances and credit limits, which is why their money columns
 * are signed and coloured — an owner scanning a receivables list needs to see
 * the direction of every number without reading the sign.
 */

const AVATAR_TONES = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-6)', 'var(--chart-7)'];

function toneFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? 'var(--chart-1)';
}

export function CustomersPage() {
  return (
    <CrudPage<Customer>
      tableId="customers"
      title="Customers"
      description="People and businesses you sell to, and who owe you money."
      path="/customers"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'customer:create', update: 'customer:update', delete: 'customer:delete' }}
      searchPlaceholder="Search name, phone or email"
      emptyTitle="No customers yet"
      emptyDescription="Customers are optional at the till — add them when someone needs a credit account or a statement."
      createLabel="New customer"
      invalidate={[queryKeys.customers({}), ['customers']]}
      columns={[
        {
          key: 'name',
          header: 'Customer',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-[var(--accent-contrast)]"
                style={{ backgroundColor: toneFor(row.id) }}
              >
                {row.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate text-[12px] text-[var(--text-tertiary)]">
                  {[row.phone, row.email].filter(Boolean).join(' · ') || 'No contact details'}
                </p>
              </div>
            </div>
          ),
        },
        {
          key: 'tier',
          header: 'Tier',
          value: (row) => row.tier,
          width: '8rem',
          cell: (row) => (row.tier ? <Badge tone="brand">{row.tier.replace('_', ' ')}</Badge> : <span className="text-[var(--text-tertiary)]">Retail</span>),
        },
        {
          key: 'balance',
          header: 'Balance',
          align: 'end',
          value: (row) => row.balance ?? 0,
          cell: (row) => (
            <span className={row.balance && row.balance > 0 ? 'font-medium text-[var(--danger-text)]' : 'tabular-nums'}>
              {formatSigned(row.balance)}
            </span>
          ),
        },
        {
          key: 'creditLimit',
          header: 'Credit limit',
          align: 'end',
          optional: true,
          value: (row) => row.creditLimit ?? null,
          cell: (row) => (row.creditLimit ? formatSigned(row.creditLimit) : '—'),
        },
        {
          key: 'status',
          header: 'Status',
          value: (row) => row.status ?? 'ACTIVE',
          width: '7rem',
          cell: (row) => <StatusBadge status={row.status ?? 'ACTIVE'} />,
        },
        {
          key: 'createdAt',
          header: 'Added',
          optional: true,
          value: (row) => row.createdAt,
          cell: (row) => <span className="text-[var(--text-secondary)]">{date(row.createdAt)}</span>,
        },
      ]}
      filterFields={[
        {
          name: 'tier',
          label: 'Tier',
          options: ['RETAIL', 'WHOLESALE', 'VIP', 'DISTRIBUTOR'].map((value) => ({ value, label: value.replace('_', ' ') })),
        },
        {
          name: 'status',
          label: 'Status',
          options: ['ACTIVE', 'INACTIVE', 'BLOCKED'].map((value) => ({ value, label: value.replace('_', ' ') })),
        },
        { name: 'hasBalance', label: 'Balance', options: [{ value: 'true', label: 'Owes money' }] },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, section: 'Identity', placeholder: 'e.g. Walk-in customer or ACME Ltd' },
        {
          name: 'tier',
          label: 'Tier',
          type: 'select',
          section: 'Identity',
          defaultValue: 'RETAIL',
          options: [
            { value: 'RETAIL', label: 'Retail' },
            { value: 'WHOLESALE', label: 'Wholesale' },
            { value: 'VIP', label: 'VIP' },
            { value: 'DISTRIBUTOR', label: 'Distributor' },
          ],
        },
        { name: 'phone', label: 'Phone', type: 'tel', section: 'Contact' },
        { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
        { name: 'address', label: 'Address', type: 'text', section: 'Contact', full: true },
        { name: 'city', label: 'City', type: 'text', section: 'Contact' },
        { name: 'country', label: 'Country', type: 'text', section: 'Contact' },
        { name: 'taxNumber', label: 'Tax number', type: 'text', section: 'Contact', hint: 'Printed on invoices when present.' },
        { name: 'creditLimit', label: 'Credit limit', type: 'money', section: 'Credit', hint: 'Leave at zero for no limit. The till warns when an order passes this.' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          section: 'Credit',
          defaultValue: 'ACTIVE',
          options: [
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
            { value: 'BLOCKED', label: 'Blocked — cannot buy on credit' },
          ],
        },
        { name: 'notes', label: 'Notes', type: 'textarea', section: 'Credit', full: true },
      ]}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        tier: String(form.tier ?? 'RETAIL'),
        phone: String(form.phone ?? '').trim() || null,
        email: String(form.email ?? '').trim() || null,
        address: String(form.address ?? '').trim() || null,
        city: String(form.city ?? '').trim() || null,
        country: String(form.country ?? '').trim() || null,
        taxNumber: String(form.taxNumber ?? '').trim() || null,
        creditLimit: Number(form.creditLimit ?? 0),
        status: String(form.status ?? 'ACTIVE'),
        notes: String(form.notes ?? '').trim() || null,
      })}
      fromRow={(row) => ({
        name: row.name,
        tier: row.tier ?? 'RETAIL',
        phone: row.phone ?? '',
        email: row.email ?? '',
        address: row.address ?? '',
        city: row.city ?? '',
        country: row.country ?? '',
        taxNumber: row.taxNumber ?? '',
        creditLimit: row.creditLimit ?? 0,
        status: row.status ?? 'ACTIVE',
        notes: row.notes ?? '',
      })}
    />
  );
}

export function SuppliersPage() {
  return (
    <CrudPage<Supplier>
      tableId="suppliers"
      title="Suppliers"
      description="Who you buy from, and what you owe them."
      path="/suppliers"
      getRowId={(row) => row.id}
      entityName={(row) => row.name}
      permissions={{ create: 'supplier:create', update: 'supplier:update', delete: 'supplier:delete' }}
      searchPlaceholder="Search name, phone or email"
      emptyTitle="No suppliers yet"
      createLabel="New supplier"
      invalidate={[queryKeys.suppliers({}), ['suppliers']]}
      columns={[
        {
          key: 'name',
          header: 'Supplier',
          value: (row) => row.name,
          sticky: true,
          cell: (row) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
                <Truck size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate text-[12px] text-[var(--text-tertiary)]">
                  {[row.phone, row.email].filter(Boolean).join(' · ') || 'No contact details'}
                </p>
              </div>
            </div>
          ),
        },
        {
          key: 'preferred',
          header: '',
          width: '6rem',
          value: (row) => (row.isPreferred ? 1 : 0),
          cell: (row) => (row.isPreferred ? <Badge tone="brand">Preferred</Badge> : <span className="text-[var(--text-tertiary)]">—</span>),
        },
        {
          key: 'balance',
          header: 'You owe',
          align: 'end',
          value: (row) => row.balance ?? 0,
          cell: (row) => <span className="tabular-nums">{formatSigned(row.balance)}</span>,
        },
        {
          key: 'taxNumber',
          header: 'Tax number',
          optional: true,
          value: (row) => row.taxNumber,
          cell: (row) => <span className="text-[var(--text-secondary)]">{row.taxNumber ?? '—'}</span>,
        },
        activeStatusColumn<Supplier>(),
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, section: 'Identity', placeholder: 'e.g. Northwind Traders' },
        { name: 'phone', label: 'Phone', type: 'tel', section: 'Contact' },
        { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
        { name: 'address', label: 'Address', type: 'text', section: 'Contact', full: true },
        { name: 'taxNumber', label: 'Tax number', type: 'text', section: 'Contact' },
        { name: 'isPreferred', label: 'Preferred supplier', type: 'switch', full: true, section: 'Defaults', hint: 'Shows first when creating a purchase order.' },
        { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Defaults', defaultValue: true },
        { name: 'notes', label: 'Notes', type: 'textarea', section: 'Defaults', full: true },
      ]}
      toBody={(form) => ({
        name: String(form.name ?? '').trim(),
        phone: String(form.phone ?? '').trim() || null,
        email: String(form.email ?? '').trim() || null,
        address: String(form.address ?? '').trim() || null,
        taxNumber: String(form.taxNumber ?? '').trim() || null,
        isPreferred: Boolean(form.isPreferred),
        isActive: Boolean(form.isActive),
        notes: String(form.notes ?? '').trim() || null,
      })}
      fromRow={(row) => ({
        name: row.name,
        phone: row.phone ?? '',
        email: row.email ?? '',
        address: row.address ?? '',
        taxNumber: row.taxNumber ?? '',
        isPreferred: row.isPreferred === true,
        isActive: row.isActive !== false,
        notes: row.notes ?? '',
      })}
    />
  );
}

export function EmployeesPage() {
  return (
    <CrudPage<Employee>
      tableId="employees"
      title="Employees"
      description="Who works here, which role they hold and which branch they are at."
      path="/employees"
      getRowId={(row) => row.id}
      entityName={(row) => employeeName(row)}
      permissions={{ create: 'employee:create', update: 'employee:update', delete: 'employee:delete' }}
      searchPlaceholder="Search name or email"
      emptyTitle="No employees yet"
      createLabel="New employee"
      invalidate={[queryKeys.employees({}), ['employees']]}
      columns={[
        {
          key: 'name',
          header: 'Employee',
          value: (row) => employeeName(row),
          sticky: true,
          cell: (row) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={employeeName(row)} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium">{employeeName(row)}</p>
                <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.email ?? 'No email'}</p>
              </div>
            </div>
          ),
        },
        {
          key: 'role',
          header: 'Role',
          value: (row) => row.roleName,
          cell: (row) => row.roleName ? <Badge tone="brand">{row.roleName}</Badge> : <span className="text-[var(--text-tertiary)]">—</span>,
        },
        {
          key: 'branch',
          header: 'Branch',
          value: (row) => row.branchName,
          cell: (row) => <span className="text-[var(--text-secondary)]">{row.branchName ?? 'All branches'}</span>,
        },
        {
          key: 'phone',
          header: 'Phone',
          optional: true,
          value: (row) => row.phone,
          cell: (row) => <span className="text-[var(--text-secondary)]">{row.phone ?? '—'}</span>,
        },
        {
          key: 'hiredAt',
          header: 'Joined',
          optional: true,
          value: (row) => row.hiredAt,
          cell: (row) => <span className="text-[var(--text-secondary)]">{date(row.hiredAt)}</span>,
        },
        {
          key: 'status',
          header: 'Status',
          value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
          width: '7rem',
          cell: (row) => <ActiveBadge isActive={row.isActive} />,
        },
      ]}
      filterFields={[{ name: 'isActive', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }]}
      fields={[
        { name: 'firstName', label: 'First name', type: 'text', required: true, section: 'Identity' },
        { name: 'lastName', label: 'Last name', type: 'text', section: 'Identity' },
        { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
        { name: 'phone', label: 'Phone', type: 'tel', section: 'Contact' },
        { name: 'hiredAt', label: 'Start date', type: 'date', section: 'Contact' },
        { name: 'roleId', label: 'Role', type: 'select', section: 'Assignment', placeholder: 'None' },
        { name: 'branchId', label: 'Branch', type: 'select', section: 'Assignment', placeholder: 'All branches' },
        { name: 'isActive', label: 'Active', type: 'switch', full: true, section: 'Assignment', defaultValue: true, hint: 'Inactive employees stay in reports but cannot sign in.' },
      ]}
      toBody={(form) => ({
        firstName: String(form.firstName ?? '').trim(),
        lastName: String(form.lastName ?? '').trim() || null,
        email: String(form.email ?? '').trim() || null,
        phone: String(form.phone ?? '').trim() || null,
        hiredAt: String(form.hiredAt ?? '') || null,
        roleId: form.roleId ? String(form.roleId) : null,
        branchId: form.branchId ? String(form.branchId) : null,
        isActive: Boolean(form.isActive),
      })}
      fromRow={(row) => ({
        firstName: row.firstName,
        lastName: row.lastName ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        hiredAt: row.hiredAt ? row.hiredAt.slice(0, 10) : '',
        roleId: row.roleId ?? '',
        branchId: row.branchId ?? '',
        isActive: row.isActive !== false,
      })}
    />
  );
}

function employeeName(row: Employee): string {
  return row.fullName ?? ([row.firstName, row.lastName].filter(Boolean).join(' ') || row.email || 'Employee');
}

/**
 * Money with an explicit debit/credit suffix.
 *
 * A balance column that only shows a sign leaves the reader doing arithmetic to
 * work out who owes whom. `DR` means they owe you, `CR` means you owe them —
 * the accounting convention every bookkeeper already reads fluently.
 */
function formatSigned(minor?: number | null): string {
  if (minor === undefined || minor === null) return '—';
  const formatted = money(minor);
  if (minor > 0) return `${formatted} DR`;
  if (minor < 0) return `${formatted} CR`;
  return formatted;
}
