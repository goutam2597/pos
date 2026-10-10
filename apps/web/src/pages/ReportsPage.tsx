import { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { toast } from 'sonner';

import { money, percent } from '../lib/format';
import { queryKeys, useApiQuery, type StockValueRow } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, type Column } from '../components/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/data/Table';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Alert } from '../components/ui/Feedback';
import { BarChart, DonutChart, LineChart } from '../components/charts';
import { KpiGrid, KpiTile } from '../components/ui/KpiTile';
import { PageHeader } from '../components/shell/PageHeader';
import { Page } from './_shared';

/**
 * Reports.
 *
 * One screen per report rather than a generic "run any report" builder: the
 * shape of each answer is different (a trend, a ranked list, a statement), and
 * a builder would make all of them worse. Every report exports CSV because a
 * shop owner ends up in a spreadsheet eventually, and fighting that is pointless.
 */

export function ReportsIndexPage() {
  const reports = [
    { to: '/reports/sales', label: 'Sales summary', description: 'Revenue broken down by day, branch, product or cashier.' },
    { to: '/reports/profitability', label: 'Product profitability', description: 'What each product actually earns after cost.' },
    { to: '/reports/inventory-valuation', label: 'Inventory valuation', description: 'Stock value at the current cost basis.' },
    { to: '/reports/tax-summary', label: 'Tax summary', description: 'What you collected and owe, by tax rate.' },
    { to: '/reports/cash-position', label: 'Cash position', description: 'Cash on hand for a single day, by register.' },
    { to: '/reports/customer-balances', label: 'Customer balances', description: 'Who owes you, and how much.' },
    { to: '/reports/supplier-balances', label: 'Supplier balances', description: 'Who you owe, and how much.' },
    { to: '/reports/expense-breakdown', label: 'Expense breakdown', description: 'Where the money went this period.' },
    { to: '/reports/shift-history', label: 'Shift history', description: 'Takings and variance per shift.' },
  ];

  return (
    <Page>
      <PageHeader title="Reports" description="Pick a report. Each one exports to CSV and respects the branch scope in the top bar." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <a
            key={report.to}
            href={report.to}
            className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--border-strong)]"
          >
            <div className="flex items-start gap-2.5">
              <BarChart3 size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)]">{report.label}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{report.description}</p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </Page>
  );
}

/** Common CSV download so every report shares the same behaviour. */
function useCsvExport(filename: string) {
  return (headers: string[], rows: Array<Array<string | number>>) => {
    const escape = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };
}

interface SalesSummaryRow {
  label: string;
  revenue?: number;
  cost?: number;
  profit?: number;
  orders?: number;
  quantity?: number;
}

export function SalesSummaryReport() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [groupBy, setGroupBy] = useState('day');
  const exportCsv = useCsvExport('sales-summary');

  const { data, isPending, error } = useApiQuery<SalesSummaryRow[]>(
    queryKeys.reports('sales-summary', { from, to, groupBy }),
    (signal) => api.data<SalesSummaryRow[]>('/reports/sales-summary', { signal, query: { from, to, groupBy } }),
    { staleTime: 60_000 },
  );

  const rows = Array.isArray(data) ? data : [];
  const totalRevenue = rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  const totalProfit = rows.reduce((sum, row) => sum + (row.profit ?? 0), 0);

  const columns: Column<SalesSummaryRow>[] = [
    { key: 'label', header: groupLabel(groupBy), value: (row) => row.label, sticky: true, cell: (row) => row.label },
    { key: 'orders', header: 'Orders', align: 'end', value: (row) => row.orders ?? 0, cell: (row) => (row.orders ?? 0).toLocaleString() },
    { key: 'revenue', header: 'Revenue', align: 'end', value: (row) => row.revenue ?? 0, cell: (row) => <span className="font-medium tabular-nums">{money(row.revenue ?? 0)}</span> },
    { key: 'cost', header: 'Cost', align: 'end', optional: true, value: (row) => row.cost ?? 0, cell: (row) => money(row.cost ?? 0) },
    {
      key: 'profit',
      header: 'Profit',
      align: 'end',
      value: (row) => row.profit ?? 0,
      cell: (row) => (
        <span className={`font-medium tabular-nums ${(row.profit ?? 0) < 0 ? 'text-[var(--danger-text)]' : ''}`}>
          {money(row.profit ?? 0)}
        </span>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'end',
      optional: true,
      value: (row) => (row.revenue ? ((row.profit ?? 0) / row.revenue) * 100 : 0),
      cell: (row) => (row.revenue ? `${(((row.profit ?? 0) / row.revenue) * 100).toFixed(1)}%` : '—'),
    },
  ];

  return (
    <Page>
      <ReportHeader
        title="Sales summary"
        description={`Grouped by ${groupLabel(groupBy).toLowerCase()} between ${from} and ${to}.`}
        exportCsv={() =>
          exportCsv(
            [groupLabel(groupBy), 'Orders', 'Revenue', 'Cost', 'Profit'],
            rows.map((row) => [row.label, row.orders ?? 0, row.revenue ?? 0, row.cost ?? 0, row.profit ?? 0]),
          )
        }
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
        <Select
          label="Group by"
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value)}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'branch', label: 'Branch' },
            { value: 'user', label: 'Cashier' },
            { value: 'product', label: 'Product' },
          ]}
        />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Revenue" value={money(totalRevenue)} />
        <KpiTile label="Profit" value={money(totalProfit)} tone={totalProfit >= 0 ? 'success' : 'danger'} />
        <KpiTile label="Periods" value={rows.length} />
        <KpiTile
          label="Margin"
          value={totalRevenue ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}%` : '—'}
        />
      </KpiGrid>

      <BarChart
        title="Revenue by period"
        data={rows.map((row) => ({ label: row.label, value: row.revenue ?? 0 }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Revenue"
        height={240}
      />

      <DataTable
        tableId="report-sales-summary"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row, ) => row.label}
        isLoading={isPending}
        exportable={false}
        emptyTitle="No sales in this period"
      />
    </Page>
  );
}

function groupLabel(groupBy: string): string {
  return { day: 'Day', week: 'Week', month: 'Month', branch: 'Branch', user: 'Cashier', product: 'Product' }[groupBy] ?? 'Period';
}

function ReportHeader({
  title,
  description,
  children,
  exportCsv,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  exportCsv?: () => void;
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        exportCsv ? (
          <Button variant="secondary" icon={<Download size={15} strokeWidth={1.75} />} onClick={exportCsv}>
            Export CSV
          </Button>
        ) : undefined
      }
      toolbar={<div className="flex flex-wrap items-end gap-2">{children}</div>}
    />
  );
}

export function ProfitabilityReport() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const exportCsv = useCsvExport('product-profitability');

  const { data, isPending, error } = useApiQuery<
    Array<{ productId: string; productName: string; sku?: string | null; quantity?: number; revenue?: number; cost?: number; profit?: number; margin?: number }>
  >(
    queryKeys.reports('product-profitability', { from, to }),
    // The API returns `{ rows: [...] }` with its own field names; normalise to
    // the shape this screen renders. The same applies to every report below.
    async (signal) => {
      const envelope = await api.data<{
        rows?: Array<{ productId: string; name: string; sku?: string | null; qtySold?: number; revenue?: number; cost?: number; profit?: number; marginPercent?: number }>;
      }>('/reports/product-profitability', { signal, query: { from, to } });
      return (envelope.rows ?? []).map((row) => ({
        productId: row.productId,
        productName: row.name,
        sku: row.sku ?? null,
        quantity: row.qtySold ?? 0,
        revenue: row.revenue ?? 0,
        cost: row.cost ?? 0,
        profit: row.profit ?? 0,
        margin: row.marginPercent ?? 0,
      }));
    },
    { staleTime: 60_000 },
  );

  const rows = data ?? [];
  const totalProfit = rows.reduce((sum, row) => sum + (row.profit ?? 0), 0);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'product',
      header: 'Product',
      value: (row) => row.productName,
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          {row.sku && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.sku}</p>}
        </div>
      ),
    },
    { key: 'quantity', header: 'Sold', align: 'end', value: (row) => row.quantity ?? 0, cell: (row) => (row.quantity ?? 0).toLocaleString() },
    { key: 'revenue', header: 'Revenue', align: 'end', value: (row) => row.revenue ?? 0, cell: (row) => <span className="font-medium tabular-nums">{money(row.revenue ?? 0)}</span> },
    { key: 'cost', header: 'Cost of goods', align: 'end', value: (row) => row.cost ?? 0, cell: (row) => money(row.cost ?? 0) },
    {
      key: 'profit',
      header: 'Profit',
      align: 'end',
      value: (row) => row.profit ?? 0,
      cell: (row) => (
        <span className={`font-medium tabular-nums ${(row.profit ?? 0) < 0 ? 'text-[var(--danger-text)]' : ''}`}>{money(row.profit ?? 0)}</span>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'end',
      value: (row) => row.margin ?? 0,
      cell: (row) => `${(row.margin ?? 0).toFixed(1)}%`,
    },
  ];

  return (
    <Page>
      <ReportHeader
        title="Product profitability"
        description="Revenue minus the cost of the goods actually sold. Products sold at a loss show here in red."
        exportCsv={() =>
          exportCsv(
            ['Product', 'SKU', 'Sold', 'Revenue', 'Cost', 'Profit', 'Margin %'],
            rows.map((row) => [row.productName, row.sku ?? '', row.quantity ?? 0, row.revenue ?? 0, row.cost ?? 0, row.profit ?? 0, row.margin ?? 0]),
          )
        }
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Products sold" value={rows.length} />
        <KpiTile label="Total profit" value={money(totalProfit)} tone={totalProfit >= 0 ? 'success' : 'danger'} />
        <KpiTile label="Losing money" value={rows.filter((row) => (row.profit ?? 0) < 0).length} tone="danger" caption="Review the price or the cost" />
      </KpiGrid>

      <BarChart
        title="Most profitable"
        horizontal
        data={[...rows]
          .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
          .slice(0, 10)
          .map((row) => ({ label: row.productName, value: Math.max(row.profit ?? 0, 0) }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Profit"
      />

      <DataTable
        tableId="report-profitability"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.productId ?? row.productName}
        isLoading={isPending}
        exportable={false}
        emptyTitle="Nothing sold in this period"
      />
    </Page>
  );
}

export function InventoryValuationReport() {
  const { api } = useAuth();
  const exportCsv = useCsvExport('inventory-valuation');

  const { data, isPending, error } = useApiQuery<StockValueRow[]>(
    queryKeys.reports('inventory-valuation'),
    async (signal) => {
      const envelope = await api.data<{
        totalValue?: number;
        itemCount?: number;
        lines?: Array<{ itemKey: string; qty?: number; value: number; name: string | null; sku: string | null }>;
      }>('/reports/inventory-valuation', { signal });
      return (envelope.lines ?? []).map((line) => ({
        productId: line.itemKey,
        productName: line.name ?? 'Product',
        sku: line.sku,
        warehouseName: null,
        qtyMilli: line.qty ?? 0,
        value: line.value,
      }));
    },
    { staleTime: 120_000 },
  );

  const rows = data ?? [];
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);

  const columns: Column<StockValueRow>[] = [
    {
      key: 'product',
      header: 'Product',
      value: (row) => row.productName,
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          {row.sku && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.sku}</p>}
        </div>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', value: (row) => row.warehouseName, cell: (row) => row.warehouseName ?? '—' },
    { key: 'value', header: 'Value', align: 'end', value: (row) => row.value ?? 0, cell: (row) => <span className="font-medium tabular-nums">{money(row.value ?? 0)}</span> },
  ];

  return (
    <Page>
      <ReportHeader
        title="Inventory valuation"
        description="What the stock on the shelves is worth at the current cost basis."
        exportCsv={() => exportCsv(['Product', 'SKU', 'Warehouse', 'Value'], rows.map((row) => [row.productName ?? '', row.sku ?? '', row.warehouseName ?? '', row.value ?? 0]))}
      >
        <p className="py-1 text-[13px] text-[var(--text-tertiary)]">Calculated live from current stock levels.</p>
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Lines" value={rows.length} />
        <KpiTile label="Total stock value" value={money(total)} />
      </KpiGrid>

      <BarChart
        title="Value by product"
        horizontal
        data={[...rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 12).map((row) => ({ label: row.productName ?? 'Product', value: row.value ?? 0 }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Value"
      />

      <DataTable
        tableId="report-inventory-valuation"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => `${row.productId ?? row.productName}-${row.warehouseName ?? 'all'}`}
        isLoading={isPending}
        exportable={false}
        emptyTitle="Nothing to value"
      />
    </Page>
  );
}

export function TaxSummaryReport() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const exportCsv = useCsvExport('tax-summary');

  const { data, isPending, error } = useApiQuery<{
    rows?: Array<{ taxId: string; name: string; rate: number; taxableBase: number; taxAmount: number }>;
    totalTax?: number;
  }>(
    queryKeys.reports('tax-summary', { from, to }),
    (signal) => api.data('/reports/tax-summary', { signal, query: { from, to } }),
    { staleTime: 60_000 },
  );

  const rows = data?.rows ?? [];
  const totalTax = data?.totalTax ?? rows.reduce((sum, row) => sum + row.taxAmount, 0);

  return (
    <Page>
      <ReportHeader
        title="Tax summary"
        description={`What you collected between ${from} and ${to}. Check it against your filing before you submit.`}
        exportCsv={() => exportCsv(['Tax', 'Rate %', 'Taxable base', 'Tax'], rows.map((row) => [row.name, row.rate, row.taxableBase, row.taxAmount]))}
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Tax collected" value={money(totalTax)} />
        <KpiTile label="Rates applied" value={rows.length} />
      </KpiGrid>

      <DonutChart
        title="Tax by rate"
        data={rows.map((row) => ({ label: `${row.name} (${percent(row.rate)})`, value: row.taxAmount }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Tax collected"
        centerLabel="Total collected"
        centerValue={money(totalTax, { showCents: false })}
        height={240}
      />

      <DataTable
        tableId="report-tax-summary"
        columns={[
          { key: 'name', header: 'Tax', value: (row) => row.name, sticky: true, cell: (row) => row.name },
          { key: 'rate', header: 'Rate', align: 'end', value: (row) => row.rate, cell: (row) => percent(row.rate) },
          { key: 'taxableBase', header: 'Taxable base', align: 'end', value: (row) => row.taxableBase, cell: (row) => money(row.taxableBase) },
          { key: 'taxAmount', header: 'Tax', align: 'end', value: (row) => row.taxAmount, cell: (row) => <span className="font-medium tabular-nums">{money(row.taxAmount)}</span> },
        ]}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.taxId ?? row.name}
        isLoading={isPending}
        exportable={false}
        emptyTitle="No taxable sales in this period"
      />
    </Page>
  );
}

export function CashPositionReport() {
  const { api } = useAuth();
  const [date, setDate] = useState(todayIso());
  const exportCsv = useCsvExport('cash-position');

  const { data, isPending, error } = useApiQuery<{
    openingFloat?: number;
    cashSales?: number;
    cashRefunds?: number;
    cashDrops?: number;
    expectedCash?: number;
    countedCash?: number;
    variance?: number;
    rows?: Array<{ registerId: string; registerName: string; expectedCash: number; countedCash?: number; variance?: number }>;
  }>(
    queryKeys.reports('cash-position', { date }),
    (signal) => api.data('/reports/cash-position', { signal, query: { date } }),
    { staleTime: 60_000 },
  );

  const rows = data?.rows ?? [];
  const variance = data?.variance ?? 0;

  return (
    <Page>
      <ReportHeader
        title="Cash position"
        description={`Cash expected on ${date}, by register. A variance is the difference between what was counted and what was expected.`}
        exportCsv={() => exportCsv(['Register', 'Expected', 'Counted', 'Variance'], rows.map((row) => [row.registerName, row.expectedCash, row.countedCash ?? '', row.variance ?? '']))}
      >
        <div className="w-[11rem]">
          <Select
            label="Date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            options={[0, 1, 2, 3, 7].map((days) => ({ value: isoDaysAgo(days), label: days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago` }))}
          />
        </div>
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Opening float" value={data?.openingFloat === undefined ? '—' : money(data.openingFloat)} />
        <KpiTile label="Cash sales" value={data?.cashSales === undefined ? '—' : money(data.cashSales)} />
        <KpiTile label="Expected cash" value={data?.expectedCash === undefined ? '—' : money(data.expectedCash)} />
        <KpiTile
          label="Variance"
          value={variance === 0 && data?.countedCash !== undefined ? money(0) : money(variance)}
          tone={variance === 0 ? 'success' : 'danger'}
          caption={variance === 0 ? 'Balanced' : 'Investigate before banking'}
        />
      </KpiGrid>

      <DataTable
        tableId="report-cash-position"
        columns={[
          { key: 'register', header: 'Register', value: (row) => row.registerName, sticky: true, cell: (row) => row.registerName },
          { key: 'expected', header: 'Expected', align: 'end', value: (row) => row.expectedCash, cell: (row) => <span className="tabular-nums">{money(row.expectedCash)}</span> },
          { key: 'counted', header: 'Counted', align: 'end', value: (row) => row.countedCash ?? null, cell: (row) => (row.countedCash === undefined ? '—' : money(row.countedCash)) },
          {
            key: 'variance',
            header: 'Variance',
            align: 'end',
            value: (row) => row.variance ?? 0,
            cell: (row) => (
              <span className={`font-medium tabular-nums ${(row.variance ?? 0) !== 0 ? 'text-[var(--danger-text)]' : ''}`}>
                {money(row.variance ?? 0)}
              </span>
            ),
          },
        ]}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.registerId}
        isLoading={isPending}
        exportable={false}
        emptyTitle="No cash activity on this date"
      />
    </Page>
  );
}

function BalanceReport({
  title,
  description,
  endpoint,
  queryKey,
  exportName,
  partyLabel = 'Party',
}: {
  title: string;
  description: string;
  endpoint: string;
  queryKey: string;
  exportName: string;
  partyLabel?: string;
}) {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(todayIso());
  const exportCsv = useCsvExport(exportName);

  const { data, isPending, error } = useApiQuery<
    Array<{ partyId: string; partyName: string; opening?: number; invoiced?: number; paid?: number; closing?: number }>
  >(
    queryKeys.reports(queryKey, { from, to }),
    // The API returns open invoices, not per-party balances: aggregate them.
    async (signal) => {
      const envelope = await api.data<{
        invoices?: Array<{
          total?: number;
          paidTotal?: number;
          balanceDue?: number;
          party?: { id: string; name: string } | null;
        }>;
      }>(endpoint, { signal, query: { from, to } });
      const byParty = new Map<string, { partyId: string; partyName: string; opening: number; invoiced: number; paid: number; closing: number }>();
      for (const invoice of envelope.invoices ?? []) {
        const key = invoice.party?.id ?? invoice.party?.name ?? 'unknown';
        const entry =
          byParty.get(key) ??
          { partyId: invoice.party?.id ?? key, partyName: invoice.party?.name ?? 'Unknown', opening: 0, invoiced: 0, paid: 0, closing: 0 };
        entry.invoiced += invoice.total ?? 0;
        entry.paid += invoice.paidTotal ?? 0;
        entry.closing += invoice.balanceDue ?? 0;
        byParty.set(key, entry);
      }
      return [...byParty.values()].sort((a, b) => b.closing - a.closing);
    },
    { staleTime: 60_000 },
  );

  const rows = data ?? [];
  const totalClosing = rows.reduce((sum, row) => sum + (row.closing ?? 0), 0);

  return (
    <Page>
      <ReportHeader
        title={title}
        description={description}
        exportCsv={() =>
          exportCsv(
            [partyLabel, 'Opening', 'Invoiced', 'Paid', 'Closing'],
            rows.map((row) => [row.partyName, row.opening ?? 0, row.invoiced ?? 0, row.paid ?? 0, row.closing ?? 0]),
          )
        }
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label={`${partyLabel}s with a balance`} value={rows.filter((row) => (row.closing ?? 0) !== 0).length} />
        <KpiTile label="Total outstanding" value={money(totalClosing)} tone={totalClosing > 0 ? 'danger' : 'default'} />
      </KpiGrid>

      <DataTable
        tableId={`report-${queryKey}`}
        columns={[
          { key: 'party', header: partyLabel, value: (row) => row.partyName, sticky: true, cell: (row) => row.partyName },
          { key: 'opening', header: 'Opening', align: 'end', optional: true, value: (row) => row.opening ?? 0, cell: (row) => money(row.opening ?? 0) },
          { key: 'invoiced', header: 'Invoiced', align: 'end', value: (row) => row.invoiced ?? 0, cell: (row) => money(row.invoiced ?? 0) },
          { key: 'paid', header: 'Paid', align: 'end', value: (row) => row.paid ?? 0, cell: (row) => money(row.paid ?? 0) },
          {
            key: 'closing',
            header: 'Balance',
            align: 'end',
            value: (row) => row.closing ?? 0,
            cell: (row) => (
              <span className={`font-medium tabular-nums ${(row.closing ?? 0) > 0 ? 'text-[var(--danger-text)]' : ''}`}>
                {money(row.closing ?? 0)}
              </span>
            ),
          },
        ]}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.partyId ?? row.partyName}
        isLoading={isPending}
        exportable={false}
        emptyTitle="No balances in this period"
      />
    </Page>
  );
}

export function CustomerBalancesReport() {
  return (
    <BalanceReport
      title="Customer balances"
      description="Who owes you, oldest first if you want to chase it."
      endpoint="/reports/customer-balances"
      queryKey="customer-balances"
      exportName="customer-balances"
      partyLabel="Customer"
    />
  );
}

export function SupplierBalancesReport() {
  return (
    <BalanceReport
      title="Supplier balances"
      description="Who you owe before the next payment run."
      endpoint="/reports/supplier-balances"
      queryKey="supplier-balances"
      exportName="supplier-balances"
      partyLabel="Supplier"
    />
  );
}

export function ExpenseBreakdownReport() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const exportCsv = useCsvExport('expense-breakdown');

  const { data, isPending, error } = useApiQuery<Array<{ category: string; amount: number }>>(
    queryKeys.reports('expense-breakdown', { from, to }),
    async (signal) => {
      const envelope = await api.data<{ rows?: Array<{ category: string; amount: number }> }>(
        '/reports/expense-breakdown',
        { signal, query: { from, to } },
      );
      return envelope.rows ?? [];
    },
    { staleTime: 60_000 },
  );

  const rows = data ?? [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <Page>
      <ReportHeader
        title="Expense breakdown"
        description={`Approved expenses between ${from} and ${to}, grouped by category.`}
        exportCsv={() => exportCsv(['Category', 'Amount'], rows.map((row) => [row.category, row.amount]))}
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Total expenses" value={money(total)} />
        <KpiTile label="Categories" value={rows.length} />
      </KpiGrid>

      <DonutChart
        title="Where the money went"
        data={rows.map((row) => ({ label: row.category, value: row.amount }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Amount"
        centerLabel="Total"
        centerValue={money(total, { showCents: false })}
        height={240}
      />

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Category</TableHead>
            <TableHead className="text-end">Amount</TableHead>
            <TableHead className="text-end">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.category}>
              <TableCell>{row.category}</TableCell>
              <TableCell className="text-end font-medium tabular-nums">{money(row.amount)}</TableCell>
              <TableCell className="text-end tabular-nums text-[var(--text-secondary)]">
                {total > 0 ? `${((row.amount / total) * 100).toFixed(1)}%` : '—'}
              </TableCell>
            </TableRow>
          ))}
          {!isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="py-10 text-center text-[var(--text-tertiary)]">
                No approved expenses in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Page>
  );
}

export function ShiftHistoryReport() {
  const { api } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(14));
  const [to, setTo] = useState(todayIso());
  const exportCsv = useCsvExport('shift-history');

  const { data, isPending, error } = useApiQuery<
    Array<{
      id: string;
      registerName?: string | null;
      branchName?: string | null;
      userName?: string | null;
      openedAt?: string | null;
      closedAt?: string | null;
      openingFloat?: number;
      cashSales?: number;
      cashDrops?: number;
      countedCash?: number;
      variance?: number;
    }>
  >(
    queryKeys.reports('shift-history', { from, to }),
    async (signal) => {
      const envelope = await api.data<{
        rows?: Array<{
          id: string;
          registerName?: string | null;
          branchName?: string | null;
          userName?: string | null;
          openedAt?: string | null;
          closedAt?: string | null;
          openingFloat?: number;
          cashSales?: number;
          cashDrops?: number;
          countedCash?: number;
          variance?: number;
        }>;
      }>('/reports/shift-history', { signal, query: { from, to } });
      return envelope.rows ?? [];
    },
    { staleTime: 60_000 },
  );

  const rows = data ?? [];
  const totalVariance = rows.reduce((sum, row) => sum + (row.variance ?? 0), 0);

  return (
    <Page>
      <ReportHeader
        title="Shift history"
        description="Each till shift, what it took, and whether the cash matched at close."
        exportCsv={() =>
          exportCsv(
            ['Register', 'Cashier', 'Opened', 'Closed', 'Opening float', 'Cash sales', 'Counted', 'Variance'],
            rows.map((row) => [row.registerName ?? '', row.userName ?? '', row.openedAt ?? '', row.closedAt ?? '', row.openingFloat ?? 0, row.cashSales ?? 0, row.countedCash ?? '', row.variance ?? '']),
          )
        }
      >
        <DateRangePicker from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
      </ReportHeader>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <KpiGrid>
        <KpiTile label="Shifts" value={rows.length} />
        <KpiTile label="Total cash variance" value={money(totalVariance)} tone={totalVariance === 0 ? 'success' : 'danger'} />
      </KpiGrid>

      <LineChart
        title="Cash variance by shift"
        description="Positive means more cash than expected"
        data={rows.map((row) => ({ label: row.registerName ?? 'Register', value: row.variance ?? 0 }))}
        format={(value) => money(value, { showCents: false })}
        valueLabel="Variance"
        height={200}
      />

      <DataTable
        tableId="report-shift-history"
        columns={[
          { key: 'register', header: 'Register', value: (row) => row.registerName, sticky: true, cell: (row) => row.registerName ?? '—' },
          { key: 'user', header: 'Cashier', value: (row) => row.userName, cell: (row) => row.userName ?? '—' },
          { key: 'openingFloat', header: 'Float', align: 'end', value: (row) => row.openingFloat ?? 0, cell: (row) => money(row.openingFloat ?? 0) },
          { key: 'cashSales', header: 'Cash sales', align: 'end', value: (row) => row.cashSales ?? 0, cell: (row) => money(row.cashSales ?? 0) },
          { key: 'counted', header: 'Counted', align: 'end', value: (row) => row.countedCash ?? null, cell: (row) => (row.countedCash === undefined ? '—' : money(row.countedCash)) },
          {
            key: 'variance',
            header: 'Variance',
            align: 'end',
            value: (row) => row.variance ?? 0,
            cell: (row) => (
              <span className={`font-medium tabular-nums ${(row.variance ?? 0) !== 0 ? 'text-[var(--danger-text)]' : ''}`}>
                {money(row.variance ?? 0)}
              </span>
            ),
          },
        ]}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={isPending}
        exportable={false}
        emptyTitle="No shifts in this period"
      />
    </Page>
  );
}

