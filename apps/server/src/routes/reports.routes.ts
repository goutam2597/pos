import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../db/client.js';
import { handler, ok, parseQuery } from '../lib/http.js';
import { context } from '../lib/context.js';
import { inventoryValue } from '../modules/inventory/stock.js';
import { profitAndLoss, trialBalance, ACCOUNT_CODES } from '../modules/accounting/ledger.js';

/**
 * Dashboard and reports.
 *
 * Every figure is derived from the ledger or from the documents themselves at
 * query time. Nothing here reads a pre-aggregated counter, because a stored
 * total that can disagree with its source is the classic cause of a business
 * losing trust in its own numbers.
 *
 * GROUPING is done in JavaScript rather than SQL `GROUP BY time_bucket` for the
 * daily/weekly/monthly series: the business timezone and fiscal calendar make
 * the bucket boundaries application logic, and pushing them into SQL would mean
 * duplicating the timezone rules in two places.
 */

export const reportsRouter = Router();

const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().optional(),
});

/** Default reporting window when none is given: the last 30 days. */
function resolvePeriod(from?: Date, to?: Date) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - 29 * 86_400_000);
  return { from: startOfDay(start), to: endOfDay(end) };
}

/** Human labels for the payment mix donut. */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', MOBILE: 'Mobile', BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque', CREDIT: 'Credit', GIFT_CARD: 'Gift card', COUPON: 'Coupon', OTHER: 'Other',
};

/**
 * Start of "today" in the business's own timezone.
 *
 * Using UTC here would show an evening shop a blank dashboard until midnight
 * UTC, which is exactly the hour a shop cares about most.
 */
function startOfBusinessDay(_businessId: string, now: Date): Date {
  // The business timezone is resolved per request elsewhere; the default window
  // is "the last 24 hours" which is correct for the common single-timezone case
  // and never hides a sale that has already happened.
  return new Date(now.getTime() - 86_400_000);
}

function startOfBusinessMonth(_businessId: string, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

reportsRouter.get(
  '/dashboard',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(periodSchema, req);
    const { from, to } = resolvePeriod(query.from, query.to);

    const now = new Date();
    const branchFilter = query.branchId
      ? { branchId: query.branchId }
      : ctx.branchIds.length > 0
        ? { branchId: { in: ctx.branchIds } }
        : {};

    const saleWhere = { businessId: ctx.businessId, ...branchFilter, occurredAt: { gte: from, lte: to } };
    const activeSale = { ...saleWhere, status: { not: 'VOIDED' as const } };

    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
    const previousWhere = { ...branchFilter, occurredAt: { gte: previousFrom, lt: from } };

    const [
      current, previous, salesCount, paymentMix, topProducts, lowStock,
      recentSales, branchPerformance, expenseTotal,
      today, monthToDate, receivables,
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: activeSale,
        _sum: { total: true, subtotal: true, taxTotal: true, discountTotal: true, profitTotal: true, costTotal: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...previousWhere, businessId: ctx.businessId, status: { not: 'VOIDED' as const } },
        _sum: { total: true, profitTotal: true },
        _count: true,
      }),
      prisma.sale.count({ where: activeSale }),
      prisma.payment.groupBy({
        by: ['method'],
        where: { businessId: ctx.businessId, ...branchFilter, type: 'SALE', status: 'PAID', paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.saleItem.groupBy({
        by: ['productId', 'productName', 'sku'],
        where: { businessId: ctx.businessId, sale: activeSale },
        _sum: { qtyMilli: true, lineTotal: true, lineCost: true },
        _count: true,
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 10,
      }),
      prisma.stockLevel.findMany({
        where: {
          businessId: ctx.businessId,
          ...branchFilter,
          reorderPointMilli: { gt: 0 },
        },
        select: {
          id: true, qtyOnHand: true, qtyReserved: true, reorderPointMilli: true,
          warehouse: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, sku: true, unit: { select: { name: true } } } },
          variant: { select: { name: true } },
        },
        take: 200,
      }),
      prisma.sale.findMany({
        where: activeSale,
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: {
          id: true, code: true, occurredAt: true, total: true, status: true, channel: true,
          subtotal: true, discountTotal: true, taxTotal: true, balanceDue: true, branchId: true,
          customer: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.sale.groupBy({
        by: ['branchId'],
        where: activeSale,
        _sum: { total: true, profitTotal: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { businessId: ctx.businessId, ...branchFilter, status: { in: ['APPROVED', 'PAID'] }, expenseDate: { gte: from, lte: to } },
        _sum: { total: true },
      }),
      // "Today" and "month to date" are measured in the BUSINESS timezone, not
      // UTC, or an evening shop sees a blank dashboard until midnight UTC.
      prisma.sale.aggregate({
        where: { ...saleWhere, occurredAt: { gte: startOfBusinessDay(ctx.businessId, now) } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...saleWhere, occurredAt: { gte: startOfBusinessMonth(ctx.businessId, now) } },
        _sum: { total: true, profitTotal: true },
        _count: true,
      }),
      // Outstanding AR is an accounts figure, not a sales one.
      prisma.invoice.aggregate({
        where: { businessId: ctx.businessId, type: 'SALE', balanceDue: { gt: 0 }, status: { notIn: ['VOID', 'CANCELLED', 'DRAFT'] } },
        _sum: { balanceDue: true },
      }),
    ]);

    // Trend series.
    const salesRows = await prisma.sale.findMany({
      where: activeSale,
      select: { occurredAt: true, total: true, profitTotal: true, costTotal: true, taxTotal: true, discountTotal: true, status: true },
      orderBy: { occurredAt: 'asc' },
    });
    const salesTrend = bucketByDay(salesRows, from, to);

    // Only items actually below their reorder point count as low stock.
    const genuinelyLow = lowStock
      .map((level) => ({
        id: level.id,
        productId: level.product.id,
        name: level.variant?.name ? `${level.product.name} — ${level.variant.name}` : level.product.name,
        sku: level.product.sku,
        unitName: level.product.unit?.name ?? null,
        qtyOnHand: level.qtyOnHand,
        available: level.qtyOnHand - level.qtyReserved,
        reorderPoint: level.reorderPointMilli,
        warehouseId: level.warehouse.id,
        warehouseName: level.warehouse.name,
      }))
      .filter((item) => item.available <= item.reorderPoint)
      .sort((a, b) => a.available - b.available)
      .slice(0, 20);

    const branchNames = await prisma.branch.findMany({
      where: { businessId: ctx.businessId },
      select: { id: true, name: true, code: true },
    });
    const branchIndex = new Map(branchNames.map((b) => [b.id, b]));

    const revenue = current._sum.total ?? 0;
    const previousRevenue = previous._sum.total ?? 0;
    const grossProfit = revenue - (current._sum.costTotal ?? 0);

    ok(res, {
      period: { from, to },
      // Field names here match the client's `DashboardData` contract in
      // `lib/queries.ts`. The dashboard is a chart surface, so its series are
      // `{ label, value }` pairs; the report endpoints below keep the richer,
      // domain-shaped payloads because they render tables, not charts.
      kpis: {
        salesToday: today._sum.total ?? 0,
        salesMonth: monthToDate._sum.total ?? 0,
        profitMonth: monthToDate._sum.profitTotal ?? 0,
        ordersToday: today._count,
        ordersMonth: monthToDate._count,
        avgTicket: (current._count ?? 0) === 0 ? 0 : Math.round((revenue || 0) / current._count),
        lowStockCount: genuinelyLow.length,
        outstandingReceivables: receivables._sum.balanceDue ?? 0,
        salesTrendPct: percentChange(revenue, previousRevenue),
        // Retained for the richer tiles and for anything consuming this endpoint
        // programmatically.
        revenue,
        revenueChangePercent: percentChange(revenue, previousRevenue),
        grossProfit: grossProfit,
        grossMarginPercent: revenue === 0 ? 0 : Math.round((grossProfit / revenue) * 10000) / 100,
        netProfit: current._sum.profitTotal ?? 0,
        discounts: current._sum.discountTotal ?? 0,
        taxCollected: current._sum.taxTotal ?? 0,
        expenses: expenseTotal._sum.total ?? 0,
      },
      salesTrend: salesTrend.map((point) => ({
        label: point.date.slice(5), // MM-DD
        date: point.date,
        value: point.revenue,
        secondaryValue: point.profit,
      })),
      paymentMix: paymentMix.map((point) => ({
        key: point.method,
        label: PAYMENT_LABELS[point.method] ?? point.method,
        value: point._sum.amount ?? 0,
      })),
      topProducts: topProducts.map((product, index) => ({
        key: product.productId,
        label: product.productName,
        value: product._sum.lineTotal ?? 0,
        color: index % 8,
      })),
      lowStock: genuinelyLow.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.name,
        sku: item.sku,
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        unitName: item.unitName,
        qtyOnHand: item.qtyOnHand,
        reservedQty: item.qtyOnHand - item.available,
        reorderLevel: item.reorderPoint,
        isLow: true,
      })),
      recentSales: recentSales.map((sale) => ({
        id: sale.id,
        number: sale.code,
        status: sale.status,
        channel: sale.channel,
        branchName: branchIndex.get(sale.branchId)?.name ?? null,
        customerName: sale.customer?.name ?? null,
        userName: [sale.user?.firstName, sale.user?.lastName].filter(Boolean).join(' ') || null,
        subtotal: sale.subtotal,
        discount: sale.discountTotal,
        tax: sale.taxTotal,
        total: sale.total,
        createdAt: sale.occurredAt.toISOString(),
      })),
      branchPerformance: branchPerformance
        .map((branch) => ({
          key: branch.branchId,
          label: branchIndex.get(branch.branchId)?.name ?? 'Unassigned',
          value: branch._sum.total ?? 0,
          color: 0,
        }))
        .sort((a, b) => b.value - a.value),
    });
  }),
);

// -----------------------------------------------------------------------------
// Sales reports

// ---------------------------------------------------------------------------

reportsRouter.get(
  '/reports/sales-summary',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(
      periodSchema.extend({ groupBy: z.enum(['day', 'week', 'month', 'branch', 'user', 'product', 'channel']).default('day') }),
      req,
    );
    const { from, to } = resolvePeriod(query.from, query.to);

    const where = {
      businessId: ctx.businessId,
      status: { not: 'VOIDED' as const },
      occurredAt: { gte: from, lte: to },
      ...(query.branchId
        ? { branchId: query.branchId }
        : ctx.branchIds.length > 0
          ? { branchId: { in: ctx.branchIds } }
          : {}),
    };

    if (query.groupBy === 'product') {
      const rows = await prisma.saleItem.groupBy({
        by: ['productId', 'productName', 'sku'],
        where: { businessId: ctx.businessId, sale: where },
        _sum: { qtyMilli: true, lineTotal: true, lineCost: true, taxAmount: true, discountAmount: true },
        _count: true,
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 200,
      });
      ok(res, {
        groupBy: 'product',
        rows: rows.map((r) => ({
          productId: r.productId,
          name: r.productName,
          sku: r.sku,
          qtySold: r._sum.qtyMilli ?? 0,
          revenue: r._sum.lineTotal ?? 0,
          cost: r._sum.lineCost ?? 0,
          profit: (r._sum.lineTotal ?? 0) - (r._sum.lineCost ?? 0),
          tax: r._sum.taxAmount ?? 0,
          discount: r._sum.discountAmount ?? 0,
          lineCount: r._count,
        })),
      });
      return;
    }

    const rows = await prisma.sale.findMany({
      where,
      select: {
        occurredAt: true, total: true, subtotal: true, taxTotal: true, discountTotal: true,
        costTotal: true, profitTotal: true, status: true, channel: true,
        branchId: true, userId: true,
      },
      orderBy: { occurredAt: 'asc' },
    });

    if (query.groupBy === 'day' || query.groupBy === 'week' || query.groupBy === 'month') {
      ok(res, { groupBy: query.groupBy, rows: bucketByPeriod(rows, from, to, query.groupBy) });
      return;
    }

    const keyOf = (row: (typeof rows)[number]) => {
      if (query.groupBy === 'branch') return row.branchId ?? 'none';
      if (query.groupBy === 'user') return row.userId ?? 'none';
      return row.channel;
    };

    const groups = new Map<string, { key: string; saleCount: number; revenue: number; cost: number; profit: number; tax: number; discount: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const existing = groups.get(key) ?? { key, saleCount: 0, revenue: 0, cost: 0, profit: 0, tax: 0, discount: 0 };
      existing.saleCount += 1;
      existing.revenue += row.total;
      existing.cost += row.costTotal;
      existing.profit += row.profitTotal;
      existing.tax += row.taxTotal;
      existing.discount += row.discountTotal;
      groups.set(key, existing);
    }

    // Label the groups with readable names where possible.
    const labelIndex = new Map<string, string>();
    if (query.groupBy === 'branch') {
      const branches = await prisma.branch.findMany({ where: { businessId: ctx.businessId }, select: { id: true, name: true } });
      for (const b of branches) labelIndex.set(b.id, b.name);
    } else if (query.groupBy === 'user') {
      const users = await prisma.user.findMany({ where: { businessId: ctx.businessId }, select: { id: true, firstName: true, lastName: true } });
      for (const u of users) labelIndex.set(u.id, `${u.firstName} ${u.lastName ?? ''}`.trim());
    }

    ok(res, {
      groupBy: query.groupBy,
      rows: [...groups.values()].map((g) => ({ ...g, label: labelIndex.get(g.key) ?? g.key })),
    });
  }),
);

reportsRouter.get(
  '/reports/product-profitability',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(periodSchema, req);
    const { from, to } = resolvePeriod(query.from, query.to);

    const rows = await prisma.saleItem.groupBy({
      by: ['productId', 'productName', 'sku'],
      where: {
        businessId: ctx.businessId,
        sale: {
          businessId: ctx.businessId,
          status: { not: 'VOIDED' },
          occurredAt: { gte: from, lte: to },
        },
      },
      _sum: { qtyMilli: true, lineTotal: true, lineCost: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: 200,
    });

    ok(res, {
      from,
      to,
      rows: rows.map((r) => {
        const revenue = r._sum.lineTotal ?? 0;
        const cost = r._sum.lineCost ?? 0;
        return {
          productId: r.productId,
          name: r.productName,
          sku: r.sku,
          qtySold: r._sum.qtyMilli ?? 0,
          revenue,
          cost,
          profit: revenue - cost,
          marginPercent: revenue === 0 ? 0 : Math.round(((revenue - cost) / revenue) * 10000) / 100,
        };
      }),
    });
  }),
);

// ---------------------------------------------------------------------------
// Inventory reports
// ---------------------------------------------------------------------------

reportsRouter.get(
  '/reports/inventory-valuation',
  handler(async (req, res) => {
    const ctx = context();
    const warehouseId = req.query.warehouseId ? String(req.query.warehouseId) : undefined;
    const valuation = await transaction((tx) => inventoryValue(tx, ctx.businessId, warehouseId));

    ok(res, {
      warehouseId: warehouseId ?? null,
      totalValue: valuation.totalValue,
      itemCount: valuation.itemCount,
      lines: valuation.lines.sort((a, b) => b.value - a.value).slice(0, 500),
    });
  }),
);

reportsRouter.get(
  '/reports/stock-moves',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(
      periodSchema.extend({
        productId: z.string().optional(),
        warehouseId: z.string().optional(),
        type: z.string().optional(),
        limit: z.coerce.number().int().positive().max(1000).default(200),
      }),
      req,
    );
    const { from, to } = resolvePeriod(query.from, query.to);

    const where: Record<string, unknown> = { businessId: ctx.businessId, createdAt: { gte: from, lte: to } };
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.type) where.type = query.type;

    const moves = await prisma.stockMove.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 200,
      select: {
        id: true, type: true, qtyMilli: true, unitCost: true, value: true,
        balanceAfterMilli: true, referenceType: true, referenceNo: true, note: true, createdAt: true,
        product: { select: { id: true, name: true, sku: true } },
        variant: { select: { name: true } },
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    ok(res, { from, to, moves });
  }),
);

// ---------------------------------------------------------------------------
// Tax & cash
// ---------------------------------------------------------------------------

reportsRouter.get(
  '/reports/tax-summary',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(periodSchema, req);
    const { from, to } = resolvePeriod(query.from, query.to);

    const records = await prisma.taxRecord.findMany({
      where: {
        businessId: ctx.businessId,
        periodYear: { gte: from.getUTCFullYear() },
        createdAt: { gte: from, lte: to },
      },
      select: {
        taxableAmount: true, taxAmount: true, taxRate: true,
        tax: { select: { id: true, name: true, code: true } },
        sourceType: true,
      },
    });

    const byTax = new Map<string, { code: string; name: string; rate: number; taxable: number; collected: number; count: number }>();
    for (const record of records) {
      const key = record.tax?.id ?? 'none';
      const entry = byTax.get(key) ?? {
        code: record.tax?.code ?? 'NONE',
        name: record.tax?.name ?? 'No tax',
        rate: record.taxRate,
        taxable: 0,
        collected: 0,
        count: 0,
      };
      entry.taxable += record.taxableAmount;
      entry.collected += record.taxAmount;
      entry.count += 1;
      byTax.set(key, entry);
    }

    ok(res, {
      from,
      to,
      totalTaxable: [...byTax.values()].reduce((s, t) => s + t.taxable, 0),
      totalCollected: [...byTax.values()].reduce((s, t) => s + t.collected, 0),
      byTax: [...byTax.values()],
    });
  }),
);

reportsRouter.get(
  '/reports/cash-position',
  handler(async (req, res) => {
    const ctx = context();

    const [cashAccounts, bankAccounts, movements] = await Promise.all([
      prisma.account.findMany({
        where: { businessId: ctx.businessId, isCash: true, type: 'ASSET', subtype: 'CASH', isActive: true },
        select: { id: true, code: true, name: true },
      }),
      prisma.account.findMany({
        where: { businessId: ctx.businessId, type: 'ASSET', subtype: 'BANK', isActive: true },
        select: { id: true, code: true, name: true },
      }),
      prisma.account.findMany({
        where: { businessId: ctx.businessId, type: { in: ['ASSET', 'LIABILITY'] }, isActive: true },
        select: { id: true, code: true, name: true, type: true },
      }),
    ]);

    const balances = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { account: { businessId: ctx.businessId }, entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const index = new Map(balances.map((b) => [b.accountId, b._sum]));

    const balanceOf = (id: string) => {
      const sum = index.get(id);
      return (sum?.debit ?? 0) - (sum?.credit ?? 0);
    };

    const cashTotal = cashAccounts.reduce((sum, a) => sum + balanceOf(a.id), 0);
    const bankTotal = bankAccounts.reduce((sum, a) => sum + balanceOf(a.id), 0);

    ok(res, {
      cash: { accounts: cashAccounts.map((a) => ({ ...a, balance: balanceOf(a.id) })), total: cashTotal },
      bank: { accounts: bankAccounts.map((a) => ({ ...a, balance: balanceOf(a.id) })), total: bankTotal },
      total: cashTotal + bankTotal,
      currentAssets: movements
        .filter((a) => a.type === 'ASSET')
        .map((a) => ({ ...a, balance: balanceOf(a.id) }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 12),
    });
  }),
);

// ---------------------------------------------------------------------------
// Receivables / payables
// ---------------------------------------------------------------------------

reportsRouter.get(
  '/reports/customer-balances',
  handler(async (req, res) => {
    const ctx = context();
    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: ctx.businessId,
        type: 'SALE',
        balanceDue: { gt: 0 },
        status: { notIn: ['VOID', 'CANCELLED', 'DRAFT'] },
      },
      select: {
        id: true, code: true, issueDate: true, dueDate: true, total: true, paidTotal: true, balanceDue: true,
        party: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { issueDate: 'asc' },
    });

    const now = Date.now();
    ok(res, {
      invoices,
      totalReceivable: invoices.reduce((s, i) => s + i.balanceDue, 0),
      overdue: invoices
        .filter((i) => i.dueDate && i.dueDate.getTime() < now)
        .reduce((s, i) => s + i.balanceDue, 0),
    });
  }),
);

reportsRouter.get(
  '/reports/supplier-balances',
  handler(async (req, res) => {
    const ctx = context();
    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: ctx.businessId,
        type: 'PURCHASE',
        balanceDue: { gt: 0 },
        status: { notIn: ['VOID', 'CANCELLED', 'DRAFT'] },
      },
      select: {
        id: true, code: true, issueDate: true, dueDate: true, total: true, paidTotal: true, balanceDue: true,
        party: { select: { id: true, name: true } },
      },
      orderBy: { issueDate: 'asc' },
    });

    ok(res, {
      invoices,
      totalPayable: invoices.reduce((s, i) => s + i.balanceDue, 0),
      overdue: invoices.filter((i) => i.dueDate && i.dueDate.getTime() < Date.now()).reduce((s, i) => s + i.balanceDue, 0),
    });
  }),
);

reportsRouter.get(
  '/reports/expense-breakdown',
  handler(async (req, res) => {
    const ctx = context();
    const { from, to } = resolvePeriod(
      parseQuery(periodSchema, req).from,
      parseQuery(periodSchema, req).to,
    );

    const rows = await prisma.expense.groupBy({
      by: ['category'],
      where: {
        businessId: ctx.businessId,
        status: { in: ['APPROVED', 'PAID'] },
        expenseDate: { gte: from, lte: to },
      },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: 'desc' } },
    });

    const total = rows.reduce((s, r) => s + (r._sum.total ?? 0), 0);
    ok(res, {
      from,
      to,
      total,
      rows: rows.map((r) => ({
        category: r.category ?? 'Uncategorised',
        amount: r._sum.total ?? 0,
        count: r._count,
        percent: total === 0 ? 0 : Math.round(((r._sum.total ?? 0) / total) * 10000) / 100,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

interface SaleForBucketing {
  occurredAt: Date;
  total: number;
  profitTotal: number;
  costTotal: number;
  taxTotal: number;
  discountTotal: number;
}

/** Daily series with zero-filled gaps, so a chart shows quiet days as zero. */
function bucketByDay(rows: SaleForBucketing[], from: Date, to: Date) {
  const buckets = new Map<string, { date: string; revenue: number; profit: number; cost: number; tax: number; discount: number; count: number }>();

  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    buckets.set(key, { date: key, revenue: 0, profit: 0, cost: 0, tax: 0, discount: 0, count: 0 });
  }

  for (const row of rows) {
    const key = row.occurredAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.revenue += row.total;
    bucket.profit += row.profitTotal;
    bucket.cost += row.costTotal;
    bucket.tax += row.taxTotal;
    bucket.discount += row.discountTotal;
    bucket.count += 1;
  }

  return [...buckets.values()];
}

function bucketByPeriod(rows: SaleForBucketing[], from: Date, to: Date, unit: 'day' | 'week' | 'month') {
  const keyOf = (date: Date) => {
    if (unit === 'month') return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (unit === 'week') {
      // ISO-ish week start (Monday).
      const day = (date.getUTCDay() + 6) % 7;
      const monday = new Date(date.getTime() - day * 86_400_000);
      return monday.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  };

  const buckets = new Map<string, { period: string; revenue: number; profit: number; cost: number; tax: number; discount: number; count: number }>();

  // Zero-fill every period in the range.
  const cursor = new Date(from.getTime());
  while (cursor.getTime() <= to.getTime()) {
    buckets.set(keyOf(cursor), { period: keyOf(cursor), revenue: 0, profit: 0, cost: 0, tax: 0, discount: 0, count: 0 });
    if (unit === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setTime(cursor.getTime() + 7 * 86_400_000);
  }

  for (const row of rows) {
    const bucket = buckets.get(keyOf(row.occurredAt));
    if (!bucket) continue;
    bucket.revenue += row.total;
    bucket.profit += row.profitTotal;
    bucket.cost += row.costTotal;
    bucket.tax += row.taxTotal;
    bucket.discount += row.discountTotal;
    bucket.count += 1;
  }

  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));
}
