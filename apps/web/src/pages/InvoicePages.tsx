import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText } from 'lucide-react';

import { date, dateTime, money, qty } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiQuery,
  type Invoice,
  type Sale,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, type Column } from '../components/data';
import {
  DocumentFooter,
  DocumentHeader,
  DocumentLines,
  DocumentSheet,
  DocumentToolbar,
  DocumentTotals,

} from '../components/data/DocumentLayout';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { FilterBar, FilterField } from '../components/data/FilterBar';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { ErrorState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { PageHeader } from '../components/shell/PageHeader';
import { Page, useQueryState } from './_shared';

/**
 * Invoices.
 *
 * An invoice is the legal document; a sale is the till event. They are shown
 * separately because they have different lifecycles — an invoice can stay unpaid
 * long after the sale that produced it was closed.
 */
export function InvoicesPage() {
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 25,
    search: '',
    status: '',
    type: '',
    from: isoDaysAgo(90),
    to: todayIso(),
  });

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      status: query.status || undefined,
      type: query.type || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<Invoice>(queryKeys.invoices(params), '/invoices', params);

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      value: (row) => row.number,
      sticky: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link to={`/invoices/${row.id}`} className="block truncate font-medium hover:underline">
              {row.number}
            </Link>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">
              {date(row.issueDate)}
              {row.sourceNumber ? ` · from ${row.sourceNumber}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'party',
      header: 'Party',
      value: (row) => row.partyName,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.partyName ?? '—'}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      value: (row) => row.type,
      width: '8rem',
      cell: (row) => <span className="text-[12px] text-[var(--text-secondary)]">{(row.type ?? '—').replace('_', ' ')}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'end',
      value: (row) => row.total,
      cell: (row) => <span className="font-medium tabular-nums">{money(row.total)}</span>,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'end',
      value: (row) => row.balance ?? 0,
      cell: (row) => (
        <span className={(row.balance ?? 0) > 0 ? 'font-medium text-[var(--danger-text)]' : 'tabular-nums text-[var(--text-tertiary)]'}>
          {money(row.balance ?? 0)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      value: (row) => row.dueDate,
      optional: true,
      cell: (row) => <span className="text-[var(--text-secondary)]">{date(row.dueDate)}</span>,
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
        title="Invoices"
        description="Issued invoices, credit notes and the balances they carry."
      />

      <DataTable
        tableId="invoices"
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
        exportName="invoices"
        toolbar={
          <div className="flex items-end gap-2.5">
            <FilterBar className="w-full sm:w-auto">
              <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search invoice number or party" />
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
                options={['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'OVERDUE', 'VOID', 'CANCELLED'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
            <FilterField>
              <Select
                label="Type"
                placeholder="Any type"
                value={query.type}
                onChange={(event) => patch({ type: event.target.value })}
                options={['SALE', 'PURCHASE', 'RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PROFORMA'].map((value) => ({ value, label: value.replace('_', ' ') }))}
              />
            </FilterField>
          </>
        }
        emptyTitle="No invoices in this period"
        emptyDescription="An invoice is created when a credit sale needs a document, or from a purchase."
      />
    </Page>
  );
}

/**
 * A single invoice, laid out for printing.
 *
 * The same markup serves screen and paper: the toolbar is `no-print`, the sheet
 * drops its border and padding on paper, and the totals block sits where an
 * accountant expects it.
 */
export function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { api, business } = useAuth();

  const query = useApiQuery<Invoice>(queryKeys.invoice(id ?? ''), (signal) => api.data<Invoice>(`/invoices/${id}`, { signal }));

  if (query.isPending) {
    return (
      <Page>
        <LoadingBlock label="Loading invoice" />
      </Page>
    );
  }

  if (query.error) {
    return (
      <Page>
        <ErrorState title="Could not load this invoice" description={query.error.message} onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  const invoice = query.data;
  if (!invoice) return null;

  const lines = invoice.lines ?? [];

  return (
    <Page>
      <DocumentToolbar
        title="Invoice"
        reference={`${invoice.number} · ${date(invoice.issueDate)}`}
        onBack={() => navigate('/invoices')}
        backLabel="All invoices"
        actions={<StatusBadge status={invoice.status} />}
      />

      <DocumentSheet>
        <DocumentHeader
          businessName={business?.name}
          title={(invoice.type ?? 'SALE') === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'}
          number={invoice.number}
          meta={[
            { label: 'Issue date', value: date(invoice.issueDate) },
            ...(invoice.dueDate ? [{ label: 'Due date', value: date(invoice.dueDate) }] : []),
            { label: 'Status', value: <StatusBadge status={invoice.status} /> },
            ...(invoice.branchName ? [{ label: 'Branch', value: invoice.branchName }] : []),
          ]}
        />

        <section className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">Billed to</h3>
            <p className="mt-1.5 text-[13px] font-medium text-[var(--text-primary)]">{invoice.partyName ?? 'Walk-in customer'}</p>
            {invoice.partyAddress && <p className="text-[13px] text-[var(--text-secondary)]">{invoice.partyAddress}</p>}
            {invoice.partyEmail && <p className="text-[13px] text-[var(--text-secondary)]">{invoice.partyEmail}</p>}
            {invoice.partyPhone && <p className="text-[13px] text-[var(--text-secondary)]">{invoice.partyPhone}</p>}
          </div>
          {invoice.sourceNumber && (
            <div>
              <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">Source document</h3>
              <p className="mt-1.5 text-[13px] text-[var(--text-primary)]">{invoice.sourceNumber}</p>
              <p className="text-[13px] text-[var(--text-secondary)]">{(invoice.sourceType ?? '').replace('_', ' ').toLowerCase()}</p>
            </div>
          )}
        </section>

        <DocumentLines
          showTax
          lines={lines.map((line) => ({
            description: line.description ?? line.productName ?? 'Item',
            meta: line.sku ? `SKU ${line.sku}` : undefined,
            qtyMilli: line.qtyMilli ?? 0,
            unitName: line.unitName,
            unitPrice: line.unitPrice ?? 0,
            taxAmount: line.taxAmount ?? 0,
            total: line.total ?? 0,
          }))}
        />

        <DocumentTotals
          rows={[
            { label: 'Subtotal', value: money(invoice.subtotal) },
            ...(invoice.discount ? [{ label: 'Discount', value: `−${money(invoice.discount)}` }] : []),
            { label: 'Tax', value: money(invoice.tax) },
            ...(invoice.amountPaid ? [{ label: 'Paid', value: `−${money(invoice.amountPaid)}` }] : []),
          ]}
          grandTotal={money(invoice.total)}
          grandTotalLabel="Total due"
        />

        {(invoice.payments?.length ?? 0) > 0 && (
          <section className="mt-6">
            <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">Payments received</h3>
            <ul className="mt-2 space-y-1 text-[13px]">
              {(invoice.payments ?? []).map((payment) => (
                <li key={payment.id} className="flex justify-between gap-6">
                  <span className="text-[var(--text-secondary)]">
                    {payment.method.replace('_', ' ').toLowerCase()}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                  <span className="tabular-nums text-[var(--text-primary)]">{money(payment.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DocumentFooter
          {...(invoice.notes ? { notes: <p>{invoice.notes}</p> } : {})}
          terms="Thank you for your business."
        />
      </DocumentSheet>
    </Page>
  );
}

/**
 * Sale detail.
 *
 * Shows the till event and everything the accounting engine derived from it:
 * payments, the resulting invoice and the journal entry. If the numbers on the
 * sale and the ledger ever disagree, this is the page that proves it.
 */
export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { api } = useAuth();

  const query = useApiQuery<Sale>(queryKeys.sale(id ?? ''), (signal) => api.data<Sale>(`/sales/${id}`, { signal }));

  if (query.isPending) {
    return (
      <Page>
        <LoadingBlock label="Loading sale" />
      </Page>
    );
  }

  if (query.error) {
    return (
      <Page>
        <ErrorState title="Could not load this sale" description={query.error.message} onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  const sale = query.data;
  if (!sale) return null;

  return (
    <Page>
      <DocumentToolbar
        title={`Sale ${sale.number}`}
        reference={`${dateTime(sale.createdAt)} · ${sale.customerName ?? 'Walk-in customer'}`}
        onBack={() => navigate('/sales')}
        backLabel="All sales"
        actions={
          <>
            <StatusBadge status={sale.status} />
            {sale.invoiceId && (
              <Link to={`/invoices/${sale.invoiceId}`}>
                <Button variant="secondary">View invoice</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DocumentSheet>
            <DocumentHeader
              title="Receipt"
              number={sale.number}
              meta={[
                { label: 'Date', value: dateTime(sale.createdAt) },
                { label: 'Channel', value: (sale.channel ?? 'POS').toLowerCase() },
                ...(sale.registerName ? [{ label: 'Register', value: sale.registerName }] : []),
                ...(sale.userName ? [{ label: 'Served by', value: sale.userName }] : []),
              ]}
            />

            <DocumentLines
              lines={(sale.items ?? []).map((item) => ({
                description: item.productName,
                meta: item.variantName ?? item.sku ?? undefined,
                qtyMilli: item.qtyMilli,
                unitName: item.unitName,
                unitPrice: item.unitPrice,
                total: item.total,
              }))}
            />

            <DocumentTotals
              rows={[
                { label: 'Subtotal', value: money(sale.subtotal) },
                ...(sale.discount ? [{ label: 'Discount', value: `−${money(sale.discount)}` }] : []),
                { label: 'Tax', value: money(sale.tax) },
                ...(sale.paid !== undefined && sale.paid !== sale.total
                  ? [{ label: 'Paid', value: money(sale.paid) }]
                  : []),
                ...(sale.change ? [{ label: 'Change', value: money(sale.change) }] : []),
              ]}
              grandTotal={money(sale.total)}
            />

            <DocumentFooter notes={sale.notes ? <p>{sale.notes}</p> : undefined} />
          </DocumentSheet>
        </div>

        <div className="space-y-4">
          <Card flush>
            <CardHeader title="Payments" />
            {(sale.payments?.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[var(--text-tertiary)]">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {(sale.payments ?? []).map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{payment.method.replace('_', ' ').toLowerCase()}</p>
                      {payment.reference && (
                        <p className="truncate text-[12px] text-[var(--text-tertiary)]">{payment.reference}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums">{money(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card flush>
            <CardHeader title="Where this went" description="Double entry created by this sale" />
            <dl className="divide-y divide-[var(--border-subtle)] text-[13px]">
              <div className="flex justify-between gap-3 px-4 py-2.5">
                <dt className="text-[var(--text-tertiary)]">Invoice</dt>
                <dd className="text-end font-medium">
                  {sale.invoiceNumber ? (
                    <Link to={`/invoices/${sale.invoiceId}`} className="hover:underline">
                      {sale.invoiceNumber}
                    </Link>
                  ) : (
                    'Not raised'
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2.5">
                <dt className="text-[var(--text-tertiary)]">Journal entry</dt>
                <dd className="text-end font-medium">
                  {sale.journalEntryId ? (
                    <Link to={`/accounting/journal?q=${sale.journalEntryId}`} className="hover:underline">
                      View
                    </Link>
                  ) : (
                    'Not posted'
                  )}
                </dd>
              </div>
              {sale.voidedAt && (
                <div className="flex justify-between gap-3 px-4 py-2.5">
                  <dt className="text-[var(--text-tertiary)]">Voided</dt>
                  <dd className="text-end font-medium text-[var(--danger-text)]">{dateTime(sale.voidedAt)}</dd>
                </div>
              )}
              {sale.voidReason && (
                <div className="px-4 py-2.5">
                  <dt className="text-[var(--text-tertiary)]">Void reason</dt>
                  <dd className="mt-0.5 text-[var(--text-primary)]">{sale.voidReason}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card flush>
            <CardHeader title="Stock effect" description="Quantity removed by each line" />
            <ul className="divide-y divide-[var(--border-subtle)] text-[13px]">
              {(sale.items ?? []).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 truncate text-[var(--text-secondary)]">{item.productName}</span>
                  <span className="shrink-0 tabular-nums text-[var(--danger-text)]">
                    −{qty(Math.abs(item.qtyMilli), item.unitName)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

