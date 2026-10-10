/**
 * Cart state for the till.
 *
 * A reducer rather than scattered `useState` calls, because the interesting
 * behaviours (merging a scanned item into an existing line, keeping a line's
 * identity across a quantity edit, replacing the whole cart when a held sale is
 * resumed) are exactly the kind that get subtly wrong when each lives in its
 * own setter.
 *
 * Every mutation is local and synchronous. Nothing in this file touches the
 * network, and nothing awaits — the cart must respond within a frame of the
 * cashier's keystroke, whether or not there is a network.
 */

import { useCallback, useMemo, useReducer } from 'react';
import { priceCart, type CartDiscount, type DiscountType, type PricedCart } from '../lib/offline/pricing';
import { EMPTY_CART, type CartLine, type CartState, type ProductView } from './types';

export type CartAction =
  | { type: 'add'; product: ProductView; qtyMilli: number }
  | { type: 'setQty'; lineId: string; qtyMilli: number }
  | { type: 'stepQty'; lineId: string; deltaMilli: number }
  | { type: 'remove'; lineId: string }
  | { type: 'setLineDiscount'; lineId: string; discountType: DiscountType; discountValue: number }
  | { type: 'setCartDiscount'; discount: CartDiscount }
  | { type: 'setCustomer'; customerId: string | null; customerName: string | null; pendingSync: boolean }
  | { type: 'replace'; cart: CartState }
  | { type: 'clear' };

function lineKey(productId: string, variantId: string | null): string {
  return `${productId}::${variantId ?? ''}`;
}

function toLine(product: ProductView): CartLine {
  return {
    lineId: lineKey(product.id, null),
    productId: product.id,
    variantId: null,
    sku: product.sku,
    name: product.name,
    imageUrl: product.imageUrl,
    unitPrice: product.price,
    qtyMilli: 0,
    discountType: 'NONE',
    discountValue: 0,
    taxRate: product.taxRate,
    costPrice: product.costPrice,
    trackInventory: product.trackInventory,
    qtyOnHand: product.qtyOnHand,
    allowNegativeStock: product.allowNegativeStock,
  };
}

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const key = lineKey(action.product.id, null);
      const existing = state.lines.find((line) => line.lineId === key);

      // Re-scanning the same barcode must increment the existing line, never
      // create a second one. Two identical lines would split a line discount
      // across both and print a receipt that does not match what was scanned.
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((line) =>
            line.lineId === key
              ? { ...line, qtyMilli: line.qtyMilli + action.qtyMilli, qtyOnHand: action.product.qtyOnHand }
              : line,
          ),
        };
      }

      const line: CartLine = { ...toLine(action.product), qtyMilli: action.qtyMilli };
      return { ...state, lines: [...state.lines, line] };
    }

    case 'setQty':
      return {
        ...state,
        lines: state.lines
          .map((line) => (line.lineId === action.lineId ? { ...line, qtyMilli: action.qtyMilli } : line))
          .filter((line) => line.qtyMilli > 0),
      };

    case 'stepQty':
      return reducer(state, {
        type: 'setQty',
        lineId: action.lineId,
        qtyMilli: (state.lines.find((l) => l.lineId === action.lineId)?.qtyMilli ?? 0) + action.deltaMilli,
      });

    case 'remove':
      return { ...state, lines: state.lines.filter((line) => line.lineId !== action.lineId) };

    case 'setLineDiscount':
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.lineId === action.lineId
            ? { ...line, discountType: action.discountType, discountValue: action.discountValue }
            : line,
        ),
      };

    case 'setCartDiscount':
      return { ...state, cartDiscount: action.discount };

    case 'setCustomer':
      return {
        ...state,
        customerId: action.customerId,
        customerName: action.customerName,
        customerPendingSync: action.pendingSync,
      };

    case 'replace':
      return action.cart;

    case 'clear':
      // The customer survives a completed sale: the next sale at the same
      // counter is usually the same customer's second item.
      return {
        ...EMPTY_CART,
        customerId: state.customerId,
        customerName: state.customerName,
        customerPendingSync: state.customerPendingSync,
      };
  }
}

export interface CartApi extends CartState {
  priced: PricedCart;
  addProduct: (product: ProductView, qtyMilli?: number) => void;
  setQty: (lineId: string, qtyMilli: number) => void;
  stepQty: (lineId: string, deltaMilli: number) => void;
  removeLine: (lineId: string) => void;
  setLineDiscount: (lineId: string, discountType: DiscountType, discountValue: number) => void;
  setCartDiscount: (discount: CartDiscount) => void;
  setCustomer: (customerId: string | null, customerName: string | null, pendingSync?: boolean) => void;
  clear: () => void;
  resume: (lines: CartLine[], cartDiscount: CartDiscount, customerId: string | null, customerName: string | null) => void;
}

export function useCart(initial: CartState = EMPTY_CART): CartApi {
  const [state, dispatch] = useReducer(reducer, initial);

  // Pricing is a pure function of the cart, so it is recomputed on every
  // keystroke rather than stored. There is no "stale total" state to get wrong.
  const priced = useMemo(() => priceCart(state.lines, state.cartDiscount), [state.lines, state.cartDiscount]);

  return {
    ...state,
    priced,
    addProduct: useCallback((product, qtyMilli = 1000) => dispatch({ type: 'add', product, qtyMilli }), []),
    setQty: useCallback((lineId, qtyMilli) => dispatch({ type: 'setQty', lineId, qtyMilli }), []),
    stepQty: useCallback((lineId, deltaMilli) => dispatch({ type: 'stepQty', lineId, deltaMilli }), []),
    removeLine: useCallback((lineId) => dispatch({ type: 'remove', lineId }), []),
    setLineDiscount: useCallback(
      (lineId, discountType, discountValue) => dispatch({ type: 'setLineDiscount', lineId, discountType, discountValue }),
      [],
    ),
    setCartDiscount: useCallback((discount: CartDiscount) => dispatch({ type: 'setCartDiscount', discount }), []),
    setCustomer: useCallback(
      (customerId, customerName, pendingSync = false) => dispatch({ type: 'setCustomer', customerId, customerName, pendingSync }),
      [],
    ),
    clear: useCallback(() => dispatch({ type: 'clear' }), []),
    resume: useCallback(
      (lines, cartDiscount, customerId, customerName) =>
        dispatch({
          type: 'replace',
          cart: { lines, cartDiscount, customerId, customerName, customerPendingSync: false },
        }),
      [],
    ),
  };
}

/** Reset a line's discount inputs — the dialog's Cancel path. */
export const NO_LINE_DISCOUNT: CartDiscount = { type: 'NONE', value: 0 };
