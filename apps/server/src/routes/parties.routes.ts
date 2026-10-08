import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../db/client.js';
import { handler, ok, created, parseBody, listQuery, page, translateDbError } from '../lib/http.js';
import { context, assertBranchAccess } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import { crudRoute } from '../lib/crud.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';

/**
 * Customers and suppliers.
 *
 * Both live in one `Party` table because they share every attribute and are
 * frequently the same legal entity. The `Customer` / `Supplier` models hold
 * only the attributes unique to each role, so a supplier record never carries
 * a loyalty tier and a customer never carries bank details.
 */

export const partiesRouter = Router();

const partyCore = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: z.string().trim().max(30).nullish(),
  email: z.string().trim().email('Enter a valid email address').nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish(),
  taxNumber: z.string().trim().max(60).nullish(),
  address: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(100).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
};

const customerSchema = z.object({
  ...partyCore,
  tier: z.enum(['RETAIL', 'WHOLESALE', 'VIP', 'DISTRIBUTOR']).default('RETAIL'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE'),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  creditLimit: z.number().int().nonnegative().nullish(),
  openingBalance: z.number().int().default(0),
  loyaltyPoints: z.number().int().default(0),
  discountRate: z.number().int().min(0).max(10_000).default(0),
  defaultWarehouseId: z.string().nullish(),
});

partiesRouter.post(
  '/customers',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(customerSchema, req);

    try {
      const customer = await transaction(async (tx) => {
        const code =
          input.code ?? (await nextNumber(tx, { businessId: ctx.businessId, type: 'CUSTOMER' }));

        const party = await tx.party.create({
          data: {
            businessId: ctx.businessId,
            type: 'CUSTOMER',
            code,
            name: input.name,
            email: input.email || null,
            phone: input.phone ?? null,
            taxNumber: input.taxNumber ?? null,
            address: input.address ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            country: input.country ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive ?? true,
            openingBalance: input.openingBalance ?? 0,
            paymentTermsDays: input.paymentTermsDays ?? 0,
            creditLimit: input.creditLimit ?? null,
            customerProfile: {
              create: {
                tier: input.tier ?? 'RETAIL',
                status: input.status ?? 'ACTIVE',
                loyaltyPoints: input.loyaltyPoints ?? 0,
                discountRate: input.discountRate ?? 0,
                defaultWarehouseId: input.defaultWarehouseId ?? null,
              },
            },
          },
          include: { customerProfile: true },
        });

        await audit(tx, {
          action: 'CREATE',
          entityType: 'Customer',
          entityId: party.id,
          entityCode: code,
          after: { name: party.name },
        });

        return party;
      });

      created(res, customer);
    } catch (error) {
      translateDbError(error);
    }
  }),
);

partiesRouter.patch(
  '/customers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(customerSchema.partial(), req);
    const id = String(req.params.id);

    const existing = await prisma.party.findFirst({
      where: { id, businessId: ctx.businessId },
      select: { id: true },
    });
    if (!existing) throw notFound('Customer', id);

    const {
      tier, status, loyaltyPoints, discountRate, defaultWarehouseId, ...core
    } = input;

    const customer = await transaction(async (tx) =>
      tx.party.update({
        where: { id },
        data: {
          ...core,
          email: core.email === '' ? null : core.email,
          ...(tier !== undefined || status !== undefined || loyaltyPoints !== undefined
            || discountRate !== undefined || defaultWarehouseId !== undefined
            ? {
                customerProfile: {
                  upsert: {
                    create: { tier: tier ?? 'RETAIL', status: status ?? 'ACTIVE' },
                    update: {
                      ...(tier !== undefined ? { tier } : {}),
                      ...(status !== undefined ? { status } : {}),
                      ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
                      ...(discountRate !== undefined ? { discountRate } : {}),
                      ...(defaultWarehouseId !== undefined ? { defaultWarehouseId } : {}),
                    },
                  },
                },
              }
            : {}),
        },
        include: { customerProfile: true },
      }),
    );

    ok(res, customer);
  }),
);

partiesRouter.get(
  '/customers',
  handler(async (req, res) => {
    const ctx = context();
    const { skip, take } = listQuery(req);
    const q = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = {
      businessId: ctx.businessId,
      type: { in: ['CUSTOMER', 'BOTH'] },
    };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.tier) where.customerProfile = { is: { tier: q.tier } };
    if (q.status) where.customerProfile = { is: { status: q.status } };

    const [rows, total] = await Promise.all([
      prisma.party.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        select: {
          id: true, code: true, name: true, email: true, phone: true, address: true,
          city: true, taxNumber: true, creditLimit: true, paymentTermsDays: true,
          openingBalance: true, isActive: true, createdAt: true,
          customerProfile: { select: { tier: true, status: true, loyaltyPoints: true, discountRate: true } },
          // Live aggregates rather than stored counters, so the list can never
          // disagree with the sales it is meant to summarise.
          sales: {
            where: { status: { not: 'VOIDED' } },
            select: { total: true },
          },
        },
      }),
      prisma.party.count({ where }),
    ]);

    page(
      res,
      rows.map((row) => ({
        ...row,
        tier: row.customerProfile?.tier ?? 'RETAIL',
        status: row.customerProfile?.status ?? 'ACTIVE',
        loyaltyPoints: row.customerProfile?.loyaltyPoints ?? 0,
        discountRate: row.customerProfile?.discountRate ?? 0,
        totalSpent: row.sales.reduce((sum, s) => sum + s.total, 0),
        saleCount: row.sales.length,
        customerProfile: undefined,
      })),
      total,
      Number(q.page) || 1,
      Number(q.pageSize) || 25,
    );
  }),
);

partiesRouter.get(
  '/customers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const customer = await prisma.party.findFirst({
      where: { id, businessId: ctx.businessId, type: { in: ['CUSTOMER', 'BOTH'] } },
      include: {
        customerProfile: true,
        addresses: true,
        sales: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
          select: { id: true, code: true, occurredAt: true, total: true, status: true, balanceDue: true },
        },
        invoices: {
          where: { balanceDue: { gt: 0 } },
          orderBy: { issueDate: 'desc' },
          select: { id: true, code: true, issueDate: true, dueDate: true, total: true, paidTotal: true, balanceDue: true, status: true },
        },
      },
    });
    if (!customer) throw notFound('Customer', id);

    // Outstanding balance is the sum of open invoices — an AR figure, not a
    // stored counter that could drift.
    const outstanding = customer.invoices.reduce((sum, i) => sum + i.balanceDue, 0);
    const creditLimit = customer.creditLimit;
    if (creditLimit !== null && outstanding > creditLimit) {
      // Surfaced, not enforced: blocking a sale here would be a surprise at the
      // till, and credit policy belongs to the operator.
      customer.notes = `${customer.notes ? customer.notes + '\n' : ''}[Credit limit exceeded]`;
    }

    ok(res, { ...customer, outstandingBalance: outstanding });
  }),
);

partiesRouter.delete(
  '/customers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const party = await prisma.party.findFirst({
      where: { id, businessId: ctx.businessId },
      select: { id: true },
    });
    if (!party) throw notFound('Customer', id);

    const sales = await prisma.sale.count({ where: { customerId: id } });
    if (sales > 0) {
      throw new AppError('ACCOUNT_IN_USE', 'This customer has sales history. Deactivate them instead of deleting.');
    }

    await prisma.party.delete({ where: { id } });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

const supplierSchema = z.object({
  ...partyCore,
  isPreferred: z.boolean().default(false),
  leadTimeDays: z.number().int().min(0).max(365).default(0),
  accountNumber: z.string().trim().max(60).nullish(),
  bankDetails: z.string().trim().max(300).nullish(),
});

partiesRouter.post(
  '/suppliers',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(supplierSchema, req);

    try {
      const supplier = await transaction(async (tx) => {
        const code = input.code ?? (await nextNumber(tx, { businessId: ctx.businessId, type: 'SUPPLIER' }));
        return tx.party.create({
          data: {
            businessId: ctx.businessId,
            type: 'SUPPLIER',
            code,
            name: input.name,
            email: input.email || null,
            phone: input.phone ?? null,
            taxNumber: input.taxNumber ?? null,
            address: input.address ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            country: input.country ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive ?? true,
            paymentTermsDays: 0,
            supplierProfile: {
              create: {
                isPreferred: input.isPreferred ?? false,
                leadTimeDays: input.leadTimeDays ?? 0,
                accountNumber: input.accountNumber ?? null,
                bankDetails: input.bankDetails ?? null,
              },
            },
          },
          include: { supplierProfile: true },
        });
      });
      created(res, supplier);
    } catch (error) {
      translateDbError(error);
    }
  }),
);

partiesRouter.patch(
  '/suppliers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(supplierSchema.partial(), req);
    const id = String(req.params.id);

    const existing = await prisma.party.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true } });
    if (!existing) throw notFound('Supplier', id);

    const { isPreferred, leadTimeDays, accountNumber, bankDetails, ...core } = input;

    ok(
      res,
      await prisma.party.update({
        where: { id },
        data: {
          ...core,
          email: core.email === '' ? null : core.email,
          ...(isPreferred !== undefined || leadTimeDays !== undefined
            || accountNumber !== undefined || bankDetails !== undefined
            ? {
                supplierProfile: {
                  upsert: {
                    create: {},
                    update: {
                      ...(isPreferred !== undefined ? { isPreferred } : {}),
                      ...(leadTimeDays !== undefined ? { leadTimeDays } : {}),
                      ...(accountNumber !== undefined ? { accountNumber } : {}),
                      ...(bankDetails !== undefined ? { bankDetails } : {}),
                    },
                  },
                },
              }
            : {}),
        },
        include: { supplierProfile: true },
      }),
    );
  }),
);

partiesRouter.get(
  '/suppliers',
  handler(async (req, res) => {
    const ctx = context();
    const { skip, take } = listQuery(req);
    const q = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = {
      businessId: ctx.businessId,
      type: { in: ['SUPPLIER', 'BOTH'] },
    };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.isPreferred) where.supplierProfile = { is: { isPreferred: q.isPreferred === 'true' } };

    const [rows, total] = await Promise.all([
      prisma.party.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        select: {
          id: true, code: true, name: true, email: true, phone: true, city: true,
          country: true, taxNumber: true, isActive: true, notes: true,
          supplierProfile: { select: { isPreferred: true, leadTimeDays: true, accountNumber: true } },
          purchases: { select: { total: true, status: true } },
          invoices: { where: { balanceDue: { gt: 0 } }, select: { balanceDue: true } },
        },
      }),
      prisma.party.count({ where }),
    ]);

    page(
      res,
      rows.map((row) => ({
        ...row,
        isPreferred: row.supplierProfile?.isPreferred ?? false,
        leadTimeDays: row.supplierProfile?.leadTimeDays ?? 0,
        accountNumber: row.supplierProfile?.accountNumber ?? null,
        supplierProfile: undefined,
        totalPurchased: row.purchases.reduce((sum, p) => sum + p.total, 0),
        purchaseCount: row.purchases.length,
        outstandingBalance: row.invoices.reduce((sum, i) => sum + i.balanceDue, 0),
      })),
      total,
      Number(q.page) || 1,
      Number(q.pageSize) || 25,
    );
  }),
);

partiesRouter.get(
  '/suppliers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const supplier = await prisma.party.findFirst({
      where: { id, businessId: ctx.businessId, type: { in: ['SUPPLIER', 'BOTH'] } },
      include: {
        supplierProfile: true,
        purchases: {
          orderBy: { invoiceDate: 'desc' },
          take: 20,
          select: { id: true, code: true, supplierRef: true, invoiceDate: true, total: true, status: true, balanceDue: true },
        },
        invoices: {
          where: { balanceDue: { gt: 0 } },
          select: { id: true, code: true, dueDate: true, total: true, balanceDue: true },
        },
      },
    });
    if (!supplier) throw notFound('Supplier', id);
    ok(res, { ...supplier, outstandingBalance: supplier.invoices.reduce((s, i) => s + i.balanceDue, 0) });
  }),
);

partiesRouter.delete(
  '/suppliers/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const purchases = await prisma.purchase.count({ where: { supplierId: id, businessId: ctx.businessId } });
    if (purchases > 0) {
      throw new AppError('ACCOUNT_IN_USE', 'This supplier has purchase history. Deactivate them instead.');
    }
    const result = await prisma.party.deleteMany({ where: { id, businessId: ctx.businessId } });
    if (result.count === 0) throw notFound('Supplier', id);
    res.status(204).end();
  }),
);
