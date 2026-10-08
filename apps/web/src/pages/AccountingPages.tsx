import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { cn } from '../lib/cn';
import { date, money } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiMutation,
  useApiQuery,
  type Account,
  type JournalEntry,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, FilterBar, FilterField, type Column } from '../components/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/data/Table';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { FormDialog, Modal } from '../components/ui/Modal';
import { FormField, FormGrid, FormSection } from '../components/ui/Form';
import { Input, Textarea } from '../components/ui/Input';
import { MoneyInput } from '../components/ui/NumberInput';
import { Alert } from '../components/ui/Feedback';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState } from './_shared';

/**
 * Accounting.
 *
 * The five screens a bookkeeper actually needs: the chart of accounts, the
 * journal, a trial balance, a profit and loss, and any single account's
 * ledger. Everything here is read-mostly — the ledger is corrected by posting a
 * reversing entry, never by editing history, and the UI says so rather than
 * hiding the rule.
 */

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;

export function AccountsPage() {
  const { api, can } = useAuth();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', type: 'ASSET', subtype: '', description: '', isActive: true });

  const accounts = useApiQuery<Account[]>(
    queryKeys.accounts,
    (signal) => api.data<Account[]>('/accounting/accounts', { signal }),
    { staleTime: 10 * 60_000 },
  );

  const create = useApiMutation<Record<string, unknown>, unknown>({
    invalidate: [queryKeys.accounts],
    mutationFn: (body) => api.post('/accounting/accounts', body),
    successMessage: 'Account created',
    onSuccess: () => setCreating(false),
  });

  const filtered = (accounts.data ?? []).filter((account) => {
    if (type && account.type !== type) return false;
    if (!search) return true;
    const haystack = `${account.code} ${account.name} ${account.subtype ?? ''}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const columns: Column<Account>[] = [
    {
      key: 'code',
      header: 'Code',
      value: (row) => row.code,
      width: '7rem',
      sticky: true,
      cell: (row) => <span className="font-mono text-[13px]">{row.code}</span>,
    },
    {
      key: 'name',
      header: 'Account',
      value: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.subtype && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.subtype.replace(/_/g, ' ').toLowerCase()}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      value: (row) => row.type,
      width: '8rem',
      cell: (row) => <span className="text-[12px] text-[var(--text-secondary)]">{row.type.charAt(0) + row.type.slice(1).toLowerCase()}</span>,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'end',
      value: (row) => row.balance ?? 0,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.balance ?? 0)}</span>,
    },
    {
      key: 'status',
      header: '',
      width: '6rem',
      value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      cell: (row) =>
        row.isSystem ? (
          <span className="text-[12px] text-[var(--text-tertiary)]">System</span>
        ) : row.isActive === false ? (
          <StatusBadge status="INACTIVE" />
        ) : null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Chart of accounts"
        description="Where every amount in the business is recorded. System accounts cannot be deleted."
        actions={
          can('account:create') ? (
            <Button
              variant="primary"
              icon={<Plus size={16} strokeWidth={1.75} />}
              onClick={() => {
                setForm({ code: '', name: '', type: 'ASSET', subtype: '', description: '', isActive: true });
                setCreating(true);
              }}
            >
              New account
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="accounts"
        columns={columns}
        rows={filtered}
        meta={{ total: filtered.length, page: 1, pageSize: filtered.length || 1, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={accounts.isPending}
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
        exportName="chart-of-accounts"
        toolbar={
          <FilterBar className="w-full">
            <SearchInput value={search} onValueChange={setSearch} placeholder="Search code or account name" />
          </FilterBar>
        }
        filters={
          <FilterField>
            <Select
              label="Type"
              placeholder="All types"
              value={type}
              onChange={(event) => setType(event.target.value)}
              options={ACCOUNT_TYPES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))}
            />
          </FilterField>
        }
        emptyTitle={accounts.data ? 'No accounts match' : 'No accounts yet'}
        emptyDescription={accounts.data ? 'Try a different code or clear the filters.' : undefined}
      />

      <FormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New account"
        submitLabel="Create account"
        onSubmit={() =>
          create.mutate({
            code: form.code.trim(),
            name: form.name.trim(),
            type: form.type,
            subtype: form.subtype.trim() || null,
            description: form.description.trim() || null,
            isActive: form.isActive,
          })
        }
        submitting={create.isPending}
      >
        <FormGrid>
          <FormField label="Code" required hint="Must be unique. Use the convention your accountant expects.">
            {(id) => <Input id={id} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="1200" />}
          </FormField>
          <FormField label="Account name" required>
            {(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Inventory" />}
          </FormField>
          <FormField label="Type" required>
            {(id) => (
              <Select
                id={id}
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                options={ACCOUNT_TYPES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))}
              />
            )}
          </FormField>
          <FormField label="Subtype">
            {(id) => <Input id={id} value={form.subtype} onChange={(event) => setForm({ ...form, subtype: event.target.value })} placeholder="INVENTORY" />}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">
              {(id) => (
                <Textarea id={id} rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              )}
            </FormField>
          </div>
        </FormGrid>
      </FormDialog>
    </Page>
  );
}

interface JournalDetail extends JournalEntry {
  lines?: Array<{ id: string; accountId: string; accountCode?: string | null; accountName?: string | null; debit: number; credit: number; memo?: string | null }>;
}

export function JournalPage() {
  const { api, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    source: '',
    status: '',
    from: isoDaysAgo(30),
    to: todayIso(),
  });
  const [selected, setSelected] = useState<JournalDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [memo, setMemo] = useState('');
  const [entryDate, setEntryDate] = useState(todayIso());
  const [draftLines, setDraftLines] = useState<Array<{ accountId: string; debit: number; credit: number; memo: string }>>([
    { accountId: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', debit: 0, credit: 0, memo: '' },
  ]);

  const accounts = useApiQuery<Account[]>(
    queryKeys.accounts,
    (signal) => api.data<Account[]>('/accounting/accounts', { signal }),
    { staleTime: 10 * 60_000 },
  );

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      source: query.source || undefined,
      status: query.status || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<JournalDetail>(queryKeys.journal(params), '/accounting/journal', params);

  const detail = useApiQuery<JournalDetail>(
    ['journal-detail', selected?.id],
    (signal) => api.data<JournalDetail>(`/accounting/journal/${selected?.id}`, { signal }),
    { enabled: selected !== null },
  );

  const post = useApiMutation<Record<string, unknown>, unknown>({
    invalidate: [queryKeys.journal({}), ['accounting']],
    mutationFn: (body) => api.post('/accounting/journal', body),
    successMessage: 'Journal entry posted',
    onSuccess: () => setCreating(false),
  });

  const reverse = useApiMutation<{ id: string }, unknown>({
    invalidate: [queryKeys.journal({}), ['accounting']],
    mutationFn: ({ id }) => api.post(`/accounting/journal/${id}/reverse`),
    successMessage: 'Entry reversed — the original is untouched',
  });

  const draftDebit = draftLines.reduce((sum, line) => sum + line.debit, 0);
  const draftCredit = draftLines.reduce((sum, line) => sum + line.credit, 0);
  const balanced = draftDebit === draftCredit && draftDebit > 0;

  const columns: Column<JournalDetail>[] = [
    {
      key: 'number',
      header: 'Entry',
      value: (row) => row.number,
      width: '9rem',
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-medium">{row.number ?? '—'}</p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">{date(row.entryDate)}</p>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      value: (row) => row.source,
      width: '8rem',
      cell: (row) => <StatusBadge status={row.source} />,
    },
    {
      key: 'memo',
      header: 'Memo',
      value: (row) => row.memo,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.memo ?? row.reference ?? '—'}</p>
          {row.createdByName && <p className="truncate text-[12px] text-[var(--text-tertiary)]">by {row.createdByName}</p>}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'end',
      value: (row) => row.totalDebit ?? 0,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.totalDebit ?? 0)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '7rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Journal"
        description="Every double-entry posting, whether it came from a sale, a purchase or an adjustment."
        actions={
          can('journal:create') ? (
            <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setCreating(true)}>
              Manual entry
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="journal"
        columns={columns}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 25, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page) => patch({ page })}
        onPageSizeChange={(pageSize) => patch({ pageSize })}
        onRowClick={(row) => setSelected(row)}
        exportName="journal"
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-2">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search memo or reference" />
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
                label="Source"
                placeholder="Any source"
                value={query.source}
                onChange={(event) => patch({ source: event.target.value })}
                options={['MANUAL', 'SALE', 'PURCHASE', 'PAYMENT', 'EXPENSE', 'RETURN', 'REFUND', 'OPENING', 'CLOSING', 'STOCKTAKE'].map((value) => ({ value, label: value.toLowerCase() }))}
              />
            </FilterField>
            <FilterField width="w-[9rem]">
              <Select
                label="Status"
                placeholder="Any"
                value={query.status}
                onChange={(event) => patch({ status: event.target.value })}
                options={['DRAFT', 'POSTED', 'REVERSED'].map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No journal entries in this period"
      />

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={detail.data?.number ? `Entry ${detail.data.number}` : 'Journal entry'}
        description={detail.data ? `${date(detail.data.entryDate)} · ${detail.data.source ?? ''}` : undefined}
        size="lg"
        footer={
          selected && can('journal:update') && selected.status === 'POSTED' ? (
            <Button
              variant="danger"
              loading={reverse.isPending}
              onClick={() => reverse.mutate({ id: selected.id }, { onSuccess: () => setSelected(null) })}
            >
              Reverse entry
            </Button>
          ) : undefined
        }
      >
        {detail.isPending ? (
          <p className="text-[13px] text-[var(--text-tertiary)]">Loading lines…</p>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Account</TableHead>
                  <TableHead className="text-end">Debit</TableHead>
                  <TableHead className="text-end">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail.data?.lines ?? []).map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="font-mono text-[12px] text-[var(--text-tertiary)]">{line.accountCode}</span>{' '}
                      {line.accountName}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{line.debit ? money(line.debit) : '—'}</TableCell>
                    <TableCell className="text-end tabular-nums">{line.credit ? money(line.credit) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end">
              <p className="text-[13px] font-medium tabular-nums">
                {money(detail.data?.totalDebit ?? 0)}
              </p>
            </div>
            <Alert tone="neutral">
              Posted entries are never edited. To correct one, reverse it — the original stays in the ledger with a
              matching entry beside it, which is what an auditor expects to see.
            </Alert>
          </div>
        )}
      </Modal>

      <FormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Manual journal entry"
        description="Debits must equal credits before the entry can be posted."
        submitLabel="Post entry"
        onSubmit={() =>
          post.mutate({
            entryDate,
            memo: memo.trim() || undefined,
            source: 'MANUAL',
            lines: draftLines
              .filter((line) => line.accountId && (line.debit > 0 || line.credit > 0))
              .map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit, memo: line.memo.trim() || undefined })),
          })
        }
        submitting={post.isPending}
        disabled={!balanced}
        size="lg"
      >
        <div className="space-y-4">
          <FormGrid>
            <FormField label="Entry date" required>
              {(id) => (
                <Input id={id} type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
              )}
            </FormField>
            <FormField label="Memo">
              {(id) => <Input id={id} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="e.g. Write off damaged stock" />}
            </FormField>
          </FormGrid>

          <FormSection title="Lines">
            <div className="space-y-2">
              {draftLines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_9rem_9rem] items-end gap-2">
                  <Select
                    label={index === 0 ? 'Account' : undefined}
                    placeholder="Choose an account"
                    value={line.accountId}
                    onChange={(event) =>
                      setDraftLines((current) =>
                        current.map((entry, i) => (i === index ? { ...entry, accountId: event.target.value } : entry)),
                      )
                    }
                    options={(accounts.data ?? []).map((account) => ({
                      value: account.id,
                      label: `${account.code} — ${account.name}`,
                      group: account.type,
                    }))}
                  />
                  <MoneyInput
                    label={index === 0 ? 'Debit' : undefined}
                    size="sm"
                    value={line.debit}
                    onValueChange={(value) =>
                      setDraftLines((current) =>
                        current.map((entry, i) => (i === index ? { ...entry, debit: value, credit: value > 0 ? 0 : entry.credit } : entry)),
                      )
                    }
                  />
                  <MoneyInput
                    label={index === 0 ? 'Credit' : undefined}
                    size="sm"
                    value={line.credit}
                    onValueChange={(value) =>
                      setDraftLines((current) =>
                        current.map((entry, i) => (i === index ? { ...entry, credit: value, debit: value > 0 ? 0 : entry.debit } : entry)),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraftLines((current) => [...current, { accountId: '', debit: 0, credit: 0, memo: '' }])}
              >
                Add line
              </Button>
            </div>
          </FormSection>

          <div
            className={cn(
              'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-[13px]',
              balanced ? 'bg-[var(--success-subtle)] text-[var(--success-text)]' : 'bg-[var(--warning-subtle)] text-[var(--warning-text)]',
            )}
          >
            <span>Debits {money(draftDebit)} · Credits {money(draftCredit)}</span>
            <span className="font-medium">{balanced ? 'Balanced' : 'Out of balance'}</span>
          </div>
        </div>
      </FormDialog>
    </Page>
  );
}

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

export function TrialBalancePage() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());

  const { data, isPending, error } = useApiQuery<TrialBalanceRow[] | { rows?: TrialBalanceRow[] }>(
    queryKeys.trialBalance({ from, to }),
    (signal) => api.data<TrialBalanceRow[] | { rows?: TrialBalanceRow[] }>('/accounting/trial-balance', { signal, query: { from, to } }),
    { staleTime: 60_000 },
  );

  const rows = Array.isArray(data) ? data : ((data as { rows?: TrialBalanceRow[] } | undefined)?.rows ?? []);
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  const balanced = totalDebit === totalCredit;

  const columns: Column<TrialBalanceRow>[] = [
    { key: 'code', header: 'Code', value: (row) => row.code, width: '7rem', cell: (row) => <span className="font-mono text-[13px]">{row.code}</span> },
    { key: 'name', header: 'Account', value: (row) => row.name, sticky: true, cell: (row) => row.name },
    { key: 'type', header: 'Type', value: (row) => row.type, width: '8rem', cell: (row) => <span className="text-[12px] text-[var(--text-secondary)]">{row.type}</span> },
    { key: 'debit', header: 'Debit', align: 'end', value: (row) => row.debit, cell: (row) => <span className="tabular-nums">{row.debit ? money(row.debit) : '—'}</span> },
    { key: 'credit', header: 'Credit', align: 'end', value: (row) => row.credit, cell: (row) => <span className="tabular-nums">{row.credit ? money(row.credit) : '—'}</span> },
    {
      key: 'balance',
      header: 'Balance',
      align: 'end',
      value: (row) => row.balance,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.balance)}</span>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Trial balance"
        description="Debits must equal credits. If they do not, something was posted incorrectly."
        actions={
          <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
        }
      />

      {error && <Alert tone="danger">{error.message}</Alert>}

      <DataTable
        tableId="trial-balance"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.accountId ?? row.code}
        isLoading={isPending}
        exportName="trial-balance"
        emptyTitle="Nothing posted in this period"
        emptyDescription="Widen the date range to include a period with activity."
      />

      {rows.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] text-[var(--text-secondary)]">
                Total debits <span className="font-medium tabular-nums">{money(totalDebit)}</span> · Total credits{' '}
                <span className="font-medium tabular-nums">{money(totalCredit)}</span>
              </p>
            </div>
            <span
              className={cn(
                'rounded-[var(--radius-md)] px-2.5 py-1 text-[13px] font-medium',
                balanced ? 'bg-[var(--success-subtle)] text-[var(--success-text)]' : 'bg-[var(--danger-subtle)] text-[var(--danger-text)]',
              )}
            >
              {balanced ? 'Balanced' : `Out of balance by ${money(Math.abs(totalDebit - totalCredit))}`}
            </span>
          </div>
        </Card>
      )}
    </Page>
  );
}

interface ProfitLossNode {
  accountId?: string;
  code?: string;
  name: string;
  type?: string;
  amount?: number;
  children?: ProfitLossNode[];
}

export function ProfitLossPage() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());

  const { data, isPending, error } = useApiQuery<ProfitLossNode[] | { rows?: ProfitLossNode[]; revenue?: number; cost?: number; expenses?: number; netProfit?: number }>(
    queryKeys.profitLoss({ from, to }),
    (signal) => api.data('/accounting/profit-loss', { signal, query: { from, to } }),
    { staleTime: 60_000 },
  );

  const payload = (data ?? {}) as {
    rows?: ProfitLossNode[];
    revenue?: number;
    costOfGoodsSold?: number;
    expenses?: number;
    netProfit?: number;
  };

  const net = payload.netProfit;
  const margin = net !== undefined && payload.revenue ? (net / payload.revenue) * 100 : undefined;

  return (
    <Page>
      <PageHeader
        title="Profit and loss"
        description="What the business earned and what it cost, over the period you choose."
        actions={<DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />}
      />

      {error && <Alert tone="danger">{error.message}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <KpiBox label="Revenue" value={payload.revenue} />
        <KpiBox label="Cost of goods sold" value={payload.costOfGoodsSold} />
        <KpiBox
          label="Net profit"
          value={net}
          tone={net === undefined ? 'default' : net >= 0 ? 'success' : 'danger'}
          caption={margin === undefined ? undefined : `${margin.toFixed(1)}% margin`}
        />
      </div>

      <Card flush>
        <CardHeader title="Statement" description="Grouped by account, in the order an accountant expects." />
        {(payload.rows?.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-[var(--text-tertiary)]">
            Nothing was posted in this period.
          </p>
        ) : (
          <ProfitLossTree nodes={payload.rows ?? []} />
        )}
      </Card>
    </Page>
  );
}

function ProfitLossTree({ nodes, depth = 0 }: { nodes: ProfitLossNode[]; depth?: number }) {
  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {nodes.map((node) => (
        <li key={node.code ?? node.accountId ?? node.name}>
          <div
            className="flex items-center justify-between gap-3 px-4 py-2"
            style={depth > 0 ? { paddingInlineStart: `${1 + depth}rem` } : undefined}
          >
            <span className="min-w-0 truncate text-[13px]">
              {node.code && <span className="me-2 font-mono text-[12px] text-[var(--text-tertiary)]">{node.code}</span>}
              <span className={depth === 0 ? 'font-medium' : ''}>{node.name}</span>
            </span>
            <span className="shrink-0 text-[13px] font-medium tabular-nums">{money(node.amount ?? 0)}</span>
          </div>
          {node.children && node.children.length > 0 && <ProfitLossTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function KpiBox({ label, value, tone = 'default', caption }: { label: string; value?: number; tone?: 'default' | 'success' | 'danger'; caption?: string }) {
  return (
    <Card>
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-[var(--success-text)]',
          tone === 'danger' && 'text-[var(--danger-text)]',
        )}
      >
        {value === undefined ? '—' : money(value)}
      </p>
      {caption && <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{caption}</p>}
    </Card>
  );
}

export function LedgerPage() {
  const { api } = useAuth();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());

  const accounts = useApiQuery<Account[]>(
    queryKeys.accounts,
    (signal) => api.data<Account[]>('/accounting/accounts', { signal }),
    { staleTime: 10 * 60_000 },
  );

  const { data, isPending, error } = useApiQuery<{
    account?: Account;
    openingBalance?: number;
    closingBalance?: number;
    rows?: Array<{ id: string; entryDate: string; memo?: string | null; reference?: string | null; source?: string | null; debit: number; credit: number; balance: number }>;
  }>(
    queryKeys.ledger(accountId || 'none', { from, to }),
    (signal) => api.data(`/accounting/ledger/${accountId}`, { signal, query: { from, to } }),
    { enabled: accountId !== '' },
  );

  return (
    <Page>
      <PageHeader
        title="Ledger"
        description="One account, line by line, with a running balance."
        actions={<DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />}
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Account"
            placeholder="Choose an account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            options={(accounts.data ?? []).map((account) => ({
              value: account.id,
              label: `${account.code} — ${account.name}`,
              group: account.type,
            }))}
          />
          <div className="flex items-end">
            {data?.account && (
              <p className="text-[13px] text-[var(--text-secondary)]">
                Opening <span className="font-medium tabular-nums">{money(data.openingBalance ?? 0)}</span> · Closing{' '}
                <span className="font-medium tabular-nums">{money(data.closingBalance ?? 0)}</span>
              </p>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert tone="danger">{error.message}</Alert>}

      {!accountId ? (
        <Card>
          <p className="py-10 text-center text-[13px] text-[var(--text-tertiary)]">Choose an account to see its ledger.</p>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-end">Debit</TableHead>
              <TableHead className="text-end">Credit</TableHead>
              <TableHead className="text-end">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.rows ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-[var(--text-secondary)]">{date(row.entryDate)}</TableCell>
                <TableCell>
                  <span className="text-[var(--text-primary)]">{row.memo ?? row.reference ?? '—'}</span>
                  {row.source && <span className="ms-2 text-[12px] text-[var(--text-tertiary)]">{row.source.toLowerCase()}</span>}
                </TableCell>
                <TableCell className="text-end tabular-nums">{row.debit ? money(row.debit) : '—'}</TableCell>
                <TableCell className="text-end tabular-nums">{row.credit ? money(row.credit) : '—'}</TableCell>
                <TableCell className="text-end font-medium tabular-nums">{money(row.balance)}</TableCell>
              </TableRow>
            ))}
            {isPending && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-[var(--text-tertiary)]">
                  Loading ledger…
                </TableCell>
              </TableRow>
            )}
            {!isPending && (data?.rows?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-[var(--text-tertiary)]">
                  No movements in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}

