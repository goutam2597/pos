/**
 * Cart pricing — the client-side mirror of the server's pricing rules.
 *
 * WHY THIS EXISTS. A sale captured offline has to print a correct total
 * immediately, with no server to ask. It then syncs and the server recomputes
 * the totals authoritatively. If the two disagree, the receipt the customer was
 * handed becomes a lie and the invoice becomes a different number. So the rule
 * is not "close enough" — it is the same arithmetic, in the same order, using
 * the same integer helpers from `@monopos/shared`.
 *
 * THE ORDER MATTERS and is fixed:
 *   1. gross        = qtyMilli x unitPrice          (lineValue, half away from zero)
 *   2. line discount applied to gross              (basis points for PERCENT)
 *   3. cart discount allocated across the lines    (largest-remainder, no lost pennies)
 *   4. tax per line on the post-discount net       (EXCLUSIVE/EXCLUSIVE-equivalent)
 *   5. total        = sum of line totals
 *
 * Discount is applied BEFORE tax because that is what a customer expects: a
 * discount is a reduction of what the goods are worth, and tax is charged on
 * what they are worth.
 *
 * ALL MONEY IS INTEGER MINOR UNITS. ALL QUANTITIES ARE INTEGER MILLI-UNITS.
 * There is no floating point anywhere in this file, and `pricing.ts` imports
 * nothing from React so it stays a genuinely testable pure module.
 */

import { allocate, lineDiscount, lineValue, percentOf, type QtyMilli } from '@monopos/shared';

/** Mirrors the server enum exactly. `PERCENT` carries basis points. */
export type DiscountType = 'NONE' | 'PERCENT' | 'FIXED';

export const NO_DISCOUNT: CartDiscount = { type: 'NONE', value: 0 };

export interface CartDiscount {
  type: DiscountType;
  /** Basis points (1% = 100) when `type` is `PERCENT`; minor units when `FIXED`. */
  value: number;
}

/** A line as the cashier left it: quantities and prices, no arithmetic yet. */
export interface CartLineInput {
  /** Stable within a cart session; survives qty and discount edits. */
  lineId: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string;
  qtyMilli: QtyMilli;
  /** Minor units per single unit. */
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  /**
   * Tax rate in BASIS POINTS, matching `Tax.rate` on the server: 1000 means
   * 10%. This must be the same unit the server uses or the receipt and the
   * ledger will disagree by two orders of magnitude.
   */
  taxRate: number;
  /** Unit cost in minor units, for the margin readout. */
  costPrice: number;
  trackInventory: boolean;
}

export interface PricedLine extends CartLineInput {
  /** qtyMilli x unitPrice, rounded half away from zero. */
  gross: number;
  /** gross - lineDiscount - cartDiscount: the tax-exclusive net revenue. */
  lineSubtotal: number;
  /** lineSubtotal x qtyMilli, for the margin readout. */
  lineCost: number;
  lineDiscount: number;
  /** gross - lineDiscount. */
  netAfterLineDiscount: number;
  /** This line's share of the cart-level discount. */
  cartDiscount: number;
  /** netAfterLineDiscount - cartDiscount: the base tax is charged on. */
  taxable: number;
  tax: number;
  /** taxable + tax. */
  total: number;
}

export interface PricedCart {
  lines: PricedLine[];
  /**
   * Sum of line gross, BEFORE any discount. This is what a receipt prints as
   * "Subtotal", with the discounts listed beneath it. Named explicitly so it is
   * never confused with `netSubtotal`, which is the tax-exclusive revenue the
   * server posts to the ledger.
   */
  grossSubtotal: number;
  /** Sum of each line's tax-exclusive net — the figure the server calls `subtotal`. */
  netSubtotal: number;
  lineDiscountTotal: number;
  cartDiscountTotal: number;
  /** lineDiscountTotal + cartDiscountTotal. */
  discountTotal: number;
  taxTotal: number;
  /** netSubtotal + taxTotal, summed. Never recomputed from the grand total. */
  total: number;
  /** Sum of line cost, for the gross-margin readout. */
  costTotal: number;
  /** netSubtotal - costTotal. */
  profitTotal: number;
  /** Number of lines actually priced. */
  lineCount: number;
  /** Sum of line quantities, in milli-units. */
  itemCount: QtyMilli;
}

function sumMinor(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Value of a cart-level discount, clamped so it can never exceed the net.
 * A discount larger than the sale is a data-entry mistake, not a payout.
 */
export function cartDiscountAmount(netTotal: number, discount: CartDiscount): number {
  if (discount.type === 'NONE') return 0;
  if (discount.type === 'PERCENT') return Math.min(netTotal, Math.max(0, Math.round((netTotal * discount.value) / 10_000)));
  return Math.min(netTotal, Math.max(0, discount.value));
}

/**
 * Price a cart. Pure: same input, same output, no side effects, no clock.
 *
 * Lines with a non-positive quantity are dropped rather than priced at zero —
 * a zero-quantity line would otherwise absorb a share of the cart discount and
 * silently shift the total away from the lines the customer actually bought.
 */
export function priceCart(lines: CartLineInput[], discount: CartDiscount = NO_DISCOUNT): PricedCart {
  const usable = lines.filter((line) => line.qtyMilli > 0 && line.unitPrice >= 0);

  const staged: PricedLine[] = usable.map((line) => {
    const gross = lineValue(line.qtyMilli, line.unitPrice);
    const appliedLineDiscount = lineDiscount(gross, line.discountType, line.discountValue);
    const net = gross - appliedLineDiscount;
    return {
      ...line,
      gross,
      lineDiscount: appliedLineDiscount,
      netAfterLineDiscount: net,
      cartDiscount: 0,
      taxable: net,
      lineSubtotal: net,
      lineCost: lineValue(line.qtyMilli, line.costPrice),
      tax: 0,
      total: net,
    };
  });

  const grossSubtotal = sumMinor(staged.map((l) => l.gross));
  const lineDiscountTotal = sumMinor(staged.map((l) => l.lineDiscount));
  const netTotal = Math.max(0, grossSubtotal - lineDiscountTotal);

  const cartDiscountTotal = cartDiscountAmount(netTotal, discount);

  // Allocate proportionally to each line's post-line-discount value. `allocate`
  // is largest-remainder, so the parts sum to EXACTLY cartDiscountTotal and no
  // penny is invented or destroyed by the split.
  const shares = allocate(
    cartDiscountTotal,
    staged.map((l) => l.netAfterLineDiscount),
  );

  const priced = staged.map<PricedLine>((line, index) => {
    const share = shares[index] ?? 0;
    const taxable = Math.max(0, line.netAfterLineDiscount - share);
    // taxRate arrives in basis points, so convert to the percent percentOf wants.
    const tax = line.taxRate > 0 ? Math.max(0, percentOf(taxable, line.taxRate / 100)) : 0;
    return {
      ...line,
      cartDiscount: share,
      taxable,
      lineSubtotal: taxable,
      tax,
      total: taxable + tax,
    };
  });

  const netSubtotal = sumMinor(priced.map((l) => l.lineSubtotal));
  const costTotal = sumMinor(priced.map((l) => l.lineCost));

  return {
    lines: priced,
    grossSubtotal,
    netSubtotal,
    lineDiscountTotal,
    cartDiscountTotal,
    discountTotal: lineDiscountTotal + cartDiscountTotal,
    taxTotal: sumMinor(priced.map((l) => l.tax)),
    total: sumMinor(priced.map((l) => l.total)),
    costTotal,
    profitTotal: netSubtotal - costTotal,
    lineCount: priced.length,
    itemCount: priced.reduce<QtyMilli>((acc, l) => acc + l.qtyMilli, 0),
  };
}

/**
 * Self-check for the arithmetic above. Returns a list of violations; an empty
 * list means the cart is internally consistent. Kept here (not in a test file)
 * because it is the same invariant the server must hold, and it costs nothing
 * to assert it in development.
 */
export function assertPricedCart(cart: PricedCart): string[] {
  const problems: string[] = [];
  const netTotal = sumMinor(cart.lines.map((l) => l.gross - l.lineDiscount));
  const allocatedCart = sumMinor(cart.lines.map((l) => l.cartDiscount));
  const allocatedTax = sumMinor(cart.lines.map((l) => l.tax));
  const allocatedTotal = sumMinor(cart.lines.map((l) => l.total));

  if (allocatedCart !== cart.cartDiscountTotal) {
    problems.push(`cart discount split ${allocatedCart} != ${cart.cartDiscountTotal}`);
  }
  if (cart.discountTotal !== cart.lineDiscountTotal + cart.cartDiscountTotal) {
    problems.push('discountTotal is not lineDiscountTotal + cartDiscountTotal');
  }
  if (cart.cartDiscountTotal > Math.max(0, netTotal)) {
    problems.push('cart discount exceeds the net it is discounting');
  }
  if (allocatedTax !== cart.taxTotal) problems.push(`tax split ${allocatedTax} != ${cart.taxTotal}`);
  if (allocatedTotal !== cart.total) problems.push(`total split ${allocatedTotal} != ${cart.total}`);
  if (netTotal - cart.cartDiscountTotal + cart.taxTotal !== cart.total) {
    problems.push('total is not (net - cart discount) + tax');
  }
  for (const line of cart.lines) {
    if (!Number.isSafeInteger(line.total)) problems.push(`line ${line.lineId} total is not an integer`);
    if (line.taxable < 0) problems.push(`line ${line.lineId} has a negative taxable base`);
    if (line.cartDiscount > line.netAfterLineDiscount) {
      problems.push(`line ${line.lineId} was discounted below zero`);
    }
  }
  return problems;
}

/** Payment remainder helpers — split tender needs exact integer arithmetic. */
export const tender = {
  paid: (payments: { amount: number }[]): number => sumMinor(payments.map((p) => p.amount)),
  remaining: (total: number, payments: { amount: number }[]): number => total - sumMinor(payments.map((p) => p.amount)),
  change: (total: number, payments: { amount: number }[]): number => Math.max(0, sumMinor(payments.map((p) => p.amount)) - total),
};
