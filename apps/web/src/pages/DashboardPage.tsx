import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Coins, PackageX, Receipt, TrendingUp, Users } from 'lucide-react';

import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { compactCount, dateTime, money, qty } from '../lib/format';
import { queryKeys, useApiQuery, type DashboardData } from '../lib/queries';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { KpiGrid, KpiTile } from '../components/ui/KpiTile';
import { StatusBadge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Feedback';
import { Skeleton } from '../components/ui/Skeleton';
import { DonutChart, LineChart } from '../components/charts';
import { PageHeader } from '../components/shell/PageHeader';
import { Page } from './_shared';

/**
 * Dashboard.
 *
 * The screen a shop owner opens first thing. It answers three questions in
 * order: did we make money, what is running out, and what just happened.
 *
 * Every tile is driven by the server's `kpis` object. Where a value is absent
 * the tile says "—" rather than rendering a zero, because "no data" and "zero
 * sales" are completely different news.
 */
export function DashboardPage() {
  const { api, business, user } = useAuth();

  const { data, isPending, error, refetch, isFetching } = useApiQuery<DashboardData>(
    queryKeys.dashboard(),
    (signal) => api.data<DashboardData>('/dashboard', { signal }),
    { staleTime: 60_000, refetchInterval: 120_000 },
  );

  const kpis = data?.kpis ?? {};
  const trend = useMemo(() => {
    const value = kpis.salesTrendPct;
    if (value === undefined || value === null) return null;
    return {
      text: `${value > 0 ? '+' : ''}${value.toFixed(1)}%`,
      direction: value > 0.05 ? ('up' as const) : value < -0.05 ? ('down' as const) : ('flat' as const),
    };
  }, [kpis.salesTrendPct]);

  const firstName = user?.firstName ? `${user.firstName} · ` : '';

  return (
    <Page>
      <PageHeader
        hideBreadcrumbs
        title={`${firstName}Today`}
        description={business ? `${business.name} · ${dateTime(new Date())}` : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => void refetch()} loading={isFetching}>
              Refresh
            </Button>
            <Link to="/sales">
              <Button variant="primary" iconEnd={<ArrowRight size={15} strokeWidth={1.75} className="rtl:rotate-180" />}>
                View sales
              </Button>
            </Link>
          </>
        }
      />

      {error && (
        <ErrorState
          title="Could not load the dashboard"
          description={error.message}
          onRetry={() => void refetch()}
        />
      )}

      {isPending ? (
        <DashboardSkeleton />
      ) : data ? (
        <div className="space-y-4">
          <KpiGrid>
            <KpiTile
              label="Sales today"
              value={kpis.salesToday === undefined ? '—' : money(kpis.salesToday)}
              icon={Coins}
              {...(trend ? { trend: trend.text, trendDirection: trend.direction } : {})}
              caption="Since midnight"
              loading={isFetching}
            />
            <KpiTile
              label="Sales this month"
              value={kpis.salesMonth === undefined ? '—' : money(kpis.salesMonth)}
              icon={TrendingUp}
              caption="Month to date"
              loading={isFetching}
            />
            <KpiTile
              label="Orders today"
              value={kpis.ordersToday === undefined ? '—' : compactCount(kpis.ordersToday)}
              icon={Receipt}
              caption={
                kpis.avgTicket === undefined ? undefined : `Average ${money(kpis.avgTicket)} per order`
              }
              loading={isFetching}
            />
            <KpiTile
              label="Needs reordering"
              value={kpis.lowStockCount === undefined ? '—' : compactCount(kpis.lowStockCount)}
              icon={PackageX}
              tone={kpis.lowStockCount ? 'warning' : 'default'}
              caption="Products at or below their reorder level"
              loading={isFetching}
            />
          </KpiGrid>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <LineChart
                title="Sales trend"
                description="Revenue over the last 30 days"
                data={(data.salesTrend ?? []).map((point) => ({ label: point.label, value: point.value }))}
                format={(value) => money(value, { showCents: false })}
                valueLabel="Revenue"
                height={260}
              />
            </div>
            <DonutChart
              title="Payment mix"
              description="How today's takings were collected"
              data={data.paymentMix ?? []}
              format={(value) => money(value, { showCents: false })}
              valueLabel="Amount"
              centerLabel={data.paymentMix?.length ? 'Taken' : undefined}
              centerValue={
                data.paymentMix?.length
                  ? money(data.paymentMix.reduce((sum, point) => sum + point.value, 0), { showCents: false })
                  : undefined
              }
              height={260}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card flush>
              <CardHeader
                title="Top products"
                description="By revenue in the last 30 days"
                actions={
                  <Link to="/reports/profitability" className="text-[13px] text-[var(--accent-text)] hover:underline">
                    Profitability
                  </Link>
                }
              />
              {(data.topProducts?.length ?? 0) === 0 ? (
                <EmptyState compact title="No sales yet" description="Top sellers appear once the first sale is recorded." />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {(data.topProducts ?? []).slice(0, 8).map((product, index) => {
                    const max = Math.max(...(data.topProducts ?? []).map((p) => p.value), 1);
                    return (
                      <li key={product.label} className="px-4 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-[13px]">
                            <span className="me-1.5 tabular-nums text-[var(--text-tertiary)]">{index + 1}</span>
                            {product.label}
                          </span>
                          <span className="shrink-0 text-[13px] font-medium tabular-nums">{money(product.value)}</span>
                        </div>
                        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                          <span
                            className="block h-full rounded-full bg-[var(--chart-1)]"
                            style={{ width: `${(product.value / max) * 100}%` }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card flush>
              <CardHeader
                title="Low stock"
                description="At or below the reorder level"
                actions={
                  <Link to="/inventory?lowStock=true" className="text-[13px] text-[var(--accent-text)] hover:underline">
                    Open inventory
                  </Link>
                }
              />
              {(data.lowStock?.length ?? 0) === 0 ? (
                <EmptyState
                  compact
                  icon={AlertTriangle}
                  title="Nothing is running out"
                  description="Every tracked product is above its reorder level."
                />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {(data.lowStock ?? []).slice(0, 6).map((row) => (
                    <li key={`${row.productId}-${row.warehouseId ?? ''}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{row.productName}</p>
                        <p className="truncate text-[12px] text-[var(--text-tertiary)]">
                          {row.warehouseName ?? 'All warehouses'}
                          {row.sku ? ` · ${row.sku}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className={cn('text-[13px] font-medium tabular-nums', row.qtyOnHand <= 0 ? 'text-[var(--danger-text)]' : 'text-[var(--warning-text)]')}>
                          {qty(row.qtyOnHand, row.unitName)}
                        </p>
                        {row.reorderLevel !== undefined && (
                          <p className="text-[12px] text-[var(--text-tertiary)] tabular-nums">
                            min {qty(row.reorderLevel)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card flush>
              <CardHeader
                title="Recent sales"
                actions={
                  <Link to="/sales" className="text-[13px] text-[var(--accent-text)] hover:underline">
                    All sales
                  </Link>
                }
              />
              {(data.recentSales?.length ?? 0) === 0 ? (
                <EmptyState compact title="No sales recorded yet" description="Sales appear here as soon as one is rung up." />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {(data.recentSales ?? []).slice(0, 7).map((sale) => (
                    <li key={sale.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <Link to={`/sales/${sale.id}`} className="truncate text-[13px] font-medium hover:underline">
                          {sale.number}
                        </Link>
                        <p className="truncate text-[12px] text-[var(--text-tertiary)]">
                          {sale.customerName ?? 'Walk-in'} · {dateTime(sale.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={sale.status} />
                        <span className="text-[13px] font-medium tabular-nums">{money(sale.total)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card flush>
              <CardHeader title="Branch performance" description="Revenue by location, last 30 days" />
              {(data.branchPerformance?.length ?? 0) === 0 ? (
                <EmptyState compact icon={Users} title="No branch data" description="Performance appears once more than one branch has sales." />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {(data.branchPerformance ?? []).map((entry) => (
                    <li key={entry.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0 truncate text-[13px]">{entry.label}</span>
                      <span className="shrink-0 text-[13px] font-medium tabular-nums">{money(entry.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {kpis.outstandingReceivables !== undefined && kpis.outstandingReceivables > 0 && (
            <Alert tone="warning" title="Money owed to you">
              {money(kpis.outstandingReceivables)} is outstanding on customer credit sales.{' '}
              <Link to="/invoices?status=PART_PAID" className="underline underline-offset-2">
                Review unpaid invoices
              </Link>
            </Alert>
          )}
        </div>
      ) : null}
    </Page>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-[var(--radius-lg)]" />
        ))}
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-[300px] rounded-[var(--radius-lg)] xl:col-span-2" />
        <Skeleton className="h-[300px] rounded-[var(--radius-lg)]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-64 rounded-[var(--radius-lg)]" />
      </div>
      <span className="sr-only">Loading dashboard</span>
    </div>
  );
}
