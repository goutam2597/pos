import { useMemo, useState } from 'react';
import { ClipboardList, PackageCheck, RotateCcw, Wallet } from 'lucide-react';

import { date, dateTime, money } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiMutation,
  useApiQuery,
  type Expense,
  type Purchase,
  type ReturnOrder,
  type Supplier,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, FilterBar, FilterField, type Column } from '../components/data';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { MoneyInput } from '../components/ui/NumberInput';
import { Input, Textarea } from '../components/ui/Input';
import { FormDialog } from '../components/ui/Modal';
import { FormField } from '../components/ui/Form';
import { DateInput } from '../components/ui/SearchInput';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState } from './_shared';

/**
 * Buying: purchase orders, returns and expenses.
 *
 * These three sit together because they are the other side of the ledger from
 * sales — money out, stock in, and the paperwork that proves it. Receiving a
 * purchase is the action that matters most here: it is what actually moves
 * stock, so it is a first-class button rather than a status field.
 */

export function PurchasesPage() {
  const { api, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    status: '',
    supplierId: '',
    from: isoDaysAgo(90),
    to: todayIso(),
  });
  const [receiveTarget, setReceiveTarget] = useState<Purchase | null>(null);

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      status: query.status || undefined,
      supplierId: query.supplierId || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<Purchase>(queryKeys.purchases(params), '/purchases', params);
  const suppliers = useApiQuery<Supplier[]>(
    queryKeys.suppliers({}),
    (signal) => api.data<Supplier[]>('/suppliers', { signal }),
    { staleTime: 5 * 60_000 },
  );

  const receive = useApiMutation<{ id: string }, unknown>({
    invalidate: [queryKeys.purchases({}), ['inventory'], ['sales']],
    mutationFn: ({ id }) => api.post(`/purchases/${id}/receive`),
    successMessage: 'Purchase received — stock and the ledger are updated',
    onSuccess: () => setReceiveTarget(null),
  });

  const columns: Column<Purchase>[] = [
    {
      key: 'number',
      header: 'Purchase',
      value: (row) => row.number,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <ClipboardList size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.number}</p>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">{date(row.orderDate)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      value: (row) => row.supplierName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.supplierName ?? '—'}</span>,
    },
    {
      key: 'expected',
      header: 'Expected',
      value: (row) => row.expectedDate,
      optional: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{date(row.expectedDate)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'end',
      value: (row) => row.total ?? 0,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.total ?? 0)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '8rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '8rem',
      cell: (row) =>
        can('purchase:update') && (row.status === 'ORDERED' || row.status === 'PENDING' || row.status === 'DRAFT') ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<PackageCheck size={15} strokeWidth={1.75} />}
            onClick={() => setReceiveTarget(row)}
          >
            Receive
          </Button>
        ) : (
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {row.receivedAt ? `Received ${date(row.receivedAt)}` : '—'}
          </span>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader title="Purchases" description="Orders placed with suppliers and what has actually arrived." />

      <DataTable
        tableId="purchases"
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
        exportName="purchases"
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-2">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search purchase number" />
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
          <>
            <FilterField>
              <Select
                label="Status"
                placeholder="Any status"
                value={query.status}
                onChange={(event) => patch({ status: event.target.value })}
                options={['DRAFT', 'ORDERED', 'PART_RECEIVED', 'RECEIVED', 'CANCELLED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
            <FilterField width="w-[12rem]">
              <Select
                label="Supplier"
                placeholder="All suppliers"
                value={query.supplierId}
                onChange={(event) => patch({ supplierId: event.target.value })}
                options={(suppliers.data ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No purchases in this period"
      />

      <FormDialog
        open={receiveTarget !== null}
        onClose={() => setReceiveTarget(null)}
        title={receiveTarget ? `Receive ${receiveTarget.number}` : ''}
        description="Receiving increases stock, records the supplier bill and posts the journal entry."
        submitLabel="Receive stock"
        onSubmit={() => receiveTarget && receive.mutate({ id: receiveTarget.id })}
        submitting={receive.isPending}
        size="sm"
      >
        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {receiveTarget?.supplierName ?? 'This supplier'} · {money(receiveTarget?.total ?? 0)}
        </p>
      </FormDialog>
    </Page>
  );
}

export function ReturnsPage() {
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    type: '',
    status: '',
    from: isoDaysAgo(90),
    to: todayIso(),
  });

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      type: query.type || undefined,
      status: query.status || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<ReturnOrder>(queryKeys.returns(params), '/returns', params);

  const columns: Column<ReturnOrder>[] = [
    {
      key: 'number',
      header: 'Return',
      value: (row) => row.number,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.number}</p>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">{date(row.returnDate ?? row.createdAt)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Direction',
      value: (row) => row.type,
      width: '11rem',
      cell: (row) => (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {row.type === 'SALE_RETURN' ? 'Customer returned goods' : 'We returned goods'}
        </span>
      ),
    },
    {
      key: 'party',
      header: 'Party',
      value: (row) => row.partyName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.partyName ?? '—'}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      optional: true,
      value: (row) => row.reason,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.reason ?? '—'}</span>,
    },
    {
      key: 'total',
      header: 'Value',
      align: 'end',
      value: (row) => row.total ?? 0,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.total ?? 0)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '8rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <Page>
      <PageHeader title="Returns" description="Goods coming back in, and goods going back out." />

      <DataTable
        tableId="returns"
        columns={columns}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 25, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page) => patch({ page })}
        onPageSizeChange={(pageSize) => patch({ pageSize })}
        exportName="returns"
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-2">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search return number" />
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
          <>
            <FilterField>
              <Select
                label="Direction"
                placeholder="Both"
                value={query.type}
                onChange={(event) => patch({ type: event.target.value })}
                options={[
                  { value: 'SALE_RETURN', label: 'Customer returned goods' },
                  { value: 'PURCHASE_RETURN', label: 'We returned goods' },
                ]}
              />
            </FilterField>
            <FilterField>
              <Select
                label="Status"
                placeholder="Any status"
                value={query.status}
                onChange={(event) => patch({ status: event.target.value })}
                options={['REQUESTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No returns in this period"
      />
    </Page>
  );
}

const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Supplies',
  'Transport',
  'Maintenance',
  'Marketing',
  'Bank charges',
  'Software',
  'Other',
];

export function ExpensesPage() {
  const { api, business, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    status: '',
    category: '',
    from: isoDaysAgo(90),
    to: todayIso(),
  });
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<Expense | null>(null);

  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0] ?? 'Other');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [notes, setNotes] = useState('');

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      status: query.status || undefined,
      category: query.category || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<Expense>(queryKeys.expenses(params), '/expenses', params);

  const create = useApiMutation<Record<string, unknown>, unknown>({
    invalidate: [queryKeys.expenses({}), ['expenses'], ['accounting']],
    mutationFn: (body) => api.post('/expenses', body),
    successMessage: 'Expense submitted for approval',
    onSuccess: () => setCreating(false),
  });

  const approve = useApiMutation<{ id: string }, unknown>({
    invalidate: [queryKeys.expenses({}), ['expenses'], ['accounting']],
    mutationFn: ({ id }) => api.post(`/expenses/${id}/approve`),
    successMessage: 'Expense approved and posted to the ledger',
    onSuccess: () => setApproving(null),
  });

  const submitExpense = () => {
    create.mutate({
      category,
      description: description.trim() || undefined,
      vendor: vendor.trim() || undefined,
      amount,
      expenseDate,
      notes: notes.trim() || undefined,
    });
  };

  const columns: Column<Expense>[] = [
    {
      key: 'description',
      header: 'Expense',
      value: (row) => row.description ?? row.category,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <Wallet size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.description ?? row.category ?? 'Expense'}</p>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">
              {[row.category, row.vendor].filter(Boolean).join(' · ') || 'No category'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      value: (row) => row.expenseDate,
      width: '7rem',
      cell: (row) => <span className="text-[var(--text-secondary)]">{date(row.expenseDate ?? row.createdAt)}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      value: (row) => row.branchName,
      optional: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.branchName ?? '—'}</span>,
    },
    {
      key: 'user',
      header: 'Submitted by',
      optional: true,
      value: (row) => row.userName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.userName ?? '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'end',
      value: (row) => row.total ?? row.amount,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.total ?? row.amount)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '8rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '7rem',
      cell: (row) =>
        can('expense:approve') && (row.status === 'SUBMITTED' || row.status === 'DRAFT') ? (
          <Button variant="secondary" size="sm" onClick={() => setApproving(row)}>
            Approve
          </Button>
        ) : null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Expenses"
        description="Money spent running the business. Nothing reaches the ledger until it is approved."
        actions={
          can('expense:create') ? (
            <Button
              variant="primary"
              onClick={() => {
                setAmount(0);
                setCategory(EXPENSE_CATEGORIES[0] ?? 'Other');
                setDescription('');
                setVendor('');
                setExpenseDate(todayIso());
                setNotes('');
                setCreating(true);
              }}
            >
              New expense
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="expenses"
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
        exportName="expenses"
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-2">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search description or vendor" />
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
          <>
            <FilterField>
              <Select
                label="Status"
                placeholder="Any status"
                value={query.status}
                onChange={(event) => patch({ status: event.target.value })}
                options={['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
            <FilterField width="w-[11rem]">
              <Select
                label="Category"
                placeholder="All categories"
                value={query.category}
                onChange={(event) => patch({ category: event.target.value })}
                options={EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No expenses recorded"
        emptyDescription="Record rent, utilities and wages here so the profit figure is honest."
      />

      <FormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New expense"
        description="Submitted expenses need approval before they affect the ledger."
        onSubmit={submitExpense}
        submitting={create.isPending}
      >
        <div className="space-y-4">
          <FormField label="Amount" required>
            {(id) => <MoneyInput id={id} value={amount} onValueChange={setAmount} currency={business?.currency ?? 'USD'} />}
          </FormField>
          <FormField label="Category" required>
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                options={EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))}
              />
            )}
          </FormField>
          <FormField label="Description">
            {(id) => (
              <Input id={id} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. March rent" />
            )}
          </FormField>
          <FormField label="Paid to">
            {(id) => <Input id={id} value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Landlord, supplier…" />}
          </FormField>
          <FormField label="Date" required>
            {(id) => <DateInput id={id} value={expenseDate} onValueChange={setExpenseDate} />}
          </FormField>
          <FormField label="Notes">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}
          </FormField>
        </div>
      </FormDialog>

      <FormDialog
        open={approving !== null}
        onClose={() => setApproving(null)}
        title="Approve expense"
        description={approving ? `${approving.description ?? approving.category} · ${money(approving.total ?? approving.amount)}` : ''}
        submitLabel="Approve and post"
        onSubmit={() => approving && approve.mutate({ id: approving.id })}
        submitting={approve.isPending}
        size="sm"
      >
        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Approving posts this to the expense account in the ledger. It cannot be undone from here — reverse it
          with a journal entry.
        </p>
        <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">Submitted {dateTime(approving?.createdAt)}</p>
      </FormDialog>
    </Page>
  );
}

