/**
 * Types shared by the POS terminal's screens and hooks.
 *
 * These are deliberately UI-shaped: the wire and storage shapes come from
 * `@monopos/shared` and `lib/db`, and this file only describes what the cashier
 * is currently looking at.
 */

import type { PaymentMethod } from '@monopos/shared';
import type { CartDiscount, DiscountType } from '../lib/offline/pricing';

export type { CartDiscount, DiscountType };

/**
 * One line in the on-screen cart.
 *
 * Structurally a superset of `CartLineInput` from the pricing module, which is
 * what lets the cart be handed to `priceCart`/`captureSale` without a mapping
 * step that could quietly drop a field. The extra members are display state
 * (`qtyOnHand`) and identity within the cart session (`lineId`).
 */
export interface CartLine {
  lineId: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string;
  unitPrice: number;
  qtyMilli: number;
  discountType: DiscountType;
  discountValue: number;
  /** Basis points, matching `Tax.rate` on the server (1000 = 10%). */
  taxRate: number;
  /** Minor units per single unit; drives the margin readout. */
  costPrice: number;
  trackInventory: boolean;
  /** Snapshot taken when the line was added, for the out-of-stock hint. */
  qtyOnHand: number;
  allowNegativeStock: boolean;
}

export interface CartState {
  lines: CartLine[];
  cartDiscount: CartDiscount;
  customerId: string | null;
  customerName: string | null;
  /** True when the customer was created on this till and has not synced yet. */
  customerPendingSync: boolean;
}

export const EMPTY_CART: CartState = {
  lines: [],
  cartDiscount: { type: 'NONE', value: 0 },
  customerId: null,
  customerName: null,
  customerPendingSync: false,
};

/** A product as the grid needs it. */
export interface ProductView {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  price: number;
  /** Minor units per single unit; drives the margin readout on the cart. */
  costPrice: number;
  categoryId: string | null;
  categoryName: string | null;
  taxRate: number;
  qtyOnHand: number;
  trackInventory: boolean;
  allowNegativeStock: boolean;
  deleted: boolean;
}

/** Tendered so far in the payment modal. */
export interface PaymentDraft {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

export type PaymentMode = 'cash' | 'card' | 'credit' | 'split';

/** Which surface currently owns the keyboard. */
export type PosFocus = 'search' | 'cart' | 'modal';

export interface ReceiptView {
  saleId: string;
  code: string | null;
  occurredAt: number;
  cashierName: string | null;
  syncState: string;
  lines: Array<{
    name: string;
    qtyMilli: number;
    unitPrice: number;
    discountType: DiscountType;
    discountValue: number;
    total: number;
  }>;
  payments: Array<{ method: PaymentMethod; amount: number; reference: string | null }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  change: number;
  note: string | null;
}

export interface ShiftSummaryView {
  openingFloat: number;
  expectedCash: number;
  countedCash: number;
  dropped: number;
  openedAt: number;
  variance: number;
}

/** Quick tender denominations offered above the keypad. */
export const QUICK_TENDER: ReadonlyArray<number | 'exact'> = ['exact', 500, 1000, 2000, 5000, 10000];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MOBILE: 'Mobile wallet',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CREDIT: 'On account',
  GIFT_CARD: 'Gift card',
  COUPON: 'Coupon',
  OTHER: 'Other',
};
