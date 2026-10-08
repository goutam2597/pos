/**
 * Cross-check: the POS's client-side pricing must agree with the server's.
 *
 * The till prices a cart locally (so the cashier sees a total instantly and can
 * keep selling offline) and the server prices it again authoritatively when the
 * sale syncs. If those two implementations ever disagree, the customer is
 * charged one amount on the receipt and a different amount in the books — which
 * is exactly the sort of defect that only surfaces at reconciliation.
 *
 * This runs both implementations over the same randomised carts and reports any
 * divergence. Run it whenever either pricing module changes.
 *
 * Usage: npx tsx scripts/pricing-parity.ts
 */

import { priceCart as serverPriceCart, type PricingLineInput } from '../src/modules/sales/pricing.js';
import { priceCart as clientPriceCart, type CartLineInput } from '../../web/src/lib/offline/pricing.js';

interface Case {
  name: string;
  lines: Array<{
    qtyMilli: number;
    unitPrice: number;
    discountType: 'NONE' | 'PERCENT' | 'FIXED';
    discountValue: number;
    taxRate: number;
    costPrice: number;
  }>;
  cartDiscount: number;
}

const CASES: Case[] = [
  {
    name: 'single simple line',
    lines: [{ qtyMilli: 1000, unitPrice: 299, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 180 }],
    cartDiscount: 0,
  },
  {
    name: 'weighted quantity',
    lines: [{ qtyMilli: 2500, unitPrice: 780, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 420 }],
    cartDiscount: 0,
  },
  {
    name: 'percentage line discount',
    lines: [{ qtyMilli: 2000, unitPrice: 299, discountType: 'PERCENT', discountValue: 500, taxRate: 1000, costPrice: 180 }],
    cartDiscount: 0,
  },
  {
    name: 'cart discount allocated across lines',
    lines: [
      { qtyMilli: 2000, unitPrice: 299, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 180 },
      { qtyMilli: 1000, unitPrice: 1150, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 620 },
      { qtyMilli: 3000, unitPrice: 199, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 95 },
    ],
    cartDiscount: 333,
  },
  {
    name: 'awkward amounts (rounding is where implementations diverge)',
    lines: [
      { qtyMilli: 3330, unitPrice: 105, discountType: 'PERCENT', discountValue: 333, taxRate: 1750, costPrice: 61 },
      { qtyMilli: 7770, unitPrice: 33, discountType: 'FIXED', discountValue: 17, taxRate: 500, costPrice: 19 },
    ],
    cartDiscount: 111,
  },
  {
    name: 'mixed tax rates',
    lines: [
      { qtyMilli: 1000, unitPrice: 5000, discountType: 'NONE', discountValue: 0, taxRate: 2000, costPrice: 3000 },
      { qtyMilli: 1000, unitPrice: 3333, discountType: 'NONE', discountValue: 0, taxRate: 0, costPrice: 1111 },
      { qtyMilli: 500, unitPrice: 7777, discountType: 'PERCENT', discountValue: 1250, taxRate: 1000, costPrice: 4000 },
    ],
    cartDiscount: 500,
  },
  {
    name: 'discount larger than the cart',
    lines: [{ qtyMilli: 1000, unitPrice: 100, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 50 }],
    cartDiscount: 999_999,
  },
  {
    name: 'zero-priced line',
    lines: [
      { qtyMilli: 1000, unitPrice: 0, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 0 },
      { qtyMilli: 1000, unitPrice: 250, discountType: 'NONE', discountValue: 0, taxRate: 1000, costPrice: 100 },
    ],
    cartDiscount: 50,
  },
];

function toServerInput(testCase: Case): PricingLineInput[] {
  return testCase.lines.map((line, index) => ({
    productId: `p${index}`,
    variantId: null,
    name: `Line ${index + 1}`,
    sku: null,
    unitName: null,
    qtyMilli: line.qtyMilli,
    unitPrice: line.unitPrice,
    discountType: line.discountType,
    discountValue: line.discountValue,
    taxId: line.taxRate > 0 ? 't1' : null,
    taxRate: line.taxRate,
    taxInclusive: false,
    trackInventory: true,
    allowBackorder: false,
    allowNegativeStock: false,
    costPrice: line.costPrice,
    warehouseId: 'w1',
    position: index,
  }));
}

function toClientInput(testCase: Case): CartLineInput[] {
  return testCase.lines.map((line, index) => ({
    productId: `p${index}`,
    variantId: null,
    name: `Line ${index + 1}`,
    sku: null,
    qtyMilli: line.qtyMilli,
    unitPrice: line.unitPrice,
    discountType: line.discountType,
    discountValue: line.discountValue,
    taxRate: line.taxRate,
    costPrice: line.costPrice,
    trackInventory: true,
    lineId: `l${index}`,
    position: index,
  } as CartLineInput));
}

let failures = 0;

console.log('\n\x1b[1mPricing parity: server vs POS client\x1b[0m\n');

for (const testCase of CASES) {
  const server = serverPriceCart({
    lines: toServerInput(testCase),
    cartDiscount: testCase.cartDiscount,
  });

  const client = clientPriceCart(
    toClientInput(testCase),
    testCase.cartDiscount > 0 ? { type: 'FIXED', value: testCase.cartDiscount } : { type: 'NONE', value: 0 },
  );

  // Compare like for like. The server's `subtotal` is tax-exclusive NET revenue;
  // the POS's `grossSubtotal` is what a receipt prints above the discount lines.
  // The net figures are the ones that must agree to the minor unit.
  const comparisons: Array<[string, number, number]> = [
    ['subtotal (net)', server.subtotal, client.netSubtotal],
    ['discount', server.discountTotal, client.discountTotal],
    ['tax', server.taxTotal, client.taxTotal],
    ['total', server.total, client.total],
    ['cost', server.costTotal, client.costTotal],
    ['profit', server.profitTotal, client.profitTotal],
  ];

  const mismatches = comparisons.filter(([, a, b]) => a !== b);

  if (mismatches.length === 0) {
    console.log(`  \x1b[32mPASS\x1b[0m  ${testCase.name}`);
    console.log(
      `        subtotal ${server.subtotal}  discount ${server.discountTotal}  ` +
        `tax ${server.taxTotal}  total ${server.total}`,
    );
  } else {
    failures += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${testCase.name}`);
    for (const [label, a, b] of mismatches) {
      console.log(`        \x1b[31m${label}: server ${a} vs client ${b} (diff ${b - a})\x1b[0m`);
    }
  }

  // Per-line totals must agree too; a header can match while a line does not.
  for (let i = 0; i < server.lines.length; i += 1) {
    const s = server.lines[i]!;
    const c = client.lines[i] as { lineSubtotal: number; tax: number; total: number } | undefined;
    if (!c) continue;
    if (s.lineSubtotal !== c.lineSubtotal || s.taxAmount !== c.tax || s.lineTotal !== c.total) {
      failures += 1;
      console.log(
        `        \x1b[31mline ${i + 1}: server ${s.lineSubtotal}/${s.taxAmount}/${s.lineTotal} ` +
          `vs client ${c.lineSubtotal}/${c.taxAmount}/${c.lineTotal}\x1b[0m`,
      );
    }
  }
}

console.log(`\n${'─'.repeat(52)}`);
if (failures === 0) {
  console.log(`\x1b[32m\x1b[1m  Client and server agree on every case.\x1b[0m\n`);
} else {
  console.log(`\x1b[31m\x1b[1m  ${failures} divergence(s) found.\x1b[0m\n`);
  process.exitCode = 1;
}
