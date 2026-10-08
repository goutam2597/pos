import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../db/client.js';
import { handler, ok, created, parseBody, parseQuery, listQuery, page } from '../lib/http.js';
import { context, assertBranchAccess } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import { createSale } from '../modules/sales/sale.service.js';
import { voidSaleInTransaction } from '../modules/sync/sync.service.js';
import { audit } from '../lib/audit.js';
import {
  ACCOUNT_CODES,
  accountIdFor,
  postJournal,
  resolveSystemAccounts,
} from '../modules/accounting/ledger.js';

/**
 * Sales, invoices, payments and shifts.
 *
 * Every mutating endpoint here delegates to a service that runs the whole
 * operation in one transaction. Routes stay thin: validate, authorise, call,
 * shape the response. Business rules do not live at this layer.
 */

export const salesRouter = Router();

const money = z.number().int();

// ---------------------------------------------------------------------------
// Create a sale
// ---------------------------------------------------------------------------

const saleSchema = z.object({
  branchId: z.string().min(1, 'Choose a branch'),
  registerId: z.string().nullish(),
  shiftId: z.string().nullish(),
  customerId: z.string().nullish(),
  channel: z.enum(['POS', 'ONLINE', 'PHONE', 'MANUAL', 'API']).default('POS'),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        qtyMilli: z.number().int().positive('Quantity must be greater than zero'),
        unitPrice: money.nonnegative().optional(),
        discountType: z.enum(['NONE', 'PERCENT', 'FIXED']).default('NONE'),
        discountValue: money.nonnegative().default(0),
        note: z.string().max(500).nullish(),
      }),
    )
    .min(1, 'Add at least one line'),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER']),
        amount: money.positive('Payment amount must be greater than zero'),
        reference: z.string().max(200).nullish(),
        cardLast4: z.string().length(4, 'Last 4 digits').nullish(),
        approvalCode: z.string().max(64).nullish(),
        clientTxnId: z.string().max(100).nullish(),
      }),
    )
    .min(1, 'Record at least one payment'),
  cartDiscount: money.nonnegative().default(0),
  allowCredit: z.boolean().default(false),
  note: z.string().max(1000).nullish(),
  customerNote: z.string().max(1000).nullish(),
  clientTxnId: z.string().max(100).nullish(),
  capturedAt: z.coerce.date().nullish(),
});

salesRouter.post(
  '/sales',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(saleSchema, req);

    const result = await createSale({
      businessId: ctx.businessId,
      branchId: input.branchId,
      registerId: input.registerId ?? null,
      shiftId: input.shiftId ?? null,
      userId: ctx.userId,
      customerId: input.customerId ?? null,
      channel: input.channel,
      lines: input.lines,
      payments: input.payments,
      cartDiscount: input.cartDiscount,
      allowCredit: input.allowCredit,
      note: input.note ?? null,
      customerNote: input.customerNote ?? null,
      clientTxnId: input.clientTxnId ?? null,
      capturedAt: input.capturedAt ?? null,
    });

    // An idempotent replay returns the original sale; report 200, not 201, so
    // the client can tell "created" from "already existed".
    if (result.duplicate) {
      ok(res, result, { message: 'This sale was already recorded.' });
      return;
    }
    created(res, result);
  }),
);

// ---------------------------------------------------------------------------
// List / read sales
// ---------------------------------------------------------------------------

const listSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: z.string().optional(),
  registerId: z.string().optional(),
  customerId: z.string().optional(),
  userId: z.string().optional(),
  status: z.string().optional(),
  channel: z.string().optional(),
  minTotal: z.coerce.number().optional(),
  maxTotal: z.coerce.number().optional(),
});

salesRouter.get(
  '/sales',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(listSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };

    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.branchId) where.branchId = query.branchId;
    if (query.registerId) where.registerId = query.registerId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
      where.total = {
        ...(query.minTotal !== undefined ? { gte: Math.round(query.minTotal * 100) } : {}),
        ...(query.maxTotal !== undefined ? { lte: Math.round(query.maxTotal * 100) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { invoice: { code: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total, totals] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take,
        select: {
          id: true, code: true, status: true, channel: true, occurredAt: true,
          subtotal: true, discountTotal: true, taxTotal: true, total: true,
          paidTotal: true, balanceDue: true, costTotal: true, profitTotal: true,
          branchId: true, branch: { select: { id: true, name: true, code: true } },
          registerId: true,
          userId: true,
          user: { select: { id: true, firstName: true, lastName: true } },
          customerId: true,
          customer: { select: { id: true, name: true } },
          invoice: { select: { id: true, code: true, status: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.sale.count({ where }),
      // Page totals let the list show "3 sales totalling X" without a second
      // round trip or the client recomputing it from a partial page.
      prisma.sale.aggregate({
        where,
        _sum: { total: true, taxTotal: true, discountTotal: true, profitTotal: true },
        _count: true,
      }),
    ]);

    res.json({
      data: rows,
      meta: {
        total,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
        pageCount: Math.max(1, Math.ceil(total / (query.pageSize ?? 25))),
        // Totals cover the WHOLE filtered set, not the current page, so the
        // list can say "412 sales totalling X" without the client summing a
        // partial page and reporting a wrong figure.
        totals: totals._sum,
        count: totals._count,
      },
    });
  }),
);

salesRouter.get(
  '/sales/:id',
  handler(async (req, res) => {
    const ctx = context();
    const sale = await prisma.sale.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      include: {
        items: { orderBy: { position: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true, taxNumber: true } },
        register: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        customer: {
          select: {
            id: true, name: true, email: true, phone: true, address: true,
            city: true, taxNumber: true,
          },
        },
        invoice: true,
        returns: { select: { id: true, code: true, status: true, total: true, returnDate: true } },
        journalEntries: {
          select: { id: true, code: true, source: true, memo: true, date: true, totalDebit: true, status: true },
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!sale) throw notFound('Sale', String(req.params.id));

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { name: true, address: true, city: true, country: true, phone: true, email: true, taxNumber: true, currency: true, logoUrl: true },
    });

    ok(res, { sale, business });
  }),
);

// ---------------------------------------------------------------------------
// Void / refund
// ---------------------------------------------------------------------------

salesRouter.post(
  '/sales/:id/void',
  handler(async (req, res) => {
    const ctx = context();
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }), req);
    const saleId = String(req.params.id);

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, businessId: ctx.businessId },
      select: { id: true, code: true, branchId: true },
    });
    if (!sale) throw notFound('Sale', saleId);
    assertBranchAccess(sale.branchId);

    await transaction((tx) =>
      voidSaleInTransaction(tx, {
        saleId: sale.id,
        businessId: ctx.businessId,
        reason,
        userId: ctx.userId,
      }),
    );

    ok(res, { saleId, status: 'VOIDED' });
  }),
);

const refundSchema = z.object({
  amount: money.positive('Refund amount must be greater than zero'),
  method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER']).default('CASH'),
  reason: z.string().max(300).nullish(),
});

salesRouter.post(
  '/sales/:id/refund',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(refundSchema, req);
    const saleId = String(req.params.id);

    const payment = await transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, businessId: ctx.businessId },
        include: { invoice: true, payments: true },
      });
      if (!sale) throw notFound('Sale', saleId);
      assertBranchAccess(sale.branchId);

      const alreadyRefunded = sale.payments
        .filter((p) => p.type === 'REFUND')
        .reduce((sum, p) => sum + p.amount, 0);
      const refundable = sale.total - alreadyRefunded;

      if (input.amount > refundable) {
        throw new AppError(
          'UNPROCESSABLE',
          `Refund of ${input.amount} exceeds the ${refundable} still refundable on this sale`,
        );
      }

      const record = await tx.payment.create({
        data: {
          businessId: ctx.businessId,
          branchId: sale.branchId,
          type: 'REFUND',
          method: input.method,
          status: 'PAID',
          direction: 'OUT',
          amount: input.amount,
          saleId: sale.id,
          invoiceId: sale.invoice?.id ?? null,
          userId: ctx.userId,
          note: input.reason ?? null,
        },
      });

      // A refund is money leaving the business: credit cash, and reduce the
      // revenue that was recognised on the original sale.
      const accounts = await resolveSystemAccounts(tx, ctx.businessId);
      const cashAccount = await accountIdFor(accounts, ACCOUNT_CODES.CASH);
      const revenueAccount = await accountIdFor(accounts, ACCOUNT_CODES.SALES_REVENUE);

      await postJournal(
        tx,
        {
          businessId: ctx.businessId,
          branchId: sale.branchId,
          source: 'REFUND',
          memo: `Refund against sale ${sale.code}`,
          referenceType: 'SALE',
          referenceId: sale.id,
          saleId: sale.id,
          lines: [
            { account: revenueAccount, debit: input.amount },
            { account: cashAccount, credit: input.amount },
          ],
        },
        accounts,
      );

      const newRefunded = alreadyRefunded + input.amount;
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          refundedTotal: newRefunded,
          status: newRefunded >= sale.total ? 'REFUNDED' : 'RETURNED',
        },
      });

      if (sale.invoice) {
        await tx.invoice.update({
          where: { id: sale.invoice.id },
          data: {
            refundedTotal: newRefunded,
            balanceDue: Math.max(0, sale.total - sale.paidTotal - newRefunded),
          },
        });
      }

      await audit(tx, {
        action: 'UPDATE',
        entityType: 'Payment',
        entityId: record.id,
        entityCode: sale.code,
        after: { refund: input.amount, method: input.method },
      });

      return record;
    });

    created(res, payment);
  }),
);

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const invoiceListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  partyId: z.string().optional(),
  branchId: z.string().optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

salesRouter.get(
  '/invoices',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(invoiceListSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.partyId) where.partyId = query.partyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.overdueOnly) {
      where.balanceDue = { gt: 0 };
      where.dueDate = { lt: new Date() };
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { party: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total, aggregate] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        skip,
        take,
        select: {
          id: true, code: true, type: true, status: true, issueDate: true, dueDate: true,
          subtotal: true, discountTotal: true, taxTotal: true, total: true,
          paidTotal: true, balanceDue: true, currency: true,
          partyId: true,
          party: { select: { id: true, name: true, email: true, phone: true } },
          saleId: true, purchaseId: true, returnId: true,
          branch: { select: { id: true, name: true } },
          sale: {
            select: {
              id: true, code: true, channel: true, occurredAt: true,
              items: {
                select: {
                  id: true, productName: true, sku: true, qtyMilli: true,
                  unitPrice: true, lineTotal: true, taxAmount: true, position: true,
                },
                orderBy: { position: 'asc' },
              },
            },
          },
        },
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({
        where,
        _sum: { total: true, paidTotal: true, balanceDue: true, taxTotal: true },
      }),
    ]);

    res.json({
      data: rows,
      meta: {
        total,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
        pageCount: Math.max(1, Math.ceil(total / (query.pageSize ?? 25))),
        totals: aggregate._sum,
      },
    });
  }),
);

salesRouter.get(
  '/invoices/:id',
  handler(async (req, res) => {
    const ctx = context();
    const invoice = await prisma.invoice.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      include: {
        party: {
          select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, postalCode: true, country: true, taxNumber: true },
        },
        branch: { select: { id: true, name: true, address: true, city: true, phone: true, taxNumber: true } },
        payments: { orderBy: { paidAt: 'asc' } },
        lines: { orderBy: { position: 'asc' } },
        sale: {
          select: {
            id: true, code: true, channel: true, occurredAt: true,
            user: { select: { firstName: true, lastName: true } },
            register: { select: { name: true } },
            items: {
              select: {
                id: true, productId: true, variantId: true, productName: true, variantName: true,
                sku: true, unitName: true, qtyMilli: true, unitPrice: true,
                discountAmount: true, allocatedDiscount: true, taxRate: true, taxAmount: true,
                lineSubtotal: true, lineTotal: true, position: true, note: true,
              },
              orderBy: { position: 'asc' },
            },
          },
        },
        purchase: {
          select: {
            id: true, code: true, supplierRef: true, invoiceDate: true,
            items: {
              select: {
                id: true, productName: true, sku: true, qtyMilli: true,
                unitCost: true, lineTotal: true, taxAmount: true, position: true,
              },
              orderBy: { position: 'asc' },
            },
          },
        },
        return: {
          select: {
            id: true, code: true, returnDate: true,
            items: {
              select: { id: true, productName: true, sku: true, qtyMilli: true, unitPrice: true, lineTotal: true, position: true },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!invoice) throw notFound('Invoice', String(req.params.id));

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { name: true, legalName: true, address: true, city: true, country: true, phone: true, email: true, taxNumber: true, currency: true, logoUrl: true },
    });

    ok(res, { invoice, business });
  }),
);

/** Mark an invoice as printed; drives the print counter used in disputes. */
salesRouter.post(
  '/invoices/:id/printed',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const result = await prisma.invoice.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { printCount: { increment: 1 }, lastPrintedAt: new Date() },
    });
    if (result.count === 0) throw notFound('Invoice', id);
    ok(res, { printCount: 'recorded' });
  }),
);

// ---------------------------------------------------------------------------
// Shifts (cash drawer sessions)
// ---------------------------------------------------------------------------

salesRouter.get(
  '/shifts/current',
  handler(async (req, res) => {
    const ctx = context();
    const registerId = req.query.registerId ? String(req.query.registerId) : undefined;

    const shift = await prisma.shift.findFirst({
      where: {
        businessId: ctx.businessId,
        status: 'OPEN',
        ...(registerId ? { registerId } : { userId: ctx.userId }),
      },
      include: {
        register: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        movements: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { openedAt: 'desc' },
    });

    if (!shift) {
      ok(res, null);
      return;
    }

    // Expected drawer contents, computed from the ledger rather than counted.
    const [cashSales, cashRefunds, drops] = await Promise.all([
      prisma.payment.aggregate({
        where: { shiftId: shift.id, type: 'SALE', method: 'CASH', direction: 'IN', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { shiftId: shift.id, type: 'REFUND', method: 'CASH', direction: 'OUT', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.cashMovement.aggregate({
        where: { shiftId: shift.id, type: { in: ['DROP', 'PAYOUT'] } },
        _sum: { amount: true },
      }),
    ]);

    const expected =
      shift.openingFloat + (cashSales._sum.amount ?? 0) - (cashRefunds._sum.amount ?? 0) - (drops._sum.amount ?? 0);

    ok(res, { ...shift, expectedCash: expected, variance: (shift.closingCount ?? expected) - expected });
  }),
);

const openShiftSchema = z.object({
  registerId: z.string().min(1),
  openingFloat: money.nonnegative().default(0),
});

salesRouter.post(
  '/shifts/open',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(openShiftSchema, req);

    const register = await prisma.register.findFirst({
      where: { id: input.registerId, businessId: ctx.businessId },
      select: { id: true, branchId: true, name: true },
    });
    if (!register) throw notFound('Register', input.registerId);
    assertBranchAccess(register.branchId);

    const existing = await prisma.shift.findFirst({
      where: { registerId: register.id, status: 'OPEN' },
      select: { id: true, userId: true },
    });
    if (existing) {
      throw new AppError('CONFLICT', 'This register already has an open shift. Close it before opening another.');
    }

    const shift = await prisma.shift.create({
      data: {
        businessId: ctx.businessId,
        branchId: register.branchId,
        registerId: register.id,
        userId: ctx.userId,
        openingFloat: input.openingFloat,
        expectedCash: input.openingFloat,
      },
      include: { register: { select: { id: true, name: true, code: true } } },
    });

    created(res, shift);
  }),
);

const closeShiftSchema = z.object({
  closingCount: money.nonnegative(),
  note: z.string().max(300).nullish(),
});

salesRouter.post(
  '/shifts/:id/close',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(closeShiftSchema, req);

    const shift = await prisma.shift.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      select: { id: true, status: true, openingFloat: true },
    });
    if (!shift) throw notFound('Shift', String(req.params.id));
    if (shift.status !== 'OPEN') throw new AppError('CONFLICT', 'This shift is already closed');

    const [cashSales, cashRefunds, drops] = await Promise.all([
      prisma.payment.aggregate({
        where: { shiftId: shift.id, type: 'SALE', method: 'CASH', direction: 'IN', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { shiftId: shift.id, type: 'REFUND', method: 'CASH', direction: 'OUT', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.cashMovement.aggregate({
        where: { shiftId: shift.id, type: { in: ['DROP', 'PAYOUT'] } },
        _sum: { amount: true },
      }),
    ]);

    const expected =
      shift.openingFloat + (cashSales._sum.amount ?? 0) - (cashRefunds._sum.amount ?? 0) - (drops._sum.amount ?? 0);

    const closed = await prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closingCount: input.closingCount,
        expectedCash: expected,
        variance: input.closingCount - expected,
        closeNote: input.note ?? null,
      },
    });

    // A variance beyond a few units of currency is worth an audit trail; it is
    // the single most useful signal for spotting till skimming.
    if (Math.abs(closed.variance) > 500) {
      await prisma.auditLog.create({
        data: {
          businessId: ctx.businessId,
          userId: ctx.userId,
          action: 'UPDATE',
          entityType: 'Shift',
          entityId: closed.id,
          changes: { variance: closed.variance, expected, counted: input.closingCount },
        },
      });
    }

    ok(res, closed);
  }),
);

// ---------------------------------------------------------------------------
// Held carts
// ---------------------------------------------------------------------------

salesRouter.get(
  '/holds',
  handler(async (req, res) => {
    const ctx = context();
    const holds = await prisma.saleHold.findMany({
      where: {
        businessId: ctx.businessId,
        ...(ctx.branchIds.length > 0 ? { branchId: { in: ctx.branchIds } } : {}),
        ...(req.query.branchId ? { branchId: String(req.query.branchId) } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, label: true, createdAt: true, expiresAt: true, branchId: true },
    });
    ok(res, holds);
  }),
);

salesRouter.delete(
  '/holds/:id',
  handler(async (req, res) => {
    const ctx = context();
    const result = await prisma.saleHold.deleteMany({
      where: { id: String(req.params.id), businessId: ctx.businessId },
    });
    if (result.count === 0) throw notFound('Held sale', String(req.params.id));
    res.status(204).end();
  }),
);
