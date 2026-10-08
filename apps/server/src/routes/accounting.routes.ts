import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../db/client.js';
import { handler, ok, created, parseBody, parseQuery, listQuery, page, translateDbError, toDateSchema } from '../lib/http.js';
import { context } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import type { AccountSubtype } from '../generated/prisma/enums.js';
import { audit } from '../lib/audit.js';
import {
  ACCOUNT_CODES,
  postJournal,
  profitAndLoss,
  resolveSystemAccounts,
  reverseJournal,
  trialBalance,
} from '../modules/accounting/ledger.js';

/**
 * Accounting endpoints.
 *
 * Reports here READ THE LEDGER. Nothing recomputes revenue from the sales table
 * and nothing stores a "total" that the journal does not already imply — that
 * duplication is exactly how a P&L stops agreeing with the bank.
 */

export const accountingRouter = Router();

const money = z.number().int();
const periodSchema = z.object({
  from: z.coerce.date(),
  to: toDateSchema,
  branchId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

accountingRouter.get(
  '/accounts',
  handler(async (req, res) => {
    const ctx = context();
    const accounts = await prisma.account.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { code: 'asc' },
      select: {
        id: true, code: true, name: true, type: true, subtype: true,
        isActive: true, isSystem: true, isCash: true, currency: true,
        _count: { select: { lines: true } },
      },
    });

    // Attach the current balance so the chart of accounts is usable without a
    // second request per row.
    const balances = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { account: { businessId: ctx.businessId }, entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const balanceIndex = new Map(
      balances.map((b) => [b.accountId, { debit: b._sum.debit ?? 0, credit: b._sum.credit ?? 0 }]),
    );

    const typeIndex = new Map(accounts.map((a) => [a.id, a.type]));
    ok(
      res,
      accounts.map((account) => {
        const movement = balanceIndex.get(account.id) ?? { debit: 0, credit: 0 };
        const debitPositive = account.type === 'ASSET' || account.type === 'EXPENSE';
        return {
          ...account,
          debit: movement.debit,
          credit: movement.credit,
          balance: debitPositive ? movement.debit - movement.credit : movement.credit - movement.debit,
        };
      }),
    );
  }),
);

const accountSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(1).max(150),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  subtype: z
    .enum(['CASH','BANK','ACCOUNTS_RECEIVABLE','INVENTORY','FIXED_ASSET','ACCOUNTS_PAYABLE','TAX_PAYABLE','CREDIT_CARD','OWNERS_EQUITY','RETAINED_EARNINGS','SALES_REVENUE','SERVICE_REVENUE','OTHER_INCOME','SALES_DISCOUNT','TAX_COLLECTED','COGS','EXPENSE','RENT','UTILITIES','SALARIES','SUPPLIES','TRANSPORT','OTHER_EXPENSE'])
    .nullish(),
  description: z.string().max(500).nullish(),
  isActive: z.boolean().default(true),
});

accountingRouter.post(
  '/accounts',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(accountSchema, req);

    try {
      const account = await prisma.account.create({
        data: { ...input, subtype: input.subtype ?? null, businessId: ctx.businessId, isSystem: false },
      });
      created(res, account);
    } catch (error) {
      translateDbError(error);
    }
  }),
);

accountingRouter.patch(
  '/accounts/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const input = parseBody(accountSchema.partial(), req);

    const account = await prisma.account.findFirst({
      where: { id, businessId: ctx.businessId },
      select: { id: true, isSystem: true, type: true },
    });
    if (!account) throw notFound('Account', id);

    // System accounts back every automated posting; re-typing one would send
    // revenue into a liability and silently break every report.
    if (account.isSystem && (input.type || input.code)) {
      throw new AppError('FORBIDDEN', 'A system account\'s code and type cannot be changed');
    }

    ok(res, await prisma.account.update({ where: { id }, data: input }));
  }),
);

accountingRouter.delete(
  '/accounts/:id',
  handler(async (req, res) => {
    const ctx = context();
    const id = String(req.params.id);
    const account = await prisma.account.findFirst({
      where: { id, businessId: ctx.businessId },
      include: { _count: { select: { lines: true } } },
    });
    if (!account) throw notFound('Account', id);
    if (account.isSystem) throw new AppError('FORBIDDEN', 'System accounts cannot be deleted');
    if (account._count.lines > 0) {
      throw new AppError(
        'ACCOUNT_IN_USE',
        `This account has ${account._count.lines} ledger entries and cannot be deleted. Deactivate it instead.`,
      );
    }

    await prisma.account.delete({ where: { id } });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const journalListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  from: z.coerce.date().optional(),
  to: toDateSchema.optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

accountingRouter.get(
  '/journal',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(journalListSchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (ctx.branchIds.length > 0) where.branchId = { in: ctx.branchIds };
    if (query.from || query.to) {
      where.date = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    }
    if (query.source) where.source = query.source;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { memo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { code: 'desc' }],
        skip,
        take,
        select: {
          id: true, code: true, date: true, source: true, status: true, memo: true,
          totalDebit: true, totalCredit: true, referenceType: true, referenceId: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          lines: {
            orderBy: { position: 'asc' },
            select: {
              id: true, debit: true, credit: true, balance: true, memo: true,
              account: { select: { id: true, code: true, name: true, type: true } },
              party: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    page(res, rows, total, query.page ?? 1, query.pageSize ?? 25);
  }),
);

const manualJournalSchema = z.object({
  date: z.coerce.date().optional(),
  memo: z.string().trim().min(1, 'Describe the entry').max(300),
  branchId: z.string().nullish(),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1, 'Choose an account'),
        debit: money.nonnegative().default(0),
        credit: money.nonnegative().default(0),
        memo: z.string().max(200).nullish(),
        partyId: z.string().nullish(),
      }),
    )
    .min(2, 'An entry needs at least two lines'),
});

accountingRouter.post(
  '/journal',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(manualJournalSchema, req);

    const entry = await transaction(async (tx) => {
      const accounts = await resolveSystemAccounts(tx, ctx.businessId);

      const posted = await postJournal(
        tx,
        {
          businessId: ctx.businessId,
          branchId: input.branchId ?? null,
          date: input.date ?? new Date(),
          source: 'MANUAL',
          memo: input.memo,
          lines: input.lines.map((line) => ({
            // `account:` accepts either a system code or an explicit account id;
            // an id simply will not resolve in the system map and passes through.
            account: line.accountId,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo ?? undefined,
            partyId: line.partyId ?? null,
          })),
        },
        accounts,
      );

      await audit(tx, {
        action: 'CREATE',
        entityType: 'JournalEntry',
        entityId: posted.id,
        entityCode: posted.code,
        after: { memo: input.memo, totalDebit: posted.totalDebit, lines: input.lines.length },
      });

      return posted;
    });

    created(res, entry);
  }),
);

accountingRouter.post(
  '/journal/:id/reverse',
  handler(async (req, res) => {
    const ctx = context();
    const { memo } = parseBody(
      z.object({ memo: z.string().trim().min(3, 'Say why you are reversing this').max(300) }),
      req,
    );

    const reversed = await transaction((tx) =>
      reverseJournal(tx, String(req.params.id), memo),
    );
    created(res, reversed);
  }),
);

accountingRouter.get(
  '/journal/:id',
  handler(async (req, res) => {
    const ctx = context();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: String(req.params.id), businessId: ctx.businessId },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: { account: { select: { id: true, code: true, name: true, type: true } }, party: { select: { id: true, name: true } } },
        },
        reverses: { select: { id: true, code: true, memo: true, date: true } },
        reversedBy: { select: { id: true, code: true, memo: true, date: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!entry) throw notFound('Journal entry', String(req.params.id));
    ok(res, entry);
  }),
);

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

accountingRouter.get(
  '/trial-balance',
  handler(async (req, res) => {
    const ctx = context();
    const { from, to, branchId } = parseQuery(periodSchema, req);

    const balances = await transaction((tx) =>
      trialBalance(tx, ctx.businessId, from, to, branchId ?? null),
    );

    const totalDebit = balances.reduce((sum, b) => sum + b.debit, 0);
    const totalCredit = balances.reduce((sum, b) => sum + b.credit, 0);

    ok(res, {
      from,
      to,
      branchId: branchId ?? null,
      accounts: balances,
      totalDebit,
      totalCredit,
      isBalanced: totalDebit === totalCredit,
      difference: totalDebit - totalCredit,
    });
  }),
);

accountingRouter.get(
  '/profit-loss',
  handler(async (req, res) => {
    const ctx = context();
    const { from, to, branchId } = parseQuery(periodSchema, req);
    const statement = await transaction((tx) =>
      profitAndLoss(tx, ctx.businessId, from, to, branchId ?? null),
    );
    ok(res, { from, to, branchId: branchId ?? null, ...statement });
  }),
);

accountingRouter.get(
  '/ledger/:accountId',
  handler(async (req, res) => {
    const ctx = context();
    const { from, to } = parseQuery(periodSchema, req);
    const accountId = String(req.params.accountId);

    const account = await prisma.account.findFirst({
      where: { id: accountId, businessId: ctx.businessId },
      select: { id: true, code: true, name: true, type: true },
    });
    if (!account) throw notFound('Account', accountId);

    const debitPositive = account.type === 'ASSET' || account.type === 'EXPENSE';

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId,
        entry: { businessId: ctx.businessId, status: 'POSTED', date: { gte: from, lte: to } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { position: 'asc' }],
      select: {
        id: true, debit: true, credit: true, balance: true, memo: true,
        entry: {
          select: {
            id: true, code: true, date: true, source: true, memo: true,
            branch: { select: { id: true, name: true } },
          },
        },
        party: { select: { id: true, name: true } },
      },
    });

    const opening = await prisma.journalLine.aggregate({
      where: { accountId, entry: { businessId: ctx.businessId, status: 'POSTED', date: { lt: from } } },
      _sum: { debit: true, credit: true },
    });

    const openingBalance = debitPositive
      ? (opening._sum.debit ?? 0) - (opening._sum.credit ?? 0)
      : (opening._sum.credit ?? 0) - (opening._sum.debit ?? 0);

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    ok(res, {
      account,
      from,
      to,
      openingBalance,
      lines,
      totalDebit,
      totalCredit,
      closingBalance: debitPositive ? totalDebit - totalCredit : totalCredit - totalDebit,
    });
  }),
);

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

accountingRouter.get(
  '/balance-sheet',
  handler(async (req, res) => {
    const ctx = context();
    const { to } = parseQuery(z.object({ to: toDateSchema, branchId: z.string().optional() }), req);

    const balances = await transaction((tx) =>
      trialBalance(tx, ctx.businessId, new Date(0), to, null),
    );

    const group = (type: string) =>
      balances
        .filter((b) => b.type === type)
        .map((b) => ({ code: b.code, name: b.name, balance: b.balance }));

    const assets = group('ASSET');
    const liabilities = group('LIABILITY');
    const equity = group('EQUITY');
    const revenue = group('REVENUE');
    const expenses = group('EXPENSE');

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
    const totalEquity = equity.reduce((s, a) => s + a.balance, 0);
    const totalRevenue = revenue.reduce((s, a) => s + a.balance, 0);
    const totalExpenses = expenses.reduce((s, a) => s + a.balance, 0);

    // Current earnings are equity, not a separate line: revenue and expense
    // accounts have no closing entries yet, so their net IS the profit.
    const currentEarnings = totalRevenue - totalExpenses;

    ok(res, {
      asOf: to,
      assets,
      liabilities,
      equity,
      revenue,
      expenses,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        currentEarnings,
        liabilitiesAndEquity: totalLiabilities + totalEquity + currentEarnings,
      },
      // The accounting equation must hold. If it does not, something posted an
      // unbalanced journal — surfacing that is far better than hiding it.
      isBalanced: totalAssets === totalLiabilities + totalEquity + currentEarnings,
    });
  }),
);

// ---------------------------------------------------------------------------
// Fiscal periods
// ---------------------------------------------------------------------------

accountingRouter.get(
  '/periods',
  handler(async (req, res) => {
    const ctx = context();
    const year = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();
    const periods = await prisma.fiscalPeriod.findMany({
      where: { businessId: ctx.businessId, year },
      orderBy: { month: 'asc' },
      select: { id: true, year: true, month: true, status: true, openedAt: true, closedAt: true, scopeKey: true },
    });
    ok(res, { year, periods });
  }),
);

const periodSchemaSet = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  branchId: z.string().nullish(),
  status: z.enum(['OPEN', 'CLOSED']),
});

accountingRouter.post(
  '/periods',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(periodSchemaSet, req);
    const scopeKey = input.branchId ? `BRANCH:${input.branchId}` : 'GLOBAL';

    const period = await prisma.fiscalPeriod.upsert({
      where: {
        businessId_scopeKey_year_month: {
          businessId: ctx.businessId,
          scopeKey,
          year: input.year,
          month: input.month,
        },
      },
      create: {
        businessId: ctx.businessId,
        branchId: input.branchId ?? null,
        scopeKey,
        year: input.year,
        month: input.month,
        status: input.status,
        closedAt: input.status === 'CLOSED' ? new Date() : null,
        closedById: input.status === 'CLOSED' ? ctx.userId : null,
      },
      update: {
        status: input.status,
        closedAt: input.status === 'CLOSED' ? new Date() : null,
        closedById: input.status === 'CLOSED' ? ctx.userId : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        businessId: ctx.businessId,
        userId: ctx.userId,
        action: 'UPDATE',
        entityType: 'Setting',
        entityId: period.id,
        entityCode: `${input.year}-${String(input.month).padStart(2, '0')}`,
        changes: { status: input.status },
      },
    });

    ok(res, period);
  }),
);
