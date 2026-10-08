/**
 * Integer quantity math, mirroring the rules in `money.ts`.
 *
 * Quantities are stored as MILLI-units (1.5 kg -> 1500) so that fractional
 * stock is exact and never drifts through repeated addition and subtraction.
 * Floating point is never used for stock on hand.
 */

/** A quantity in milli-units. Always an integer. */
export type QtyMilli = number;

export const MILLI = 1000;

export function toQtyMilli(value: number | string): QtyMilli {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    throw new RangeError(`toQtyMilli: not a valid quantity (${value})`);
  }
  if (Number.isInteger(numeric)) return numeric;
  // Two-step scaling keeps 0.1 + 0.2 === 0.3 after conversion, which a single
  // `value * 1000` would not: 0.1 * 1000 === 100.00000000000001.
  return Math.round(numeric * MILLI);
}

export function toQtyMajor(qtyMilli: QtyMilli): number {
  assertQty(qtyMilli);
  return qtyMilli / MILLI;
}

export function formatQty(qtyMilli: QtyMilli, maxDecimals = 3): string {
  assertQty(qtyMilli);
  const negative = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  const whole = Math.floor(abs / MILLI);
  const frac = abs % MILLI;
  if (frac === 0) return `${negative ? '-' : ''}${whole}`;
  const fracStr = String(frac).padStart(3, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return fracStr ? `${negative ? '-' : ''}${whole}.${fracStr}` : `${negative ? '-' : ''}${whole}`;
}

export function assertQty(value: number, where = 'quantity'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${where}: expected a safe integer of milli-units, got ${value}`);
  }
}

/**
 * Value of `qtyMilli` units at `unitPrice` minor units per single unit.
 * Rounds half away from zero so a 2.5 x 1.99 line bills as 4.98, not 4.97.
 */
export function lineValue(qtyMilli: QtyMilli, unitPrice: number): number {
  assertQty(qtyMilli, 'lineValue.qtyMilli');
  const scaled = qtyMilli * unitPrice;
  const quotient = Math.trunc(scaled / MILLI);
  const remainder = Math.abs(scaled % MILLI);
  const rounded = remainder * 2 >= MILLI ? quotient + Math.sign(scaled || 1) : quotient;
  return rounded;
}

export function addQty(...values: QtyMilli[]): QtyMilli {
  return values.reduce((a, b) => a + b, 0);
}

export function subQty(a: QtyMilli, b: QtyMilli): QtyMilli {
  return a - b;
}

export function isNegative(qtyMilli: QtyMilli): boolean {
  return qtyMilli < 0;
}

export function clampQtyZero(qtyMilli: QtyMilli): QtyMilli {
  return qtyMilli < 0 ? 0 : qtyMilli;
}

/**
 * Apply a discount to a line.
 *
 * `PERCENT` discounts are expressed in basis points of the gross, `FIXED`
 * discounts in whole minor units. The result is clamped at zero so a discount
 * can never turn a line into a payable.
 */
export function lineDiscount(
  gross: number,
  type: 'NONE' | 'PERCENT' | 'FIXED',
  value: number,
): number {
  if (type === 'PERCENT') {
    const discount = Math.round((gross * value) / 10_000);
    return Math.min(gross, Math.max(0, discount));
  }
  if (type === 'FIXED') {
    return Math.min(gross, Math.max(0, value));
  }
  return 0;
}
