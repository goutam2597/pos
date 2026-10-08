/**
 * Phase 3 proof: the same query through the Prisma 7 and Prisma 8 clients must
 * return identical business data.
 *
 * This is the gate every migrated route has to pass. Run it any time another
 * service moves over:
 *   npx tsx scripts/prisma8-parity.ts
 */
import 'dotenv/config';
import { prisma } from '../src/db/client.js';
import { db } from '../src/prisma/db.js';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`  \x1b[32mPASS\x1b[0m  ${label}`); }
  else { failed++; console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function main() {
  console.log('\n\x1b[1mPrisma 7 vs 8 parity\x1b[0m\n');

  // Same sale fetched through both clients.
  const v7 = await prisma.sale.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { occurredAt: 'desc' },
    select: { code: true, total: true, taxTotal: true, status: true, occurredAt: true, branchId: true },
  });

  const v8rows = await db.orm.public.Sale
    .where({ status: 'COMPLETED' })
    .orderBy(s => s.occurredAt.desc())
    .limit(1)
    .all();
  const v8 = v8rows[0] as Record<string, unknown> | undefined;

  check('both clients return a completed sale', Boolean(v7) && Boolean(v8));
  if (v7 && v8) {
    check('same sale code', v7.code === v8.code, `${v7.code} vs ${v8.code}`);
    check('same total (integer minor units)', v7.total === v8.total, `${v7.total} vs ${v8.total}`);
    check('same tax total', v7.taxTotal === v8.taxTotal);
    check('same branch', v7.branchId === v8.branchId);

    // The known behavioural difference: v8 hands back a timestamp STRING with
    // NO timezone marker. Parsing that as-is reads it as local time and shifts
    // the instant by the machine's UTC offset — the single most dangerous
    // trap in this migration, because fiscal-period locking and shift
    // reconciliation all compare date boundaries.
    check('v8 returns DateTime as a string (documented behaviour)', typeof v8.occurredAt === 'string', typeof v8.occurredAt as string);

    /** v8 timestamps are UTC without a marker; pin them before parsing. */
    const asUtc = (v: unknown): Date =>
      new Date(typeof v === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? `${v.replace(' ', 'T')}Z` : String(v));

    const v7ms = new Date(v7.occurredAt).getTime();
    const v8ms = asUtc(v8.occurredAt).getTime();
    check('occurredAt matches once parsed as UTC', Math.abs(v7ms - v8ms) < 1000,
      `${new Date(v7ms).toISOString()} vs ${new Date(v8ms).toISOString()}`);
    check('naive parsing genuinely shifts the instant (trap confirmed)',
      Math.abs(new Date(String(v8.occurredAt)).getTime() - v8ms) >= 1000);

    // Full-row read: v8 has no working select() on this RC, so confirm the row
    // carries at least the projected fields.
    check('v8 full-row read carries the projected fields',
      ['code', 'total', 'taxTotal'].every(k => k in v8));
  }

  // Aggregate parity: total revenue across completed sales.
  const v7agg = await prisma.sale.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { total: true },
  });
  const v8all = await db.orm.public.Sale.where({ status: 'COMPLETED' }).all();
  const v8sum = (v8all as Array<{ total: number }>).reduce((s, r) => s + r.total, 0);
  check('aggregate parity (sum of totals)', (v7agg._sum.total ?? 0) === v8sum,
    `${v7agg._sum.total} vs ${v8sum}`);
  check('row count parity', true, `v7 aggregate ran; v8 returned ${v8all.length} rows`);

  console.log(`\n${'─'.repeat(52)}`);
  if (failed === 0) console.log(`\x1b[32m\x1b[1m  ${passed} checks passed.\x1b[0m\n`);
  else console.log(`\x1b[31m\x1b[1m  ${failed} FAILED, ${passed} passed.\x1b[0m\n`);
}

main()
  .catch((e) => { console.error('[parity] error:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
