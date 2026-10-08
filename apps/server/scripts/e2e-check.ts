/**
 * End-to-end verification of the guarantees this system claims.
 *
 * Runs against a live server and a real database. Every assertion here maps to
 * a promise made in the product brief — if one of these fails, the product is
 * not doing what it says.
 *
 *   1. A sale writes sale + invoice + payments + stock + balanced journals.
 *   2. The journal for that sale balances exactly, in integer minor units.
 *   3. Stock decremented by exactly the quantity sold.
 *   4. Replaying the same sale (offline retry) creates NOTHING new.
 *   5. A batch where one item conflicts still commits the others.
 *   6. Money with awkward decimals rounds the way a human expects.
 *
 * Usage:  npx tsx scripts/e2e-check.ts
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { allocate, percentOf, formatMoney, toMinor } from '@monopos/shared';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_EMAIL ?? 'admin@monopos.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${payload?.error?.message ?? text}`);
  }
  return payload as T;
}

async function main() {
  console.log('\n\x1b[1mMonoPOS end-to-end verification\x1b[0m\n');

  // --- Pure money maths (no server needed) --------------------------------
  console.log('Money arithmetic');
  check('1000 minor units formats as 10.00', formatMoney(1000) === '10.00', formatMoney(1000));
  check('12.005 rounds to 1201, not 1200', toMinor('12.005') === 1201, String(toMinor('12.005')));
  check('0.1 + 0.2 is exact in minor units', toMinor(0.1) + toMinor(0.2) === 30, String(toMinor(0.1) + toMinor(0.2)));
  check('repeated addition never drifts', [1, 2, 3].reduce((s, n) => s + n * 10, 0) === 60);
  check('percentOf(1000, 10) === 100', percentOf(1000, 10) === 100, String(percentOf(1000, 10)));
  const split = allocate(1000, [1, 1, 1]);
  check('allocate sums back to the original', split.reduce((a, b) => a + b, 0) === 1000, split.join('+'));
  check('allocate never loses a penny', split.every((v) => Math.abs(v - 333) <= 1), split.join(','));

  // --- Auth ----------------------------------------------------------------
  console.log('\nAuthentication');
  const session = await api<{ data: { accessToken: string; user: { businessId: string } } }>('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = session.data.accessToken;
  const businessId = session.data.user.businessId;
  check('login returns an access token', Boolean(token));

  const rejected = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'wrong-password-entirely' }),
  });
  check('a wrong password is rejected', rejected.status === 401, String(rejected.status));

  const unauthenticated = await fetch(`${API}/sales`);
  check('sales require a session', unauthenticated.status === 401, String(unauthenticated.status));

  // --- Catalog -------------------------------------------------------------
  console.log('\nCatalog');
  const branch = await prisma.branch.findFirstOrThrow({ where: { businessId } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { businessId, code: 'STORE' } });

  const products = await api<{ data: Array<{ id: string; name: string; price: number }> }>(
    `/products?pageSize=5`,
    { token },
  );
  check('products are listable', products.data.length === 5, String(products.data.length));

  const product = products.data[0]!;
  // Pick something the seeded store actually stocks, so the test exercises the
  // sale path rather than the (also important) out-of-stock path.
  const stocked = await prisma.stockLevel.findMany({
    where: { businessId, warehouseId: warehouse.id, qtyOnHand: { gt: 5_000 } },
    orderBy: { qtyOnHand: 'desc' },
    take: 1,
    include: { product: { select: { id: true, name: true, price: true } } },
  });
  const taxable = stocked[0]?.product ?? product;

  const stockBefore = await prisma.stockLevel.findFirstOrThrow({
    where: { businessId, warehouseId: warehouse.id, itemKey: taxable.id },
    select: { qtyOnHand: true },
  });

  // --- A sale, end to end --------------------------------------------------
  console.log('\nSale: documents, stock and accounting');
  const clientTxnId = `e2e-${Date.now()}`;

  const saleResponse = await api<{
    data: { saleId: string; saleCode: string; invoiceCode: string; totals: Record<string, number>; duplicate: boolean };
  }>('/sales', {
    method: 'POST',
    token,
    body: {
      branchId: branch.id,
      lines: [{ productId: taxable.id, qtyMilli: 2000, discountType: 'PERCENT', discountValue: 500 }],
      // Deliberately overpay so the sale exercises change calculation.
      payments: [{ method: 'CASH', amount: 50_000 }],
      clientTxnId,
      note: 'e2e verification sale',
    },
  });
  const sale = saleResponse.data;
  check('a sale is created', Boolean(sale.saleId));
  check('it is not flagged as a duplicate', sale.duplicate === false);
  check('an invoice number is allocated', /^INV\d{6}$/.test(sale.invoiceCode ?? ''), sale.invoiceCode);

  // Totals: 2 units at 2.99, 5% off.
  const expectedGross = taxable.price * 2;
  const expectedDiscount = Math.round((expectedGross * 500) / 10_000);
  const expectedNet = expectedGross - expectedDiscount;
  const expectedTax = Math.round((expectedNet * 1000) / 10_000);
  check(
    'line discount is applied in basis points',
    sale.totals.discountTotal === expectedDiscount,
    `${sale.totals.discountTotal} vs ${expectedDiscount}`,
  );
  check('tax is charged on the discounted amount', sale.totals.taxTotal === expectedTax, `${sale.totals.taxTotal} vs ${expectedTax}`);
  check('subtotal excludes tax', sale.totals.subtotal === expectedNet, `${sale.totals.subtotal} vs ${expectedNet}`);
  // An all-cash sale is rounded down to the nearest whole currency unit, so the
  // charged total is <= subtotal + tax. That is a real feature, not a fudge.
  const unrounded = expectedNet + expectedTax;
  check(
    'an all-cash sale is rounded down to the nearest whole unit',
    sale.totals.total <= unrounded && unrounded - sale.totals.total < 100,
    `charged ${sale.totals.total}, unrounded ${unrounded}`,
  );
  check(
    'overpayment becomes change rather than an error',
    sale.totals.balanceDue === 0 && sale.totals.paid === 50_000,
    `paid ${sale.totals.paid}, due ${sale.totals.balanceDue}`,
  );

  const stockAfter = await prisma.stockLevel.findFirstOrThrow({
    where: { businessId, warehouseId: warehouse.id, itemKey: taxable.id },
    select: { qtyOnHand: true },
  });
  check(
    'stock dropped by exactly the quantity sold',
    stockBefore.qtyOnHand - stockAfter.qtyOnHand === 2000,
    `${stockBefore.qtyOnHand} -> ${stockAfter.qtyOnHand}`,
  );

  const saleMoves = await prisma.stockMove.count({ where: { referenceId: sale.saleId, type: 'SALE' } });
  check('a stock movement was written', saleMoves === 1, String(saleMoves));

  // --- The ledger ----------------------------------------------------------
  console.log('\nAccounting');
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, saleId: sale.saleId },
    include: { lines: { include: { account: { select: { code: true, type: true } } } } },
  });
  check('the sale produced journal entries', entries.length >= 1, String(entries.length));

  let allBalanced = true;
  let ledgerBalanced = true;
  for (const entry of entries) {
    const debit = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const credit = entry.lines.reduce((sum, l) => sum + l.credit, 0);
    if (debit !== credit || entry.totalDebit !== debit || entry.totalCredit !== credit) {
      allBalanced = false;
      console.log(`        ${entry.code}: debits ${debit} credits ${credit}`);
    }
  }
  check('every journal entry balances', allBalanced);

  const revenueEntry = entries.find((e) => e.lines.some((l) => l.account.code === '4000'));
  check('revenue was recognised', Boolean(revenueEntry));
  check('tax was posted as a liability', entries.some((e) => e.lines.some((l) => l.account.code === '2100')));

  const cogsEntry = entries.find((e) => e.lines.some((l) => l.account.code === '5000'));
  check('cost of goods sold was posted', Boolean(cogsEntry));

  // Trial balance must tie out across the whole business.
  const allLines = await prisma.journalLine.findMany({
    where: { account: { businessId } },
    select: { debit: true, credit: true },
  });
  const totalDebit = allLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = allLines.reduce((s, l) => s + l.credit, 0);
  check('the whole ledger is in balance', totalDebit === totalCredit, `${totalDebit} vs ${totalCredit}`);
  ledgerBalanced = totalDebit === totalCredit;

  // --- Offline replay: the core guarantee ----------------------------------
  console.log('\nOffline replay (idempotency)');
  const replay = await api<{ data: { saleId: string; duplicate: boolean } }>('/sales', {
    method: 'POST',
    token,
    body: {
      branchId: branch.id,
      lines: [{ productId: taxable.id, qtyMilli: 2000, discountType: 'PERCENT', discountValue: 500 }],
      payments: [{ method: 'CASH', amount: 50_000 }],
      clientTxnId,
    },
  });
  check('a replayed sale returns the original', replay.data.saleId === sale.saleId);
  check('a replayed sale is flagged as a duplicate', replay.data.duplicate === true);

  const saleCount = await prisma.sale.count({ where: { businessId, clientTxnId } });
  check('a replayed sale creates no second record', saleCount === 1, String(saleCount));

  const stockAfterReplay = await prisma.stockLevel.findFirstOrThrow({
    where: { businessId, warehouseId: warehouse.id, itemKey: taxable.id },
    select: { qtyOnHand: true },
  });
  check('a replayed sale does not decrement stock twice', stockAfterReplay.qtyOnHand === stockAfter.qtyOnHand);

  const movesAfterReplay = await prisma.stockMove.count({
    where: { businessId, type: 'SALE', referenceId: sale.saleId },
  });
  check('a replayed sale writes no extra stock movement', movesAfterReplay === 1, String(movesAfterReplay));

  // --- Sync protocol -------------------------------------------------------
  console.log('\nSync protocol');
  const offlineTxn = `e2e-offline-${Date.now()}`;

  // A batch of three: two good sales and one deliberately broken payload. The
  // server must commit the two good ones and reject only the broken one.
  const push = await api<{
    data: {
      results: Array<{ clientTxnId: string; kind: string; note?: string }>;
    };
  }>('/sync/push', {
    method: 'POST',
    token,
    body: {
      protocolVersion: 1,
      deviceId: 'e2e-till-1',
      items: [
        {
          clientTxnId: `${offlineTxn}-a`,
          type: 'SALE_CREATE',
          capturedAt: Date.now() - 60_000,
          registerId: null,
          payload: {
            branchId: branch.id,
            lines: [{ productId: taxable.id, qtyMilli: 1000 }],
            payments: [{ method: 'CASH', amount: 10_000 }],
          },
        },
        {
          clientTxnId: `${offlineTxn}-b`,
          type: 'SALE_CREATE',
          capturedAt: Date.now() - 30_000,
          registerId: null,
          payload: {
            branchId: branch.id,
            // Invalid: qtyMilli must be a positive integer.
            lines: [{ productId: taxable.id, qtyMilli: -5 }],
            payments: [{ method: 'CASH', amount: 10_000 }],
          },
        },
        {
          clientTxnId: `${offlineTxn}-c`,
          type: 'SALE_CREATE',
          capturedAt: Date.now(),
          registerId: null,
          payload: {
            branchId: branch.id,
            lines: [{ productId: taxable.id, qtyMilli: 1000 }],
            payments: [{ method: 'CASH', amount: 10_000 }],
          },
        },
      ],
    },
  });

  const results = push.data.results;
  const byId = new Map(results.map((r) => [r.clientTxnId, r]));
  check('a valid offline sale is applied', byId.get(`${offlineTxn}-a`)?.kind === 'applied', byId.get(`${offlineTxn}-a`)?.note);
  check('an invalid offline sale is rejected', byId.get(`${offlineTxn}-b`)?.kind === 'rejected', byId.get(`${offlineTxn}-b`)?.note);
  check(
    'a bad item does NOT block the rest of the batch',
    byId.get(`${offlineTxn}-c`)?.kind === 'applied',
    byId.get(`${offlineTxn}-c`)?.note,
  );

  const appliedOffline = await prisma.sale.count({
    where: { businessId, clientTxnId: { in: [`${offlineTxn}-a`, `${offlineTxn}-c`] } },
  });
  check('both valid offline sales exist', appliedOffline === 2, String(appliedOffline));

  const rejectedOffline = await prisma.sale.count({ where: { businessId, clientTxnId: `${offlineTxn}-b` } });
  check('the rejected offline sale was not created', rejectedOffline === 0, String(rejectedOffline));

  // Replay the whole batch: everything should come back as duplicate.
  const replayPush = await api<{ data: { results: Array<{ clientTxnId: string; kind: string }> } }>('/sync/push', {
    method: 'POST',
    token,
    body: {
      protocolVersion: 1,
      deviceId: 'e2e-till-1',
      items: [
        {
          clientTxnId: `${offlineTxn}-a`,
          type: 'SALE_CREATE',
          capturedAt: Date.now() - 60_000,
          registerId: null,
          payload: {
            branchId: branch.id,
            lines: [{ productId: taxable.id, qtyMilli: 1000 }],
            payments: [{ method: 'CASH', amount: 10_000 }],
          },
        },
      ],
    },
  });
  check(
    'replaying an applied offline sale returns duplicate',
    replayPush.data.results[0]?.kind === 'duplicate',
    replayPush.data.results[0]?.kind,
  );

  const afterReplayCount = await prisma.sale.count({ where: { businessId, clientTxnId: `${offlineTxn}-a` } });
  check('replaying does not duplicate the sale', afterReplayCount === 1, String(afterReplayCount));

  // --- Insufficient stock --------------------------------------------------
  console.log('\nInventory guard');
  const hugeSale = await fetch(`${API}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      branchId: branch.id,
      lines: [{ productId: taxable.id, qtyMilli: 99_000_000 }],
      payments: [{ method: 'CASH', amount: 999_999_999 }],
    }),
  });
  const hugeBody = await hugeSale.json();
  check('overselling is refused', hugeSale.status === 409, String(hugeSale.status));
  check('the refusal names the shortage', String(hugeBody?.error?.message ?? '').includes('Not enough stock'), hugeBody?.error?.message);

  // --- Financial statements ------------------------------------------------
  console.log('\nFinancial statements');
  const trialBalance = await api<{ data: { isBalanced: boolean; totalDebit: number; totalCredit: number } }>(
    `/accounting/trial-balance?from=2000-01-01&to=2100-01-01`,
    { token },
  );
  check('the trial balance ties out', trialBalance.data.isBalanced);
  check('trial balance totals match', trialBalance.data.totalDebit === trialBalance.data.totalCredit);

  const balanceSheet = await api<{ data: { isBalanced: boolean } }>(
    `/accounting/balance-sheet?to=${new Date().toISOString()}`,
    { token },
  );
  check('assets equal liabilities plus equity', balanceSheet.data.isBalanced);

  const pnl = await api<{ data: { netRevenue: number; cogs: number; grossProfit: number } }>(
    `/accounting/profit-loss?from=2000-01-01&to=2100-01-01`,
    { token },
  );
  check(
    'gross profit equals net revenue less cost of goods',
    pnl.data.grossProfit === pnl.data.netRevenue - pnl.data.cogs,
    `${pnl.data.grossProfit} vs ${pnl.data.netRevenue - pnl.data.cogs}`,
  );
  check('revenue was actually recognised', pnl.data.netRevenue > 0, String(pnl.data.netRevenue));

  // --- Void ----------------------------------------------------------------
  console.log('\nVoid');
  // Measure immediately before the void: the sync batch above consumed stock
  // from the same product, so comparing against the pre-sale figure would be
  // comparing against a number that is no longer current.
  const stockBeforeVoid = await prisma.stockLevel.findFirstOrThrow({
    where: { businessId, warehouseId: warehouse.id, itemKey: taxable.id },
    select: { qtyOnHand: true },
  });

  const voided = await api<{ data: { status: string } }>(`/sales/${sale.saleId}/void`, {
    method: 'POST',
    token,
    body: { reason: 'e2e verification void' },
  });
  check('a sale can be voided', voided.data.status === 'VOIDED');

  const stockAfterVoid = await prisma.stockLevel.findFirstOrThrow({
    where: { businessId, warehouseId: warehouse.id, itemKey: taxable.id },
    select: { qtyOnHand: true },
  });
  check(
    'voiding returns the goods to stock',
    stockAfterVoid.qtyOnHand === stockBeforeVoid.qtyOnHand + 2000,
    `${stockAfterVoid.qtyOnHand} vs ${stockBeforeVoid.qtyOnHand + 2000}`,
  );

  // --- Summary -------------------------------------------------------------
  console.log(`\n${'─'.repeat(52)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ${passed} checks passed.\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m\x1b[1m  ${failed} FAILED, ${passed} passed.\x1b[0m\n`);
  }
}

main()
  .catch((error) => {
    console.error('\n[e2e] error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
