import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../../db/client.js';
import { handler, ok, created, parseBody, parseQuery, listQuery, page, toDateSchema } from '../../lib/http.js';
import { context, assertBranchAccess } from '../../lib/context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { nextNumber } from '../../lib/numbering.js';
import {
  ACCOUNT_CODES,
  accountIdFor,
  postJournal,
  resolveSystemAccounts,
} from './ledger.js';

/**
 * Returns and expenses.
 *
 * Both are "documents that move money and stock", and both must post to the
 * ledger in the same transaction as the document itself — a return that adjusts
 * stock without reversing revenue, or an approved expense that never reaches
 * the P&L, is exactly the drift that makes an ERP untrustworthy.
 */

export const purchasingRouter = Router();

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

const returnListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  from: toDateSchema.optional(),
  to: toDateSchema.optional(),
  branchId: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  direction: z.string().optional(),
  partyId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

purchasingRouter.get(
  '/returns',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(returnListSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.partyId) where.OR = [{ customerId: query.partyId }, { supplierId: query.partyId }];
    if (query.direction === 'IN') where.type = 'SALE_RETURN';
    if (query.direction === 'OUT') where.type = 'PURCHASE_RETURN';
    if (query.from || query.to) {
      where.returnDate = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.return.findMany({
        where,
        orderBy: { returnDate: 'desc' },
        skip,
        take,
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          returnDate: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          refundedTotal: true,
          restock: true,
          reason: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          saleId: true,
          purchaseId: true,
          _count: { select: { items: true } },
        },
      }),
      prisma.return.count({ where }),
    ]);

    page(
      res,
      rows.map((row) => ({
        ...row,
        partyName: row.customer?.name ?? row.supplier?.name ?? null,
        partyId: row.customer?.id ?? row.supplier?.id ?? null,
        branchName: row.branch.name,
      })),
      total,
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }),
);

const createReturnSchema = z.object({
  type: z.enum(['SALE_RETURN', 'PURCHASE_RETURN']),
  branchId: z.string().min(1),
  partyId: z.string().nullish(),
  saleId: z.string().nullish(),
  purchaseId: z.string().nullish(),
  returnDate: z.coerce.date().optional(),
  reason: z.string().trim().max(300).nullish(),
  restock: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        qtyMilli: z.number().int().positive('Quantity must be greater than zero'),
        unitPrice: z.number().int().nonnegative().optional(),
        /** Return to quarantine rather than back into sellable stock. */
        toQuarantine: z.boolean().default(false),
      }),
    )
    .min(1, 'Add at least one line'),
});

purchasingRouter.post(
  '/returns',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(createReturnSchema, req);
    assertBranchAccess(input.branchId);

    const created_ = await transaction(async (tx) => {
      const { applyMove } = await import('../inventory/stock.js');

      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, businessId: ctx.businessId },
        select: { id: true, name: true },
      });
      if (!branch) throw notFound('Branch', input.branchId);

      // Resolved once and reused for the journal below.
      const accounts = await resolveSystemAccounts(tx, ctx.businessId);
      const revenueAccountId = await accountIdFor(accounts, ACCOUNT_CODES.SALES_REVENUE);
      const inventoryAccountId = await accountIdFor(accounts, ACCOUNT_CODES.INVENTORY);
      const taxAccountId = await accountIdFor(accounts, ACCOUNT_CODES.TAX_PAYABLE);
      const cogsAccountId = await accountIdFor(accounts, ACCOUNT_CODES.COGS);

      const code = await nextNumber(tx, {
        businessId: ctx.businessId,
        branchId: input.branchId,
        type: 'RETURN',
      });

      // Resolve prices: an explicit line price wins, otherwise the original
      // document's price, otherwise the catalogue price.
      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] }, businessId: ctx.businessId },
        select: { id: true, name: true, sku: true, price: true, costPrice: true, tax: { select: { rate: true } }, trackInventory: true },
      });
      const index = new Map(products.map((p) => [p.id, p]));
      const warehouse = await tx.warehouse.findFirst({
        where: { businessId: ctx.businessId, branchId: input.branchId, isActive: true },
        orderBy: { isRetail: 'desc' },
        select: { id: true },
      });

      let subtotal = 0;
      let taxTotal = 0;
      const items = [];

      for (const line of input.lines) {
        const product = index.get(line.productId);
        if (!product) throw notFound('Product', line.productId);

        const unitPrice = line.unitPrice ?? product.price;
        const lineSubtotal = Math.round((line.qtyMilli * unitPrice) / 1000);
        // rate is basis points (1000 = 10%); round half away from zero.
        const lineTax = Math.round((lineSubtotal * (product.tax?.rate ?? 0)) / 10_000);

        subtotal += lineSubtotal;
        taxTotal += lineTax;

        items.push({
          productId: line.productId,
          variantId: line.variantId ?? null,
          productName: product.name,
          sku: product.sku,
          qtyMilli: line.qtyMilli,
          unitPrice,
          taxRate: product.tax?.rate ?? 0,
          taxAmount: lineTax,
          lineSubtotal,
          lineTotal: lineSubtotal + lineTax,
          unitCost: product.costPrice,
          toQuarantine: line.toQuarantine,
        });
      }

      const record = await tx.return.create({
        data: {
          businessId: ctx.businessId,
          branchId: input.branchId,
          type: input.type,
          status: 'COMPLETED',
          customerId: input.type === 'SALE_RETURN' ? (input.partyId ?? null) : null,
          supplierId: input.type === 'PURCHASE_RETURN' ? (input.partyId ?? null) : null,
          saleId: input.saleId ?? null,
          purchaseId: input.purchaseId ?? null,
          userId: ctx.userId,
          code,
          returnDate: input.returnDate ?? new Date(),
          subtotal,
          taxTotal,
          total: subtotal + taxTotal,
          restock: input.restock,
          reason: input.reason ?? null,
          items: { create: items },
        },
        select: { id: true, code: true, total: true },
      });

      // --- Stock ---------------------------------------------------------
      // A sale return brings goods BACK in; a purchase return sends them out.
      if (warehouse) {
        for (const item of items) {
          const product = index.get(item.productId)!;
          if (!product.trackInventory) continue;

          await applyMove(tx, {
            businessId: ctx.businessId,
            warehouseId: warehouse.id,
            branchId: input.branchId,
            productId: item.productId,
            variantId: item.variantId,
            type: input.type === 'SALE_RETURN' ? 'RETURN_IN' : 'RETURN_OUT',
            qtyMilli: input.type === 'SALE_RETURN' ? item.qtyMilli : -item.qtyMilli,
            unitCost: item.unitCost,
            referenceType: 'RETURN',
            referenceId: record.id,
            referenceNo: record.code,
            note: `Return ${record.code}`,
            createdById: ctx.userId,
            allowNegative: input.type === 'PURCHASE_RETURN',
          });
        }
      }

      // --- Ledger ---------------------------------------------------------
      // Reverse of the original document: a sale return reduces revenue, a
      // purchase return reduces cost of goods sold.
      const cost = items.reduce((sum, item) => sum + Math.round((item.qtyMilli * item.unitCost) / 1000), 0);

      const lines: Array<{ account: string; debit?: number; credit?: number; memo?: string; partyId?: string | null }> =
        input.type === 'SALE_RETURN'
          ? [
              { account: revenueAccountId, debit: subtotal, partyId: input.partyId ?? null },
              ...(taxTotal > 0 ? [{ account: taxAccountId, debit: taxTotal }] : []),
              { account: inventoryAccountId, credit: cost, memo: 'Goods back in' },
            ]
          : [
              { account: cogsAccountId, debit: cost, memo: 'Goods back to supplier' },
              { account: inventoryAccountId, credit: cost },
            ];

      if (lines.length > 0) {
        await postJournal(
          tx,
          {
            businessId: ctx.businessId,
            branchId: input.branchId,
            date: input.returnDate ?? new Date(),
            source: 'RETURN',
            memo: `Return ${record.code}`,
            referenceType: 'RETURN',
            referenceId: record.id,
            returnId: record.id,
            lines,
          },
          accounts,
        );
      }

      await audit(tx, {
        action: 'CREATE',
        entityType: 'Return',
        entityId: record.id,
        entityCode: record.code,
        after: { total: record.total, lines: items.length },
      });

      return record;
    });

    created(res, created_);
  }),
);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const expenseListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  from: toDateSchema.optional(),
  to: toDateSchema.optional(),
  branchId: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

purchasingRouter.get(
  '/expenses',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(expenseListSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.from || query.to) {
      where.expenseDate = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { payeeName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
        skip,
        take,
        select: {
          id: true,
          code: true,
          category: true,
          description: true,
          status: true,
          expenseDate: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          paidTotal: true,
          balanceDue: true,
          payeeName: true,
          reference: true,
          note: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          user: { select: { firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.expense.count({ where }),
    ]);

    const aggregate = await prisma.expense.aggregate({
      where,
      _sum: { total: true, taxTotal: true },
      _count: true,
    });

    res.json({
      data: rows.map((row) => ({
        ...row,
        createdAt: row.expenseDate,
        vendor: row.payeeName,
        amount: row.total,
        tax: row.taxTotal,
        branchName: row.branch?.name ?? null,
        userName: [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ') || null,
      })),
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

const createExpenseSchema = z.object({
  branchId: z.string().min(1),
  category: z.string().trim().max(80).nullish(),
  description: z.string().trim().min(1, 'Describe the expense').max(300),
  expenseDate: z.coerce.date().optional(),
  payeeName: z.string().trim().max(200).nullish(),
  reference: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(1000).nullish(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        amount: z.number().int().positive('Amount must be greater than zero'),
        accountId: z.string().nullish(),
        taxAmount: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1, 'Add at least one line'),
});

purchasingRouter.post(
  '/expenses',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(createExpenseSchema, req);
    assertBranchAccess(input.branchId);

    const record = await transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, businessId: ctx.businessId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch', input.branchId);

      const accounts = await resolveSystemAccounts(tx, ctx.businessId);
      // The default expense account is what an unqualified spend lands in; the
      // P&L still shows it as an expense either way.
      const defaultAccountId = await accountIdFor(accounts, ACCOUNT_CODES.EXPENSE);

      const subtotal = input.lines.reduce((sum, l) => sum + l.amount, 0);
      const taxTotal = input.lines.reduce((sum, l) => sum + l.taxAmount, 0);
      const code = await nextNumber(tx, {
        businessId: ctx.businessId,
        branchId: input.branchId,
        type: 'EXPENSE',
      });

      const expense = await tx.expense.create({
        data: {
          businessId: ctx.businessId,
          branchId: input.branchId,
          userId: ctx.userId,
          code,
          category: input.category ?? null,
          description: input.description,
          status: 'SUBMITTED',
          expenseDate: input.expenseDate ?? new Date(),
          payeeName: input.payeeName ?? null,
          subtotal,
          taxTotal,
          total: subtotal + taxTotal,
          reference: input.reference ?? null,
          note: input.note ?? null,
          accountId: defaultAccountId,
          items: {
            create: input.lines.map((line, position) => ({
              description: line.description,
              amount: line.amount,
              taxAmount: line.taxAmount,
              accountId: line.accountId ?? defaultAccountId,
              position,
            })),
          },
        },
        select: { id: true, code: true, status: true, total: true },
      });

      // A submitted expense is NOT yet in the books — it posts on approval.
      // That separation is the whole point of the approval step, and it is why
      // this create path deliberately writes no journal.
      await audit(tx, {
        action: 'CREATE',
        entityType: 'Expense',
        entityId: expense.id,
        entityCode: expense.code,
        after: { total: expense.total, status: expense.status },
      });

      return expense;
    });

    created(res, record);
  }),
);

purchasingRouter.post(
  '/expenses/:id/approve',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);

    const result = await transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, businessId: ctx.businessId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      if (!expense) throw notFound('Expense', id);
      if (expense.status === 'APPROVED' || expense.status === 'PAID') {
        throw new AppError('CONFLICT', 'This expense is already approved');
      }
      if (expense.status === 'REJECTED' || expense.status === 'CANCELLED') {
        throw new AppError('CONFLICT', `Cannot approve an expense that is ${expense.status.toLowerCase()}`);
      }
      assertBranchAccess(expense.branchId);

      const accounts = await resolveSystemAccounts(tx, ctx.businessId);
      const expenseAccountId = await accountIdFor(accounts, ACCOUNT_CODES.EXPENSE);
      const taxAccountId = await accountIdFor(accounts, ACCOUNT_CODES.TAX_PAYABLE);
      const cashAccountId = await accountIdFor(accounts, ACCOUNT_CODES.CASH);

      // One journal per expense: each line's own account is debited, with the
      // cash account absorbing the gross. Lines sharing an account are merged
      // so the journal stays readable rather than emitting N identical debits.
      const byAccount = new Map<string, number>();
      for (const item of expense.items) {
        byAccount.set(item.accountId ?? expenseAccountId, (byAccount.get(item.accountId ?? expenseAccountId) ?? 0) + item.amount);
      }

      const lines = [
        ...[...byAccount.entries()].map(([accountId, amount]) => ({
          account: accountId,
          debit: amount,
          memo: expense.description,
        })),
        ...(expense.taxTotal > 0
          ? [{ account: taxAccountId, debit: expense.taxTotal, memo: 'Recoverable tax' }]
          : []),
        { account: cashAccountId, credit: expense.total, memo: `Expense ${expense.code}` },
      ];

      await postJournal(
        tx,
        {
          businessId: ctx.businessId,
          branchId: expense.branchId,
          date: expense.expenseDate,
          source: 'EXPENSE',
          memo: `Expense ${expense.code}: ${expense.description}`,
          referenceType: 'EXPENSE',
          referenceId: expense.id,
          lines,
        },
        accounts,
      );

      const updated = await tx.expense.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
        select: { id: true, code: true, status: true, total: true },
      });

      await audit(tx, {
        action: 'APPROVE',
        entityType: 'Expense',
        entityId: updated.id,
        entityCode: updated.code,
        before: { status: expense.status },
        after: { status: updated.status },
      });

      return updated;
    });

    ok(res, result);
  }),
);

purchasingRouter.get(
  '/expenses/:id',
  handler(async (req, res) => {
    const ctx = context();
    const expense = await prisma.expense.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      include: {
        items: { orderBy: { position: 'asc' } },
        branch: { select: { id: true, name: true } },
        user: { select: { firstName: true, lastName: true } },
        payments: { orderBy: { paidAt: 'asc' } },
      },
    });
    if (!expense) throw notFound('Expense', String(req.params.id));
    ok(res, {
      ...expense,
      vendor: expense.payeeName,
      amount: expense.total,
      createdAt: expense.expenseDate,
      branchName: expense.branch?.name ?? null,
      userName: [expense.user?.firstName, expense.user?.lastName].filter(Boolean).join(' ') || null,
    });

  }),
);

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

const purchaseListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  from: toDateSchema.optional(),
  to: toDateSchema.optional(),
  branchId: z.string().optional(),
  status: z.string().optional(),
  supplierId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

purchasingRouter.get(
  '/purchases',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(purchaseListSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.from || query.to) {
      where.invoiceDate = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { supplierRef: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total, aggregate] = await Promise.all([
      prisma.purchase.findMany({
        where,
        orderBy: { invoiceDate: 'desc' },
        skip,
        take,
        select: {
          id: true,
          code: true,
          supplierRef: true,
          status: true,
          invoiceDate: true,
          expectedDate: true,
          receivedAt: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          total: true,
          paidTotal: true,
          balanceDue: true,
          note: true,
          terms: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.purchase.count({ where }),
      prisma.purchase.aggregate({
        where,
        _sum: { total: true, taxTotal: true, balanceDue: true },
      }),
    ]);

    res.json({
      data: rows.map((row) => ({
        ...row,
        createdAt: row.invoiceDate,
        orderDate: row.invoiceDate,
        supplierName: row.supplier?.name ?? null,
        branchName: row.branch?.name ?? null,
        tax: row.taxTotal,
        notes: row.note,
      })),
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

const createPurchaseSchema = z.object({
  branchId: z.string().min(1),
  supplierId: z.string().nullish(),
  warehouseId: z.string().nullish(),
  supplierRef: z.string().trim().max(120).nullish(),
  invoiceDate: z.coerce.date().optional(),
  expectedDate: z.coerce.date().nullish(),
  note: z.string().trim().max(1000).nullish(),
  terms: z.string().trim().max(300).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        qtyMilli: z.number().int().positive('Quantity must be greater than zero'),
        unitCost: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1, 'Add at least one line'),
});

purchasingRouter.post(
  '/purchases',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(createPurchaseSchema, req);
    assertBranchAccess(input.branchId);

    const record = await transaction(async (tx) => {
      const accounts = await resolveSystemAccounts(tx, ctx.businessId);
      const inventoryAccountId = await accountIdFor(accounts, ACCOUNT_CODES.INVENTORY);
      const payableAccountId = await accountIdFor(accounts, ACCOUNT_CODES.ACCOUNTS_PAYABLE);
      const taxAccountId = await accountIdFor(accounts, ACCOUNT_CODES.TAX_PAYABLE);

      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, businessId: ctx.businessId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch', input.branchId);

      const warehouse = input.warehouseId
        ? await tx.warehouse.findFirst({
            where: { id: input.warehouseId, businessId: ctx.businessId },
            select: { id: true, branchId: true },
          })
        : await tx.warehouse.findFirst({
            where: { businessId: ctx.businessId, branchId: input.branchId, isActive: true },
            orderBy: { isRetail: 'desc' },
            select: { id: true, branchId: true },
          });
      if (!warehouse) throw notFound('Warehouse', input.warehouseId ?? input.branchId);

      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] }, businessId: ctx.businessId },
        select: { id: true, name: true, sku: true, costPrice: true, tax: { select: { rate: true } } },
      });
      const index = new Map(products.map((p) => [p.id, p]));

      let subtotal = 0;
      let taxTotal = 0;
      const items = input.lines.map((line, position) => {
        const product = index.get(line.productId);
        if (!product) throw notFound('Product', line.productId);
        const unitCost = line.unitCost ?? product.costPrice;
        const lineSubtotal = Math.round((line.qtyMilli * unitCost) / 1000);
        // rate is basis points (1000 = 10%); round half away from zero.
        const lineTax = Math.round((lineSubtotal * (product.tax?.rate ?? 0)) / 10_000);
        subtotal += lineSubtotal;
        taxTotal += lineTax;
        return {
          productId: line.productId,
          variantId: line.variantId ?? null,
          productName: product.name,
          sku: product.sku,
          qtyMilli: line.qtyMilli,
          unitCost,
          taxRate: product.tax?.rate ?? 0,
          taxAmount: lineTax,
          lineSubtotal,
          lineTotal: lineSubtotal + lineTax,
          position,
        };
      });

      const code = await nextNumber(tx, {
        businessId: ctx.businessId,
        branchId: input.branchId,
        type: 'PURCHASE',
      });

      const total = subtotal + taxTotal;
      const purchase = await tx.purchase.create({
        data: {
          businessId: ctx.businessId,
          branchId: input.branchId,
          supplierId: input.supplierId ?? null,
          warehouseId: warehouse.id,
          userId: ctx.userId,
          code,
          supplierRef: input.supplierRef ?? null,
          status: 'RECEIVED',
          invoiceDate: input.invoiceDate ?? new Date(),
          expectedDate: input.expectedDate ?? null,
          receivedAt: new Date(),
          subtotal,
          taxTotal,
          total,
          note: input.note ?? null,
          terms: input.terms ?? null,
          items: {
            create: items.map((item) => ({
              ...item,
              // Received on creation: this endpoint only records goods that
              // actually arrived, so the order is never left half-delivered.
              qtyReceivedMilli: item.qtyMilli,
              warehouseId: warehouse.id,
            })),
          },
        },
        select: { id: true, code: true, total: true, status: true },
      });

      // --- Stock in --------------------------------------------------------
      const { applyMove } = await import('../inventory/stock.js');
      for (const item of items) {
        await applyMove(tx, {
          businessId: ctx.businessId,
          warehouseId: warehouse.id,
          branchId: input.branchId,
          productId: item.productId,
          variantId: item.variantId,
          type: 'PURCHASE',
          qtyMilli: item.qtyMilli,
          unitCost: item.unitCost,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          referenceNo: purchase.code,
          note: `Purchase ${purchase.code}`,
          createdById: ctx.userId,
        });
      }

      // --- Ledger ----------------------------------------------------------
      // Stock and liability rise together; cash is untouched until the supplier
      // is actually paid, which is what makes the payables ageing correct.
      await postJournal(
        tx,
        {
          businessId: ctx.businessId,
          branchId: input.branchId,
          date: input.invoiceDate ?? new Date(),
          source: 'PURCHASE',
          memo: `Purchase ${purchase.code}`,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          purchaseId: purchase.id,
          lines: [
            { account: inventoryAccountId, debit: subtotal, memo: 'Goods received' },
            ...(taxTotal > 0 ? [{ account: taxAccountId, debit: taxTotal, memo: 'Recoverable tax' }] : []),
            {
              account: payableAccountId,
              credit: total,
              partyId: input.supplierId ?? null,
              memo: 'Owed to supplier',
            },
          ],
        },
        accounts,
      );

      await audit(tx, {
        action: 'CREATE',
        entityType: 'Purchase',
        entityId: purchase.id,
        entityCode: purchase.code,
        after: { total, lines: items.length },
      });

      return purchase;
    });

    created(res, record);
  }),
);

/**
 * Receive a purchase that was raised but not yet delivered.
 *
 * Only the outstanding quantity is received, so receiving the same order twice
 * is harmless — which matters, because goods-in gets keyed twice.
 */
purchasingRouter.post(
  '/purchases/:id/receive',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);

    const result = await transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, businessId: ctx.businessId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      if (!purchase) throw notFound('Purchase', id);
      assertBranchAccess(purchase.branchId);
      if (purchase.status === 'RECEIVED') {
        throw new AppError('CONFLICT', 'These goods have already been received');
      }

      const warehouseId = purchase.warehouseId;
      if (!warehouseId) {
        throw new AppError('CONFLICT', 'This purchase has no warehouse to receive into');
      }

      const { applyMove } = await import('../inventory/stock.js');
      let received = 0;
      for (const item of purchase.items) {
        const outstanding = item.qtyMilli - item.qtyReceivedMilli;
        if (outstanding <= 0) continue;
        await applyMove(tx, {
          businessId: ctx.businessId,
          warehouseId,
          branchId: purchase.branchId,
          productId: item.productId,
          variantId: item.variantId,
          type: 'PURCHASE',
          qtyMilli: outstanding,
          unitCost: item.unitCost,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          referenceNo: purchase.code,
          note: `Received ${purchase.code}`,
          createdById: ctx.userId,
        });
        received += 1;
      }

      const updated = await tx.purchase.update({
        where: { id },
        data: { status: 'RECEIVED', receivedAt: new Date() },
        select: { id: true, code: true, status: true },
      });

      await audit(tx, {
        action: 'UPDATE',
        entityType: 'Purchase',
        entityId: updated.id,
        entityCode: updated.code,
        before: { status: purchase.status },
        after: { status: updated.status, linesReceived: received },
      });

      return { ...updated, linesReceived: received };
    });

    ok(res, result);
  }),
);

purchasingRouter.get(
  '/purchases/:id',
  handler(async (req, res) => {
    const ctx = context();
    const purchase = await prisma.purchase.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      include: {
        items: { orderBy: { position: 'asc' } },
        supplier: { select: { id: true, name: true, email: true, phone: true } },
        branch: { select: { id: true, name: true } },
        payments: { orderBy: { paidAt: 'asc' } },
      },
    });
    if (!purchase) throw notFound('Purchase', String(req.params.id));
    ok(res, {
      ...purchase,
      createdAt: purchase.invoiceDate,
      orderDate: purchase.invoiceDate,
      supplierName: purchase.supplier?.name ?? null,
      branchName: purchase.branch?.name ?? null,
      tax: purchase.taxTotal,
      notes: purchase.note,
    });
  }),
);
