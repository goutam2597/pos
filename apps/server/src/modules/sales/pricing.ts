import {
  allocate,
  lineValue,
  lineDiscount,
  percentOf,
  type QtyMilli,
} from '@monopos/shared';
import { AppError } from '../../lib/errors.js';

/**
 * Cart pricing.
 *
 * Deliberately a pure function of its inputs: no database, no clock, no
 * randomness. Every rule about how a cart adds up lives here, which makes the
 * money maths directly unit-testable and keeps the service layer concerned only
 * with persistence and posting.
 *
 * ORDER OF OPERATIONS matters and is the usual source of wrong invoices:
 *
 *   1. gross        = unit price x quantity
 *   2. line discount applied to gross
 *   3. cart discount allocated across lines, proportional to post-line-discount
 *      gross — so a discount never lands disproportionately on one line
 *   4. taxable base = gross - line discount - allocated cart discount
 *   5. tax computed per line on that base at that line's own rate
 *   6. total        = taxable base + tax
 *
 * Tax is computed per line rather than on the invoice total, because different
 * lines may carry different rates and because only that way can the tax on the
 * invoice be itemised for a tax authority.
 */

export interface PricingLineInput {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  unitName: string | null;
  qtyMilli: QtyMilli;
  unitPrice: number;
  discountType: 'NONE' | 'PERCENT' | 'FIXED';
  discountValue: number;
  taxId: string | null;
  taxRate: number;
  /** Price already includes tax (inclusive pricing). */
  taxInclusive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  allowNegativeStock: boolean;
  costPrice: number;
  warehouseId: string | null;
  position: number;
  note?: string | null;
}

export interface PricedLine extends PricingLineInput {
  gross: number;
  lineDiscountAmount: number;
  allocatedDiscount: number;
  taxableBase: number;
  taxAmount: number;
  lineSubtotal: number;
  lineTotal: number;
  lineCost: number;
  profit: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  costTotal: number;
  profitTotal: number;
  itemCount: number;
  totalQtyMilli: QtyMilli;
}

export interface PriceCartInput {
  lines: PricingLineInput[];
  /** Order-level discount in minor units, allocated across the lines. */
  cartDiscount?: number;
  /**
   * Cash rounding adjustment applied to the grand total. Kept explicit and
   * outside the line maths so a receipt can show exactly what was rounded.
   */
  rounding?: number;
  /**
   * Prices already include tax. When false, tax is added on top of the price.
   */
  pricesIncludeTax?: boolean;
}

/**
 * Price a cart.
 *
 * Rounding policy: every line's tax is rounded to the nearest minor unit, and
 * the invoice total is the exact sum of those rounded lines. No "adjust the
 * last line to make it tie" fudge — the sum of the printed lines is always the
 * printed total, which is what a tax authority reconciles against.
 */
export function priceCart(input: PriceCartInput): PricedCart {
  const { lines, cartDiscount = 0, pricesIncludeTax = false } = input;

  if (lines.length === 0) {
    throw new AppError('UNPROCESSABLE', 'Cannot price an empty cart');
  }

  for (const line of lines) {
    if (line.qtyMilli <= 0) {
      throw new AppError('UNPROCESSABLE', `Quantity for "${line.name}" must be greater than zero`);
    }
    if (!Number.isSafeInteger(line.qtyMilli)) {
      throw new AppError('UNPROCESSABLE', `Quantity for "${line.name}" is not a valid amount`);
    }
    if (unitPriceIsInvalid(line.unitPrice)) {
      throw new AppError('UNPROCESSABLE', `Price for "${line.name}" is not a valid amount`);
    }
  }

  // Step 1-2: gross and line-level discount.
  const partial: Array<PricingLineInput & { gross: number; lineDiscountAmount: number }> = lines.map(
    (line) => {
      const gross = lineValue(line.qtyMilli, line.unitPrice);
      return {
        ...line,
        gross,
        lineDiscountAmount: lineDiscount(gross, line.discountType, line.discountValue),
      };
    },
  );

  // Step 3: allocate the cart discount across lines, weighted by net gross.
  const netGross = partial.map((l) => Math.max(0, l.gross - l.lineDiscountAmount));
  const discountToAllocate = Math.min(Math.max(0, cartDiscount), netGross.reduce((a, b) => a + b, 0));
  const allocations = allocate(discountToAllocate, netGross);

  // Steps 4-6: tax and totals.
  const priced: PricedLine[] = partial.map((line, index) => {
    const allocatedDiscount = allocations[index] ?? 0;
    const afterDiscount = Math.max(0, line.gross - line.lineDiscountAmount - allocatedDiscount);

    // Inclusive pricing: the shelf price already contains the tax, so it is
    // extracted from the price rather than added to it.
    let lineSubtotal = afterDiscount;
    let taxAmount = 0;

    if (line.taxInclusive || pricesIncludeTax) {
      if (line.taxRate > 0) {
        // gross = net + tax, and tax = net * rate  =>  net = gross / (1 + rate)
        taxAmount = Math.round(afterDiscount - afterDiscount / (1 + line.taxRate / 10_000));
        lineSubtotal = afterDiscount - taxAmount;
      }
    } else if (line.taxRate > 0) {
      lineSubtotal = afterDiscount;
      taxAmount = percentOf(afterDiscount, line.taxRate / 100);
    }

    const lineTotal = lineSubtotal + taxAmount;
    const lineCost = lineValue(line.qtyMilli, line.costPrice);

    return {
      ...line,
      allocatedDiscount,
      taxableBase: lineSubtotal,
      taxAmount,
      lineSubtotal,
      lineTotal,
      lineCost,
      profit: lineSubtotal - lineCost,
    };
  });

  const subtotal = priced.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const taxTotal = priced.reduce((sum, l) => sum + l.taxAmount, 0);
  const costTotal = priced.reduce((sum, l) => sum + l.lineCost, 0);

  return {
    lines: priced,
    subtotal,
    discountTotal: priced.reduce((sum, l) => sum + l.lineDiscountAmount + l.allocatedDiscount, 0),
    taxTotal,
    total: subtotal + taxTotal + (input.rounding ?? 0),
    costTotal,
    profitTotal: subtotal - costTotal,
    itemCount: priced.length,
    totalQtyMilli: priced.reduce((sum, l) => sum + l.qtyMilli, 0),
  };
}

function unitPriceIsInvalid(price: number): boolean {
  return !Number.isSafeInteger(price) || price < 0;
}

/**
 * Cash rounding — the few pennies the cashier removes when a customer hands over
 * a note. Only ever rounds a CASH sale down to the nearest minor unit.
 */
export function cashRounding(total: number): number {
  if (total <= 0) return 0;
  return -(total % 100);
}

/**
 * Verify a payment set covers the amount due.
 *
 * Overpayment is allowed (change is given), underpayment is not — a sale cannot
 * be marked COMPLETED with money still owed unless it is explicitly recorded as
 * a credit sale.
 */
export function reconcilePayments(
  total: number,
  payments: Array<{ amount: number; method: string }>,
  allowCredit: boolean,
): { paid: number; due: number; change: number; isCredit: boolean } {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const due = total - paid;

  const hasCredit = payments.some((p) => p.method === 'CREDIT');
  const isCredit = due > 0 && allowCredit && hasCredit;

  if (due > 0 && !isCredit) {
    throw new AppError(
      'UNPROCESSABLE',
      `Payment is short by ${formatShort(due)}. Record the remainder as a credit sale, ` +
        'or adjust the cart.',
    );
  }

  return { paid, due: Math.max(0, due), change: Math.max(0, -due), isCredit };
}

function formatShort(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
