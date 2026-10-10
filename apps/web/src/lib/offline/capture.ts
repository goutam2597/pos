/**
 * Offline sale capture.
 *
 * THE ONE RULE: every sale goes through `captureSale`, online or off, and every
 * call writes the sale row and its outbox row in a SINGLE Dexie transaction.
 *
 * That is worth stating plainly because the obvious alternative — "post the sale
 * when online, queue it when offline" — is how a POS loses money. It has two
 * code paths, and the moment reality disagrees with the branch the operator
 * thought they were in (the connection drops mid-request, the laptop lid closes
 * during `fetch`, the server returns 500 after committing), the sale exists in
 * one place only or in neither. A single path that always writes locally first
 * makes that class of bug unrepresentable: the network becomes a detail of how
 * fast the receipt number arrives, not a precondition for taking the money.
 *
 * `captureSale` therefore returns as soon as IndexedDB has committed. The
 * receipt is instant whether the server is reachable, slow, or gone. If we are
 * online the engine is nudged to drain, so the customer usually sees a real
 * invoice number before they leave the counter.
 */

import type { PaymentMethod } from '@monopos/shared';
import { db, getMeta, setMeta, type CachedParty, type LocalHold, type LocalSale } from '../db';
import { mintClientTxnId } from './outbox';
import { notifySyncEnqueued } from './syncEngine';
import { priceCart, tender, type CartDiscount, type CartLineInput, type PricedCart } from './pricing';

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export interface CaptureContext {
  branchId: string;
  registerId: string | null;
  customerId: string | null;
  shiftId: string | null;
  cashierName: string | null;
}

export interface CaptureInput {
  lines: CartLineInput[];
  payments: SalePaymentInput[];
  cartDiscount: CartDiscount;
  allowCredit: boolean;
  note?: string | null;
}

/** Wire shape of the `SALE_CREATE` payload; mirrors `POST /sales` exactly. */
export interface SaleCreatePayload {
  branchId: string;
  registerId: string | null;
  customerId: string | null;
  shiftId: string | null;
  clientTxnId: string;
  capturedAt: number;
  allowCredit: boolean;
  /** Cart-level discount AMOUNT in minor units — the server schema wants a
   * number here, not the picker state the cart carries. */
  cartDiscount: number;
  lines: Array<{
    productId: string;
    variantId: string | null;
    qtyMilli: number;
    unitPrice: number;
    discountType: string;
    discountValue: number;
    name: string;
  }>;
  payments: Array<{ method: PaymentMethod; amount: number; reference: string | null }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export interface CaptureResult {
  sale: LocalSale;
  priced: PricedCart;
}

/**
 * Take the money.
 *
 * Throws only on genuinely unusable input (empty cart, no branch, a cash drawer
 * that has not been balanced). It never throws because the network is down —
 * that is the normal case this whole module exists for.
 */
export async function captureSale(input: CaptureInput, context: CaptureContext): Promise<CaptureResult> {
  if (!context.branchId) throw new Error('Cannot capture a sale without a branch');

  const priced = priceCart(input.lines, input.cartDiscount);
  if (priced.lineCount === 0) throw new Error('Cannot capture an empty sale');

  const payments = input.payments.filter((p) => p.amount !== 0);
  if (payments.length === 0) throw new Error('Cannot capture a sale with no payment');
  assertPaid(priced.total, payments, input.allowCredit);

  const clientTxnId = mintClientTxnId();
  const capturedAt = Date.now();

  const payload: SaleCreatePayload = {
    branchId: context.branchId,
    registerId: context.registerId,
    customerId: context.customerId,
    shiftId: context.shiftId,
    clientTxnId,
    capturedAt,
    allowCredit: input.allowCredit,
    // The wire format wants the discount AMOUNT in minor units, not the
    // picker state ({type, value}) — sending the picker object made the
    // server reject every till sale as an invalid payload.
    cartDiscount: priced.cartDiscountTotal,
    lines: priced.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      qtyMilli: line.qtyMilli,
      unitPrice: line.unitPrice,
      discountType: line.discountType,
      discountValue: line.discountValue,
      name: line.name,
    })),
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
    subtotal: priced.grossSubtotal,
    discountTotal: priced.discountTotal,
    taxTotal: priced.taxTotal,
    total: priced.total,
  };

  const sale: LocalSale = {
    clientTxnId,
    branchId: context.branchId,
    registerId: context.registerId,
    total: priced.total,
    subtotal: priced.grossSubtotal,
    taxTotal: priced.taxTotal,
    discountTotal: priced.discountTotal,
    lineCount: priced.lineCount,
    occurredAt: capturedAt,
    cashierName: context.cashierName,
    state: 'pending',
    serverCode: null,
    paymentsJson: JSON.stringify(payload.payments),
    linesJson: JSON.stringify(payload.lines),
    note: input.note ?? null,
  };

  const entry = {
    clientTxnId,
    type: 'SALE_CREATE' as const,
    payload,
    capturedAt,
    branchId: context.branchId,
    registerId: context.registerId,
    state: 'pending' as const,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    serverRef: null,
    syncedAt: null,
  };

  // One transaction: the sale and its outbox row commit together or not at all,
  // so there is no window in which a sale exists with nothing to send it.
  await db.transaction('rw', [db.sales, db.outbox, db.products], async () => {
    await db.sales.add(sale);
    await db.outbox.add(entry);
    await applyLocalStockMovement(priced);
  });

  // The drawer follows from the sales table at close-out, never from a running
  // counter that a missed increment could silently corrupt.
  notifySyncEnqueued();
  return { sale, priced };
}

function assertPaid(total: number, payments: SalePaymentInput[], allowCredit: boolean): void {
  const paid = tender.paid(payments);
  if (paid >= total) return;
  if (allowCredit && payments.some((p) => p.method === 'CREDIT')) return;
  throw new Error(`Sale is underpaid by ${total - paid} minor units`);
}

/**
 * Move local stock immediately so the next scan reflects the sale.
 *
 * `updatedAt` is deliberately NOT touched. These rows are otherwise server
 * projections, and stamping them with the client clock would make this till win
 * every future conflict against the authoritative server record — which would
 * mean never noticing that another till sold the same units. Leaving the stamp
 * alone keeps the next server delta authoritative and lets `mergeProductDelta`
 * recognise the collision.
 */
async function applyLocalStockMovement(priced: PricedCart): Promise<void> {
  for (const line of priced.lines) {
    if (!line.trackInventory) continue;
    const product = await db.products.get(line.productId);
    if (!product) continue;
    await db.products.update(line.productId, { qtyOnHand: product.qtyOnHand - line.qtyMilli });
  }
}

// ---------------------------------------------------------------------------
// Holds — parked carts
// ---------------------------------------------------------------------------

export interface HoldableCart {
  lines: CartLineInput[];
  cartDiscount: CartDiscount;
  customerId: string | null;
}

export interface ParkedCartSummary {
  hold: LocalHold;
  lines: CartLineInput[];
  cartDiscount: CartDiscount;
  customerId: string | null;
}

/**
 * Park the current cart. Writes `db.holds` and a `HOLD_CREATE` outbox row in
 * one transaction, so a parked sale cannot be lost either.
 */
export async function parkCart(
  cart: HoldableCart,
  label: string,
  context: { branchId: string; registerId: string | null },
): Promise<LocalHold> {
  const clientTxnId = mintClientTxnId();
  const createdAt = Date.now();
  const hold: LocalHold = {
    clientTxnId,
    branchId: context.branchId,
    label: label.trim() || `Hold ${new Date(createdAt).toLocaleTimeString()}`,
    payloadJson: JSON.stringify(cart),
    createdAt,
    state: 'pending',
  };

  await db.transaction('rw', [db.holds, db.outbox], async () => {
    await db.holds.add(hold);
    await db.outbox.add({
      clientTxnId,
      type: 'HOLD_CREATE',
      // The server's schema: {branchId, label, payload: <the parked cart>}.
      payload: {
        branchId: context.branchId,
        label: hold.label.slice(0, 100),
        payload: cart,
      },
      capturedAt: createdAt,
      branchId: context.branchId,
      registerId: context.registerId,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      serverRef: null,
      syncedAt: null,
    });
  });

  notifySyncEnqueued();
  return hold;
}

export async function listHolds(branchId: string): Promise<LocalHold[]> {
  const holds = await db.holds.where('branchId').equals(branchId).toArray();
  return holds.sort((a, b) => b.createdAt - a.createdAt);
}

export function readHold(hold: LocalHold): ParkedCartSummary | null {
  try {
    const parsed = JSON.parse(hold.payloadJson) as HoldableCart;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return {
      hold,
      lines: parsed.lines,
      cartDiscount: parsed.cartDiscount ?? { type: 'NONE', value: 0 },
      customerId: parsed.customerId ?? null,
    };
  } catch {
    return null;
  }
}

export async function releaseHold(hold: LocalHold, context: { branchId: string; registerId: string | null }): Promise<void> {
  const release = {
    clientTxnId: mintClientTxnId(),
    type: 'HOLD_RELEASE' as const,
    // The server resolves the parked cart by the CREATE's clientTxnId.
    payload: {
      holdId: hold.clientTxnId,
    },
    capturedAt: Date.now(),
    branchId: context.branchId,
    registerId: context.registerId,
    state: 'pending' as const,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    serverRef: null,
    syncedAt: null,
  };

  await db.transaction('rw', [db.holds, db.outbox], async () => {
    await db.holds.delete(hold.clientTxnId);
    await db.outbox.add(release);
  });

  notifySyncEnqueued();
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface QuickCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  tier?: string;
}

/**
 * Create a customer at the counter.
 *
 * The local row is keyed by a client id (`pos-<clientTxnId>`) rather than a made
 * up UUID, because the server assigns the real id and `applyLocalIdMigration`
 * in the sync engine rewrites the key once it arrives. Until then the row is a
 * genuine offline-capable record, not a placeholder.
 */
export async function createQuickCustomer(
  input: QuickCustomerInput,
  context: { branchId: string; registerId: string | null },
): Promise<{ customer: CachedParty; clientTxnId: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('A customer needs a name');

  const clientTxnId = mintClientTxnId();
  const localId = `pos-${clientTxnId}`;
  const now = Date.now();

  const customer: CachedParty = {
    id: localId,
    name,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    tier: input.tier ?? 'RETAIL',
    updatedAt: now,
  };

  await db.transaction('rw', [db.customers, db.outbox], async () => {
    await db.customers.add(customer);
    await db.outbox.add({
      clientTxnId,
      type: 'CUSTOMER_CREATE',
      payload: {
        clientTxnId,
        localId,
        branchId: context.branchId,
        registerId: context.registerId,
        capturedAt: now,
        name,
        phone: customer.phone,
        email: customer.email,
        tier: customer.tier,
      },
      capturedAt: now,
      branchId: context.branchId,
      registerId: context.registerId,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      serverRef: null,
      syncedAt: null,
    });
  });

  notifySyncEnqueued();
  return { customer, clientTxnId };
}

/**
 * Adopt the server's id for an offline-created record.
 *
 * @deprecated Re-exported for convenience; the implementation lives in
 * `migrations.ts` so the sync engine does not have to import this module.
 */
export { applyLocalIdMigration } from './migrations';

// ---------------------------------------------------------------------------
// Post-sale corrections
// ---------------------------------------------------------------------------

export async function voidSale(
  clientTxnId: string,
  reason: string,
  context: { branchId: string; registerId: string | null },
): Promise<void> {
  await enqueueCorrection('SALE_VOID', clientTxnId, { reason }, context);
}

export async function refundSale(
  clientTxnId: string,
  amount: number,
  method: PaymentMethod,
  reason: string,
  context: { branchId: string; registerId: string | null },
): Promise<void> {
  await enqueueCorrection('SALE_REFUND', clientTxnId, { amount, method, reason }, context);
}

async function enqueueCorrection(
  type: 'SALE_VOID' | 'SALE_REFUND',
  saleClientTxnId: string,
  extra: Record<string, unknown>,
  context: { branchId: string; registerId: string | null },
): Promise<void> {
  const clientTxnId = mintClientTxnId();
  await db.outbox.add({
    clientTxnId,
    type,
    payload: {
      clientTxnId,
      saleClientTxnId,
      branchId: context.branchId,
      registerId: context.registerId,
      capturedAt: Date.now(),
      ...extra,
    },
    capturedAt: Date.now(),
    branchId: context.branchId,
    registerId: context.registerId,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    serverRef: null,
    syncedAt: null,
  });
  notifySyncEnqueued();
}

// ---------------------------------------------------------------------------
// Shift — cash drawer accounting
// ---------------------------------------------------------------------------

export interface ShiftState {
  /** Client-minted id for the shift; the server correlates on it. */
  clientId: string;
  branchId: string;
  registerId: string | null;
  openedAt: number;
  openingFloat: number;
  dropped: number;
  closedAt: number | null;
}

const SHIFT_KEY = 'pos.shift';

export async function loadShift(): Promise<ShiftState | null> {
  return getMeta<ShiftState | null>(SHIFT_KEY, null);
}

/**
 * Open the drawer with a counted float.
 *
 * The count is an auditable event, not a UI detail: it goes out as
 * `REGISTER_CASH_COUNT` so the server's shift ledger opens with the same number
 * the cashier is looking at, even if the network is down at the time.
 */
export async function openShift(
  openingFloat: number,
  context: { branchId: string; registerId: string | null; cashierName: string | null },
): Promise<ShiftState> {
  // The server's shift ledger keys every cash event to a register; without one
  // the shift's events would enqueue into a permanently doomed state.
  if (!context.registerId) throw new Error('Select a register before opening the shift');
  const now = Date.now();
  const clientId = mintClientTxnId();
  const shift: ShiftState = {
    clientId,
    branchId: context.branchId,
    registerId: context.registerId,
    openedAt: now,
    openingFloat,
    dropped: 0,
    closedAt: null,
  };

  await db.transaction('rw', [db.meta, db.outbox], async () => {
    await setMeta(SHIFT_KEY, shift);
    await db.outbox.add({
      clientTxnId: mintClientTxnId(),
      type: 'REGISTER_CASH_COUNT',
      payload: {
        branchId: context.branchId,
        registerId: context.registerId,
        // The shift is born offline with a client-minted id; the server adopts
        // that id as the Shift's primary key so every later sale that cites it
        // resolves. `type`/`amount` are the server's vocabulary, not ours.
        shiftId: clientId,
        type: 'FLOAT',
        amount: openingFloat,
        capturedAt: now,
      },
      capturedAt: now,
      branchId: context.branchId,
      registerId: context.registerId,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      serverRef: null,
      syncedAt: null,
    });
  });

  notifySyncEnqueued();
  return shift;
}

/** Pay cash out of the drawer mid-shift (petty cash, bank run). */
export async function recordCashDrop(
  amount: number,
  reason: string,
  context: { branchId: string; registerId: string | null },
): Promise<ShiftState> {
  const shift = await loadShift();
  if (!shift) throw new Error('Open the shift before dropping cash');
  const now = Date.now();
  const next: ShiftState = { ...shift, dropped: shift.dropped + Math.max(0, amount) };

  await db.transaction('rw', [db.meta, db.outbox], async () => {
    await setMeta(SHIFT_KEY, next);
    await db.outbox.add({
      clientTxnId: mintClientTxnId(),
      type: 'REGISTER_CASH_DROP',
      payload: {
        branchId: context.branchId,
        registerId: shift.registerId ?? context.registerId,
        shiftId: shift.clientId,
        type: 'DROP',
        amount: Math.max(0, amount),
        reason,
        capturedAt: now,
      },
      capturedAt: now,
      branchId: context.branchId,
      registerId: context.registerId,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      serverRef: null,
      syncedAt: null,
    });
  });

  notifySyncEnqueued();
  return next;
}

/**
 * Cash physically in the drawer, as this till understands it:
 * opening float + cash taken this shift - cash paid out. Counted from the LOCAL
 * sales table, so it is correct even when nothing has synced — which is exactly
 * when the cashier needs the number.
 */
export async function expectedCash(shift: ShiftState): Promise<number> {
  const sales = await db.sales
    .where('branchId')
    .equals(shift.branchId)
    .filter((sale) => sale.occurredAt >= shift.openedAt && sale.state !== 'failed')
    .toArray();

  let total = shift.openingFloat;
  for (const sale of sales) {
    for (const payment of parsePayments(sale.paymentsJson)) {
      if (payment.method === 'CASH') total += payment.amount;
    }
  }
  return total - shift.dropped;
}

export interface ShiftCloseSummary {
  shift: ShiftState;
  expected: number;
  counted: number;
  variance: number;
}

export async function closeShift(
  counted: number,
  context: { branchId: string; registerId: string | null; cashierName: string | null },
): Promise<ShiftCloseSummary> {
  const shift = await loadShift();
  if (!shift) throw new Error('No open shift to close');

  const expected = await expectedCash(shift);
  const variance = counted - expected;
  const now = Date.now();
  const closed: ShiftState = { ...shift, closedAt: now };

  await db.transaction('rw', [db.meta, db.outbox], async () => {
    await setMeta(SHIFT_KEY, closed);
    await db.outbox.add({
      clientTxnId: mintClientTxnId(),
      type: 'REGISTER_CASH_COUNT',
      payload: {
        branchId: context.branchId,
        registerId: shift.registerId ?? context.registerId,
        shiftId: shift.clientId,
        type: 'COUNT_IN',
        amount: counted,
        reason: variance === 0 ? 'Shift close — counted exact' : `Shift close — variance ${variance}`,
        capturedAt: now,
      },
      capturedAt: now,
      branchId: context.branchId,
      registerId: context.registerId,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      serverRef: null,
      syncedAt: null,
    });
  });

  notifySyncEnqueued();
  return { shift: closed, expected, counted, variance };
}

export function parsePayments(json: string): SalePaymentInput[] {
  try {
    const parsed = JSON.parse(json) as SalePaymentInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearShift(): Promise<void> {
  await setMeta(SHIFT_KEY, null);
}
