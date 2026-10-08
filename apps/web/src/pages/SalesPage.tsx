import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Receipt, RotateCcw } from 'lucide-react';

import { money, dateTime } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiMutation,
  type Sale,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, FilterBar, FilterField, type Column } from '../components/data';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { FormDialog } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { MoneyInput } from '../components/ui/NumberInput';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState } from './_shared';

/**
 * Sales register.
 *
 * Read-only by design: a sale is a posted accounting fact. Changing it is done
 * by voiding or refunding, both of which leave an audit trail, rather than by
 * editing the row — which is the difference between a ledger you can trust and
 * one you cannot.
 */
export function SalesPage() {
  const { api, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    status: '',
    channel: '',
    from: isoDaysAgo(30),
    to: todayIso(),
  });
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      status: query.status || undefined,
      channel: query.channel || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<Sale>(queryKeys.sales(params), '/sales', params);

  const voidSale = useApiMutation<{ id: string; reason: string }, unknown>({
    invalidate: [queryKeys.sales({}), ['sales'], ['accounting']],
    mutationFn: ({ id, reason: why }) => api.post(`/sales/${id}/void`, { reason: why }),
    successMessage: 'Sale voided',
    onSuccess: () => {
      setVoidTarget(null);
      setReason('');
    },
  });

  const refundSale = useApiMutation<{ id: string; amount: number; method: string; reason: string }, unknown>({
    invalidate: [queryKeys.sales({}), ['sales'], ['accounting']],
    mutationFn: ({ id, amount, method, reason: why }) =>
      api.post(`/sales/${id}/refund`, { amount, method, reason: why }),
    successMessage: 'Refund recorded',
    onSuccess: () => {
      setRefundTarget(null);
      setReason('');
    },
  });

  const columns: Column<Sale>[] = [
    {
      key: 'number',
      header: 'Sale',
      value: (row) => row.number,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <Receipt size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link to={`/sales/${row.id}`} className="block truncate font-medium hover:underline">
              {row.number}
            </Link>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">{dateTime(row.createdAt)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      value: (row) => row.customerName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.customerName ?? 'Walk-in'}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      value: (row) => row.branchName,
      optional: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.branchName ?? '—'}</span>,
    },
    {
      key: 'channel',
      header: 'Channel',
      value: (row) => row.channel,
      width: '7rem',
      optional: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{(row.channel ?? '—').toLowerCase()}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'end',
      value: (row) => row.total,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '7rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '9rem',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Link to={`/sales/${row.id}`}>
            <Button variant="ghost" size="sm">
              View
            </Button>
          </Link>
          {can('sale:create') && (row.status === 'COMPLETED' || row.status === 'PARTIAL') && (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={`Refund ${row.number}`}
                onClick={() => setRefundTarget(row)}
              >
                <RotateCcw size={15} strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={`Void ${row.number}`}
                className="text-[var(--danger-text)]"
                onClick={() => setVoidTarget(row)}
              >
                <Ban size={15} strokeWidth={1.75} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Sales"
        description="Every posted sale across all branches. Void and refund actions keep the audit trail intact."
        actions={
          <Link to="/pos">
            <Button variant="primary">Open till</Button>
          </Link>
        }
      />

      <DataTable
        tableId="sales"
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
        exportName="sales"
        toolbar={
          <div className="flex items-end gap-2.5">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search sale number or customer" />
            </FilterBar>
            <DateRangePicker
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
                options={['COMPLETED', 'PARTIAL', 'REFUNDED', 'RETURNED', 'VOIDED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
            <FilterField>
              <Select
                label="Channel"
                placeholder="Any channel"
                value={query.channel}
                onChange={(event) => patch({ channel: event.target.value })}
                options={['POS', 'ONLINE', 'PHONE', 'MANUAL', 'OFFLINE', 'API'].map((value) => ({ value, label: value.toLowerCase() }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No sales in this period"
        emptyDescription="Widen the date range, or ring up a sale at the till."
      />

      <VoidDialog
        sale={voidTarget}
        reason={reason}
        onReason={setReason}
        onClose={() => {
          setVoidTarget(null);
          setReason('');
        }}
        onConfirm={() => voidTarget && voidSale.mutate({ id: voidTarget.id, reason: reason.trim() || 'No reason given' })}
        pending={voidSale.isPending}
      />

      <RefundDialog
        sale={refundTarget}
        reason={reason}
        onReason={setReason}
        onClose={() => {
          setRefundTarget(null);
          setReason('');
        }}
        onConfirm={(amount, method) =>
          refundTarget &&
          refundSale.mutate({ id: refundTarget.id, amount, method, reason: reason.trim() || 'No reason given' })
        }
        pending={refundSale.isPending}
      />
    </Page>
  );
}


function VoidDialog({
  sale,
  reason,
  onReason,
  onClose,
  onConfirm,
  pending,
}: {
  sale: Sale | null;
  reason: string;
  onReason: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const { can } = useAuth();
  if (!sale || !can('sale:delete')) return null;

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Void sale ${sale.number}?`}
      description={`${money(sale.total)} goes back to the customer and the stock is released.`}
      submitLabel="Void sale"
      onSubmit={onConfirm}
      submitting={pending}
      size="sm"
    >
      <Input
        label="Reason"
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        placeholder="Why is this being voided?"
        hint="Recorded in the audit log and on the reversing journal entry."
        autoFocus
      />
    </FormDialog>
  );
}

function RefundDialog({
  sale,
  reason,
  onReason,
  onClose,
  onConfirm,
  pending,
}: {
  sale: Sale | null;
  reason: string;
  onReason: (value: string) => void;
  onClose: () => void;
  onConfirm: (amount: number, method: string) => void;
  pending: boolean;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState('CASH');
  if (!sale) return null;

  const paid = sale.paid ?? sale.total;
  const resolvedAmount = amount ?? paid;

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Refund sale ${sale.number}`}
      description={`Paid ${money(paid)}. A refund returns the stock and posts a reversing entry.`}
      submitLabel="Record refund"
      onSubmit={() => onConfirm(resolvedAmount, method)}
      submitting={pending}
      size="sm"
    >
      <div className="space-y-4">
        <MoneyInput
          label="Refund amount"
          value={resolvedAmount}
          onValueChange={setAmount}
          max={paid}
          hint={`Cannot exceed the ${money(paid)} taken.`}
        />
        <Select
          label="Refund method"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          options={['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'GIFT_CARD'].map((value) => ({
            value,
            label: value.replace('_', ' ').toLowerCase(),
          }))}
        />
        <Input
          label="Reason"
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          placeholder="Why is this being refunded?"
          autoFocus
        />
      </div>
    </FormDialog>
  );
}
