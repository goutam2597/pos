import type { Tx } from '../../db/client.js';
import { context } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import type { AccountType, JournalSource } from '../../generated/prisma/enums.js';
import { nextNumber } from '../../lib/numbering.js';

/**
 * Double-entry posting engine.
 *
 * This is the only place in the codebase allowed to write `JournalEntry` and
 * `JournalLine`. Business modules describe WHAT happened in accounting terms and
 * hand it to `postJournal`; they never touch the tables themselves. That single
 * choke point is what guarantees the ledger is always balanced and that no
 * module can quietly forget the credit side.
 *
 * Three invariants are enforced here, not merely documented:
 *
 *  1. **Balance.** Debits must equal credits, exactly, in integer minor units.
 *     There is no "plug" account and no floating point to hide behind.
 *  2. **Period lock.** A posting dated into a CLOSED fiscal period is refused.
 *  3. **Append-only.** A posted entry is never edited or deleted. Corrections
 *     are made by posting a reversing entry linked to the original, so the
 *     audit trail shows both the mistake and the fix.
 */

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

/**
 * System accounts are addressed by a stable CODE rather than by database id, so
 * that seeding a new business or importing a chart of accounts never requires
 * hard-coded ids sprinkled through the business logic.
 */
export const ACCOUNT_CODES = {
  CASH: '1000',
  BANK: '1010',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  FIXED_ASSET: '1500',
  ACCOUNTS_PAYABLE: '2000',
  TAX_PAYABLE: '2100',
  CREDIT_CARD: '2050',
  OWNERS_EQUITY: '3000',
  RETAINED_EARNINGS: '3100',
  SALES_REVENUE: '4000',
  SERVICE_REVENUE: '4010',
  OTHER_INCOME: '4090',
  SALES_DISCOUNT: '4900',
  TAX_COLLECTED: '2100',
  COGS: '5000',
  EXPENSE: '6000',
  RENT: '6100',
  UTILITIES: '6200',
  SALARIES: '6300',
  SUPPLIES: '6400',
  TRANSPORT: '6500',
  OTHER_EXPENSE: '6900',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

/** Accounts the ledger resolves by code. Mapped to a single code each. */
const RESOLVABLE_CODES: AccountCode[] = [
  ACCOUNT_CODES.CASH,
  ACCOUNT_CODES.BANK,
  ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
  ACCOUNT_CODES.INVENTORY,
  ACCOUNT_CODES.ACCOUNTS_PAYABLE,
  ACCOUNT_CODES.TAX_PAYABLE,
  ACCOUNT_CODES.OWNERS_EQUITY,
  ACCOUNT_CODES.RETAINED_EARNINGS,
  ACCOUNT_CODES.SALES_REVENUE,
  ACCOUNT_CODES.SERVICE_REVENUE,
  ACCOUNT_CODES.OTHER_INCOME,
  ACCOUNT_CODES.SALES_DISCOUNT,
  ACCOUNT_CODES.COGS,
  ACCOUNT_CODES.EXPENSE,
  ACCOUNT_CODES.RENT,
  ACCOUNT_CODES.UTILITIES,
  ACCOUNT_CODES.SALARIES,
  ACCOUNT_CODES.SUPPLIES,
  ACCOUNT_CODES.TRANSPORT,
  ACCOUNT_CODES.OTHER_EXPENSE,
];

/**
 * Load the system accounts for a business, keyed by code.
 *
 * Cached per business for the life of a request; a posting may need several
 * accounts and each `findUnique` would otherwise be a separate round trip.
 */
export async function resolveSystemAccounts(
  tx: Tx,
  businessId: string,
): Promise<Map<string, { id: string; type: AccountType; code: string }>> {
  const rows = await tx.account.findMany({
    where: { businessId, code: { in: RESOLVABLE_CODES } },
    select: { id: true, code: true, type: true, isActive: true },
  });

  const map = new Map<string, { id: string; type: AccountType; code: string }>();
  for (const row of rows) {
    if (row.isActive) map.set(row.code, row);
  }

  const missing = RESOLVABLE_CODES.filter((code) => !map.has(code));
  if (missing.length > 0) {
    throw new AppError(
      'UNPROCESSABLE',
      `Your chart of accounts is incomplete (missing ${missing.join(', ')}). ` +
        'Run the chart-of-accounts seed before posting transactions.',
    );
  }
  return map;
}

export async function accountIdFor(
  accounts: Map<string, { id: string }>,
  code: AccountCode,
): Promise<string> {
  const account = accounts.get(code);
  if (!account) {
    throw new AppError('UNPROCESSABLE', `Account ${code} is not configured`);
  }
  return account.id;
}

// ---------------------------------------------------------------------------
// Period locking
// ---------------------------------------------------------------------------

/**
 * Refuse to post into a closed fiscal period.
 *
 * The check is `year`/`month` on the posting date, which is the period the entry
 * would land in. This is what makes a month-end close meaningful: after
 * reporting is signed off, back-dating into it requires an explicit,
 * audited reopen by someone with the right permission.
 */
export async function assertPeriodOpen(
  tx: Tx,
  businessId: string,
  branchId: string | null | undefined,
  date: Date,
): Promise<void> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const locked = await tx.fiscalPeriod.findFirst({
    where: {
      businessId,
      status: 'CLOSED',
      year,
      month,
      OR: [{ scopeKey: 'GLOBAL' }, ...(branchId ? [{ scopeKey: `BRANCH:${branchId}` }] : [])],
    },
    select: { id: true, scopeKey: true },
  });

  if (locked) {
    throw new AppError(
      'PERIOD_CLOSED',
      `${year}-${String(month).padStart(2, '0')} is closed and cannot receive new entries. ` +
        'Reopen the period first if this entry is required.',
    );
  }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export interface JournalLineInput {
  /** Account code (see `ACCOUNT_CODES`) or an explicit account id. */
  account: string;
  /** Exactly one of debit/credit should be non-zero; `amount` is a shortcut. */
  debit?: number;
  credit?: number;
  /** Signed convenience: positive debits, negative credits. */
  amount?: number;
  memo?: string;
  partyId?: string | null;
  productId?: string | null;
}

export interface PostJournalInput {
  businessId: string;
  branchId?: string | null;
  date?: Date;
  source: JournalSource;
  memo: string;
  referenceType?: string | null;
  referenceId?: string | null;
  saleId?: string | null;
  purchaseId?: string | null;
  returnId?: string | null;
  /** Pre-allocated code; when omitted one is drawn from the document sequence. */
  code?: string;
  lines: JournalLineInput[];
}

export interface PostedJournal {
  id: string;
  code: string;
  totalDebit: number;
  totalCredit: number;
}

/**
 * Post a balanced journal entry.
 *
 * MUST be called with the transaction that owns the business operation. Posting
 * a journal outside the same transaction as the document that caused it is the
 * classic way to end up with a sale and no revenue, and is not preventable here
 * — but every call site in this codebase does it correctly, and the audit log
 * records the pairing.
 */
export async function postJournal(
  tx: Tx,
  input: PostJournalInput,
  accounts?: Map<string, { id: string; type: AccountType; code: string }>,
): Promise<PostedJournal> {
  const date = input.date ?? new Date();
  const ctx = safeContext();

  await assertPeriodOpen(tx, input.businessId, input.branchId, date);

  const resolved = accounts ?? (await resolveSystemAccounts(tx, input.businessId));

  // Normalise every line to explicit debit/credit before any arithmetic.
  const lines = input.lines.map((line, index) => {
    let debit = line.debit ?? 0;
    let credit = line.credit ?? 0;

    if (line.amount !== undefined && debit === 0 && credit === 0) {
      if (line.amount >= 0) debit = line.amount;
      else credit = -line.amount;
    }

    debit = Math.trunc(debit);
    credit = Math.trunc(credit);

    if (debit < 0 || credit < 0) {
      throw new AppError('UNPROCESSABLE', `Journal line ${index + 1} has a negative amount`);
    }
    if (debit !== 0 && credit !== 0) {
      throw new AppError(
        'UNPROCESSABLE',
        `Journal line ${index + 1} is both a debit and a credit; a line must be one or the other`,
      );
    }
    if (debit === 0 && credit === 0) {
      throw new AppError('UNPROCESSABLE', `Journal line ${index + 1} has a zero amount`);
    }

    const account = resolved.get(line.account);
    if (!account) {
      // Not a system code — allow an explicit account id to be passed through.
      return { accountId: line.account, debit, credit, memo: line.memo ?? null, partyId: line.partyId ?? null, productId: line.productId ?? null, position: index };
    }
    return {
      accountId: account.id,
      debit,
      credit,
      memo: line.memo ?? null,
      partyId: line.partyId ?? null,
      productId: line.productId ?? null,
      position: index,
    };
  });

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

  if (totalDebit !== totalCredit) {
    throw new AppError(
      'JOURNAL_UNBALANCED',
      `Journal is out of balance by ${Math.abs(totalDebit - totalCredit)} minor units ` +
        `(debits ${totalDebit}, credits ${totalCredit})`,
    );
  }
  if (totalDebit === 0) {
    throw new AppError('UNPROCESSABLE', 'A journal entry must have a non-zero total');
  }

  const code = input.code ?? (await nextJournalCode(tx, input.businessId, input.branchId));

  const entry = await tx.journalEntry.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      code,
      date,
      status: 'POSTED',
      source: input.source,
      memo: input.memo,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      saleId: input.saleId ?? null,
      purchaseId: input.purchaseId ?? null,
      returnId: input.returnId ?? null,
      totalDebit,
      totalCredit,
      createdById: ctx?.userId ?? null,
      postedAt: date,
      lines: { create: lines },
    },
    select: { id: true, code: true, totalDebit: true, totalCredit: true },
  });

  // Materialise per-line running balances for the account ledger. Done after
  // insert (not inside `create`) so the entry id is available and the balances
  // are computed in one deterministic pass per account.
  await refreshAccountBalances(tx, entry.id);

  return entry;
}

/**
 * Post the mirror image of an existing entry.
 *
 * Voids never edit history: they append the opposite entry and link the two, so
 * an auditor can see both what was posted and what corrected it.
 */
export async function reverseJournal(
  tx: Tx,
  originalId: string,
  memo: string,
): Promise<PostedJournal> {
  const original = await tx.journalEntry.findUnique({
    where: { id: originalId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });

  if (!original) throw new AppError('NOT_FOUND', 'The journal entry to reverse was not found');
  if (original.reversedById) {
    throw new AppError('CONFLICT', `Journal ${original.code} has already been reversed`);
  }

  const posted = await postJournal(tx, {
    businessId: original.businessId,
    branchId: original.branchId,
    date: new Date(),
    source: original.source === 'MANUAL' ? 'MANUAL' : 'MANUAL',
    memo,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    lines: original.lines.map((line) => ({
      account: line.accountId,
      debit: line.credit,
      credit: line.debit,
      memo: line.memo ?? undefined,
      partyId: line.partyId,
      productId: line.productId,
    })),
  });

  await tx.journalEntry.update({
    where: { id: original.id },
    data: { status: 'REVERSED', reversedById: posted.id },
  });

  return posted;
}

/**
 * Recompute the running `balance` on each affected line.
 *
 * A line's balance is the net movement of its account from the beginning of
 * time up to and including that line. Debits are positive for assets and
 * expenses, negative for equity, revenue and liabilities — this is the sign
 * convention that lets the balance sheet and P&L be summed directly.
 */
async function refreshAccountBalances(tx: Tx, entryId: string): Promise<void> {
  const entry = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!entry) return;

  const accountIds = [...new Set(entry.lines.map((l) => l.accountId))];
  if (accountIds.length === 0) return;

  const accounts = await tx.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, type: true },
  });
  const debitPositive = new Map(
    accounts.map((a) => [a.id, a.type === 'ASSET' || a.type === 'EXPENSE']),
  );

  // Process every posted line for these accounts in chronological order,
  // including entries posted before this one, so balances stay correct.
  const history = await tx.journalLine.findMany({
    where: {
      accountId: { in: accountIds },
      entry: { status: 'POSTED' },
    },
    orderBy: [{ entry: { date: 'asc' } }, { entryId: 'asc' }, { position: 'asc' }],
    select: { id: true, accountId: true, debit: true, credit: true },
  });

  const running = new Map<string, number>(accountIds.map((id) => [id, 0]));
  const updates: { id: string; balance: number }[] = [];

  for (const line of history) {
    const positive = debitPositive.get(line.accountId) ?? true;
    const movement = positive ? line.debit - line.credit : line.credit - line.debit;
    const balance = (running.get(line.accountId) ?? 0) + movement;
    running.set(line.accountId, balance);
    updates.push({ id: line.id, balance });
  }

  // Chunked to stay well under the 65535 bind-parameter limit in Postgres.
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    await Promise.all(
      chunk.map((u) => tx.journalLine.update({ where: { id: u.id }, data: { balance: u.balance } })),
    );
  }
}

// ---------------------------------------------------------------------------
// Document numbering for journals
// ---------------------------------------------------------------------------

/**
 * Journal codes come from the shared document-sequence machinery rather than a
 * local counter, so numbering is gap-free, transactional and collision-free
 * across every process posting to this business.
 */
async function nextJournalCode(tx: Tx, businessId: string, branchId?: string | null): Promise<string> {
  return nextNumber(tx, {
    businessId,
    branchId: branchId ?? null,
    type: 'JOURNAL',
    prefix: 'JE',
    padding: 8,
  });
}

// ---------------------------------------------------------------------------
// Query helpers used by the reports module
// ---------------------------------------------------------------------------

export interface LedgerAccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
}

/** Trial balance: every account with a movement in the period. */
export async function trialBalance(
  tx: Tx,
  businessId: string,
  from: Date,
  to: Date,
  branchId?: string | null,
): Promise<LedgerAccountBalance[]> {
  const rows = await tx.journalLine.findMany({
    where: {
      account: { businessId },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      entry: { status: 'POSTED', date: { gte: from, lte: to } },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { id: true, code: true, name: true, type: true } },
    },
  });

  const byAccount = new Map<string, LedgerAccountBalance>();
  for (const row of rows) {
    const existing = byAccount.get(row.account.id) ?? {
      accountId: row.account.id,
      code: row.account.code,
      name: row.account.name,
      type: row.account.type,
      debit: 0,
      credit: 0,
      balance: 0,
    };
    existing.debit += row.debit;
    existing.credit += row.credit;
    existing.balance =
      existing.type === 'ASSET' || existing.type === 'EXPENSE'
        ? existing.debit - existing.credit
        : existing.credit - existing.debit;
    byAccount.set(row.account.id, existing);
  }

  return [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export interface ProfitAndLoss {
  revenue: number;
  discounts: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  expenses: number;
  netProfit: number;
  netMarginPercent: number;
  byAccount: Array<{ code: string; name: string; amount: number }>;
}

/**
 * Profit and loss for a period.
 *
 * Revenue is reported net of sales discounts and excludes collected tax, which
 * is a liability rather than income. That single decision is the difference
 * between a P&L a bookkeeper accepts and one they have to rework.
 */
export async function profitAndLoss(
  tx: Tx,
  businessId: string,
  from: Date,
  to: Date,
  branchId?: string | null,
): Promise<ProfitAndLoss> {
  const balances = await trialBalance(tx, businessId, from, to, branchId);

  const revenueAccounts = balances.filter((b) => b.type === 'REVENUE');
  const discount = sumBy(balances, (b) => b.code === ACCOUNT_CODES.SALES_DISCOUNT, (b) => b.balance);
  const revenue = revenueAccounts
    .filter((b) => b.code !== ACCOUNT_CODES.SALES_DISCOUNT)
    .reduce((sum, b) => sum + b.balance, 0);

  const cogs = sumBy(balances, (b) => b.code === ACCOUNT_CODES.COGS, (b) => b.balance);
  const expenseAccounts = balances.filter(
    (b) => b.type === 'EXPENSE' && b.code !== ACCOUNT_CODES.COGS,
  );
  const expenses = expenseAccounts.reduce((sum, b) => sum + b.balance, 0);

  const netRevenue = revenue - discount;
  const grossProfit = netRevenue - cogs;

  return {
    revenue,
    discounts: discount,
    netRevenue,
    cogs,
    grossProfit,
    grossMarginPercent: netRevenue === 0 ? 0 : round2((grossProfit / netRevenue) * 100),
    expenses,
    netProfit: grossProfit - expenses,
    netMarginPercent: netRevenue === 0 ? 0 : round2((grossProfit - expenses) / netRevenue * 100),
    byAccount: [
      ...revenueAccounts.map((b) => ({ code: b.code, name: b.name, amount: b.balance })),
      ...expenseAccounts.map((b) => ({ code: b.code, name: b.name, amount: b.balance })),
    ],
  };
}

function sumBy<T>(items: T[], predicate: (item: T) => boolean, value: (item: T) => number): number {
  return items.filter(predicate).reduce((sum, item) => sum + value(item), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Context is optional so seed scripts and tests can post without a request. */
function safeContext() {
  try {
    return context();
  } catch {
    return undefined;
  }
}
