import type { Tx } from '../../db/client.js';
import { prisma, transaction } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { context, assertBranchAccess } from '../../lib/context.js';
import { nextNumber } from '../../lib/numbering.js';
import { audit } from '../../lib/audit.js';
import { applyMove, checkAvailability, costForItems } from '../inventory/stock.js';
import {
  ACCOUNT_CODES,
  accountIdFor,
  postJournal,
  resolveSystemAccounts,
} from '../accounting/ledger.js';
import { priceCart, reconcilePayments, cashRounding, type PricingLineInput } from './pricing.js';
import type { PaymentMethod, SaleChannel } from '../../generated/prisma/enums.js';
import type { QtyMilli } from '@monopos/shared';

/**
 * The sale.
 *
 * This is where the modules stop being separate. Ringing up one basket produces,
 * inside a SINGLE database transaction:
 *
 *     Sale  ->  SaleItem[]  ->  Invoice  ->  Payment[]
 *          ->  StockMove[] (stock down)
 *          ->  JournalEntry: revenue + tax + receivable/cash
 *          ->  JournalEntry: COGS + inventory
 *
 * Either all of that exists or none of it does. A crash halfway through cannot
 * leave a customer charged for goods that were never deducted, or stock
 * decremented with no revenue recorded — the two failure modes that turn a
 * usable POS into a business you cannot trust at month end.
 *
 * OFFLINE REPLAY. `clientTxnId` makes the whole thing idempotent. An offline
 * terminal mints that id before its first push attempt and reuses it on every
 * retry, so a flaky connection that delivers the same sale three times produces
 * exactly one sale, one invoice, one set of stock movements and one revenue
 * entry — with the retries reported back as `duplicate`.
 */

export interface SaleLineInput {
  productId: string;
  variantId?: string | null;
  qtyMilli: QtyMilli;
  unitPrice?: number;
  discountType?: 'NONE' | 'PERCENT' | 'FIXED';
  /** Basis points when PERCENT, minor units when FIXED. */
  discountValue?: number;
  taxId?: string | null;
  warehouseId?: string | null;
  note?: string | null;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  cardLast4?: string | null;
  approvalCode?: string | null;
  /** Minted by an offline till; guarantees the payment is not duplicated. */
  clientTxnId?: string | null;
}

export interface CreateSaleInput {
  businessId: string;
  branchId: string;
  registerId?: string | null;
  userId: string;
  customerId?: string | null;
  shiftId?: string | null;
  channel?: SaleChannel;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  /** Order-level discount in minor units. */
  cartDiscount?: number;
  /** Allow the sale to complete with an outstanding balance (credit sale). */
  allowCredit?: boolean;
  note?: string | null;
  customerNote?: string | null;
  /**
   * Idempotency key. When present and already used, the existing sale is
   * returned instead of creating a second one.
   */
  clientTxnId?: string | null;
  /** Client wall-clock time of capture, preserved through offline sync. */
  capturedAt?: Date | null;
  /** True when this sale came from a disconnected terminal. */
  offline?: boolean;
}

export interface CreateSaleResult {
  saleId: string;
  saleCode: string;
  invoiceId: string | null;
  invoiceCode: string | null;
  totals: {
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    total: number;
    paid: number;
    balanceDue: number;
    costTotal: number;
    profitTotal: number;
  };
  /** True when the clientTxnId had already been applied. */
  duplicate: boolean;
}

export async function createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  const ctx = context();
  assertBranchAccess(input.branchId);

  // --- Idempotency short-circuit -----------------------------------------
  if (input.clientTxnId) {
    const existing = await prisma.sale.findUnique({
      where: {
        businessId_clientTxnId: {
          businessId: input.businessId,
          clientTxnId: input.clientTxnId,
        },
      },
      include: { invoice: { select: { id: true, code: true } } },
    });

    if (existing) {
      return {
        saleId: existing.id,
        saleCode: existing.code,
        invoiceId: existing.invoice?.id ?? null,
        invoiceCode: existing.invoice?.code ?? null,
        totals: {
          subtotal: existing.subtotal,
          discountTotal: existing.discountTotal,
          taxTotal: existing.taxTotal,
          total: existing.total,
          paid: existing.paidTotal,
          balanceDue: existing.balanceDue,
          costTotal: existing.costTotal,
          profitTotal: existing.profitTotal,
        },
        duplicate: true,
      };
    }
  }

  if (input.lines.length === 0) {
    throw new AppError('UNPROCESSABLE', 'A sale must contain at least one line');
  }
  if (input.payments.length === 0) {
    throw new AppError('UNPROCESSABLE', 'A sale must have at least one payment');
  }

  return transaction(async (tx) => {
    const result = await createSaleInTransaction(tx, input);
    return result;
  });
}

/**
 * The sale body, assuming the caller already holds a transaction.
 *
 * Exported so the offline sync path can compose it with other operations in one
 * transaction rather than nesting independent ones.
 */
export async function createSaleInTransaction(
  tx: Tx,
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  const ctx = context();
  const { businessId, branchId } = input;

  // --- Resolve the catalog -------------------------------------------------
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { businessId, id: { in: productIds } },
    include: { tax: true, unit: true, variants: { select: { id: true, price: true, costPrice: true, sku: true, name: true } } },
  });

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    throw notFound('Product', missing[0]!);
  }

  const productIndex = new Map(products.map((p) => [p.id, p]));
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { currency: true, priceIncludesTax: true, roundingMethod: true },
  });

  // --- Default warehouse ---------------------------------------------------
  // Prefer a branch-specific site, then a RETAIL one. Without the `isRetail`
  // ordering a till happily sells out of the back stockroom, which holds no
  // stock and would fail every sale with a confusing shortage.
  const defaultWarehouse = await tx.warehouse.findFirst({
    where: { businessId, isActive: true, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
    orderBy: [{ isRetail: 'desc' }, { branchId: 'desc' }, { code: 'asc' }],
    select: { id: true, branchId: true },
  });

  if (!defaultWarehouse) {
    throw new AppError('UNPROCESSABLE', 'No active warehouse is configured for this branch');
  }

  // --- Unit cost snapshot (for COGS) ---------------------------------------
  const costLookups = input.lines.map((line) => {
    const product = productIndex.get(line.productId)!;
    return {
      productId: line.productId,
      variantId: line.variantId ?? null,
      warehouseId: line.warehouseId ?? defaultWarehouse.id,
    };
  });
  const costs = await costForItems(tx, businessId, costLookups);

  // --- Price the cart ------------------------------------------------------
  const pricingLines: PricingLineInput[] = input.lines.map((line, index) => {
    const product = productIndex.get(line.productId)!;
    const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : undefined;
    const tax = line.taxId
      ? null
      : product.tax; // an explicit line tax overrides the product default

    const warehouseId = line.warehouseId ?? defaultWarehouse.id;
    const cost = costs.get(`${warehouseId}:${line.variantId ?? line.productId}`)?.cost ?? product.costPrice;

    return {
      productId: line.productId,
      variantId: line.variantId ?? null,
      name: product.name,
      sku: variant?.sku ?? product.sku,
      unitName: product.unit?.name ?? null,
      qtyMilli: line.qtyMilli,
      unitPrice: line.unitPrice ?? variant?.price ?? product.price,
      discountType: line.discountType ?? 'NONE',
      discountValue: line.discountValue ?? 0,
      taxId: tax?.id ?? null,
      taxRate: tax?.rate ?? 0,
      taxInclusive: tax?.type === 'INCLUSIVE',
      trackInventory: product.trackInventory,
      allowBackorder: product.allowBackorder,
      allowNegativeStock: product.allowNegativeStock,
      costPrice: cost,
      warehouseId,
      position: index,
      note: line.note ?? null,
    };
  });

  const isAllCash = input.payments.every((p) => p.method === 'CASH');
  // Whole-unit cash rounding is a business POLICY, not a property of cash
  // itself — applying it unconditionally turned a $0.65 cash sale into a
  // $0.00 charge. Only round when the business asked for it.
  const rounding =
    isAllCash && !business.priceIncludesTax && business.roundingMethod === 'CASH'
      ? cashRounding(
          priceCart({ lines: pricingLines, cartDiscount: input.cartDiscount, pricesIncludeTax: business.priceIncludesTax }).total,
        )
      : 0;

  const priced = priceCart({
    lines: pricingLines,
    cartDiscount: input.cartDiscount,
    rounding,
    pricesIncludeTax: business.priceIncludesTax,
  });

  // --- Payment reconciliation ---------------------------------------------
  const { paid, due } = reconcilePayments(priced.total, input.payments, input.allowCredit ?? false);

  // --- Availability check (all lines at once) ------------------------------
  const issues = await checkAvailability(
    tx,
    businessId,
    priced.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      qtyMilli: l.qtyMilli,
      warehouseId: l.warehouseId!,
      trackInventory: l.trackInventory,
      allowBackorder: l.allowBackorder,
      allowNegativeStock: l.allowNegativeStock,
      name: l.name,
      sku: l.sku,
    })),
  );

  if (issues.length > 0) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Not enough stock for ${issues.length} item(s): ` +
        issues.map((i) => `${i.name} (short ${formatQty(i.shortage)})`).join(', '),
      { details: { stock: issues.map((i) => `${i.name}: need ${formatQty(i.requested)}, have ${formatQty(i.available)}`) } },
    );
  }

  // --- Persist -------------------------------------------------------------
  // Sale codes are unique across the whole business, so they draw from ONE
  // global sequence. Per-register counters with a business-wide unique
  // constraint would collide the moment a second register started counting.
  const saleCode = await nextNumber(tx, {
    businessId,
    type: 'SALE',
  });

  const occurredAt = input.capturedAt ?? new Date();
  const channel: SaleChannel = input.offline ? 'OFFLINE' : (input.channel ?? 'POS');

  // A till's shift is born offline with a client-minted id the server has
  // never seen. Adopt it as the Shift's primary key so the sale's reference
  // resolves; without this the FK rejects the whole sale over shift metadata.
  // When the till could not even name a register, drop the linkage — the sale
  // itself must still record.
  let shiftId = input.shiftId ?? null;
  if (shiftId) {
    const shift = await tx.shift.findUnique({ where: { id: shiftId }, select: { id: true } });
    if (!shift) {
      if (input.registerId) {
        await tx.shift.create({
          data: {
            id: shiftId,
            businessId,
            branchId,
            registerId: input.registerId,
            userId: input.userId,
            openedAt: input.capturedAt ? new Date(input.capturedAt) : occurredAt,
            openingFloat: 0,
          },
          select: { id: true },
        });
      } else {
        shiftId = null;
      }
    }
  }

  const sale = await tx.sale.create({
    data: {
      businessId,
      branchId,
      registerId: input.registerId ?? null,
      shiftId,
      userId: input.userId,
      customerId: input.customerId ?? null,
      code: saleCode,
      status: due > 0 ? 'PARTIAL' : 'COMPLETED',
      channel,
      clientTxnId: input.clientTxnId ?? null,
      capturedAt: input.capturedAt ?? null,
      occurredAt,
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      roundingTotal: rounding,
      total: priced.total,
      costTotal: priced.costTotal,
      profitTotal: priced.profitTotal,
      paidTotal: paid,
      balanceDue: due,
      note: input.note ?? null,
      customerNote: input.customerNote ?? null,
      items: {
        create: priced.lines.map((line) => ({
          businessId,
          productId: line.productId,
          variantId: line.variantId,
          productName: line.name,
          variantName: null,
          sku: line.sku,
          unitName: line.unitName,
          qtyMilli: line.qtyMilli,
          unitPrice: line.unitPrice,
          discountType: line.discountType,
          discountValue: line.discountValue,
          discountAmount: line.lineDiscountAmount,
          allocatedDiscount: line.allocatedDiscount,
          taxId: line.taxId,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineSubtotal: line.lineSubtotal,
          lineTax: line.taxAmount,
          lineTotal: line.lineTotal,
          unitCost: line.costPrice,
          lineCost: line.lineCost,
          warehouseId: line.warehouseId,
          position: line.position,
          note: line.note,
        })),
      },
    },
    select: { id: true, code: true },
  });

  // --- Stock movements ------------------------------------------------------
  for (const line of priced.lines) {
    if (!line.trackInventory) continue;
    await applyMove(tx, {
      businessId,
      warehouseId: line.warehouseId!,
      branchId,
      productId: line.productId,
      variantId: line.variantId,
      type: 'SALE',
      qtyMilli: -line.qtyMilli,
      unitCost: line.costPrice,
      referenceType: 'SALE',
      referenceId: sale.id,
      referenceNo: sale.code,
      createdById: input.userId,
    });
  }

  // --- Payments -------------------------------------------------------------
  const paymentRecords = [];
  for (const payment of input.payments) {
    const record = await tx.payment.create({
      data: {
        businessId,
        branchId,
        type: 'SALE',
        method: payment.method,
        status: 'PAID',
        direction: 'IN',
        amount: payment.amount,
        currency: business.currency,
        partyId: input.customerId ?? null,
        saleId: sale.id,
        shiftId: input.shiftId ?? null,
        userId: input.userId,
        reference: payment.reference ?? null,
        cardLast4: payment.cardLast4 ?? null,
        approvalCode: payment.approvalCode ?? null,
        clientTxnId: payment.clientTxnId ?? null,
        paidAt: occurredAt,
      },
      select: { id: true, method: true, amount: true },
    });
    paymentRecords.push(record);
  }

  // --- Invoice --------------------------------------------------------------
  // A cash/card sale gets an invoice immediately (it is the customer's receipt).
  // A credit sale is still issued, with the balance outstanding for AR tracking.
  const invoiceCode = await nextNumber(tx, { businessId, branchId, type: 'INVOICE' });
  const invoice = await tx.invoice.create({
    data: {
      businessId,
      branchId,
      code: invoiceCode,
      type: 'SALE',
      status: due > 0 ? 'PART_PAID' : 'PAID',
      saleId: sale.id,
      partyId: input.customerId ?? null,
      issueDate: occurredAt,
      dueDate: new Date(occurredAt.getTime() + 30 * 86_400_000),
      currency: business.currency,
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      roundingTotal: rounding,
      total: priced.total,
      paidTotal: paid,
      balanceDue: due,
      notes: input.customerNote ?? input.note ?? null,
    },
    select: { id: true, code: true },
  });

  await tx.payment.updateMany({
    where: { saleId: sale.id },
    data: { invoiceId: invoice.id },
  });

  // --- Accounting -----------------------------------------------------------
  await postSaleAccounting(tx, {
    businessId,
    branchId,
    saleId: sale.id,
    saleCode: sale.code,
    invoiceId: invoice.id,
    customerId: input.customerId ?? null,
    occurredAt,
    userId: input.userId,
    lines: priced.lines,
    payments: paymentRecords,
    total: priced.total,
    discountTotal: priced.discountTotal,
    taxTotal: priced.taxTotal,
    balanceDue: due,
  });

  // --- Audit ----------------------------------------------------------------
  await audit(tx, {
    action: 'CREATE',
    entityType: 'Sale',
    entityId: sale.id,
    entityCode: sale.code,
    after: {
      total: priced.total,
      lines: priced.lines.length,
      channel,
      offline: Boolean(input.offline),
    },
    deviceId: ctx.deviceId,
  });

  return {
    saleId: sale.id,
    saleCode: sale.code,
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
    totals: {
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      total: priced.total,
      paid,
      balanceDue: due,
      costTotal: priced.costTotal,
      profitTotal: priced.profitTotal,
    },
    duplicate: false,
  };
}

// ---------------------------------------------------------------------------
// Accounting for a sale
// ---------------------------------------------------------------------------

interface SaleAccountingInput {
  businessId: string;
  branchId: string;
  saleId: string;
  saleCode: string;
  invoiceId: string;
  customerId: string | null;
  occurredAt: Date;
  userId: string;
  lines: Array<{ productId: string; variantId: string | null; lineSubtotal: number; taxAmount: number; lineCost: number; taxRate: number; taxId: string | null }>;
  payments: Array<{ id: string; method: string; amount: number }>;
  total: number;
  discountTotal: number;
  taxTotal: number;
  balanceDue: number;
}

/**
 * Post the two journals every sale produces.
 *
 * REVENUE ENTRY
 *   Dr Cash / Bank / Card       gross cash taken at the till
 *   Cr Cash                     change given back (overpayment)
 *   Dr Accounts Receivable      balance still owed (credit sales only)
 *   Cr Sales Revenue            net revenue — already net of any discount
 *   Cr Tax Payable              tax collected (a liability, not income)
 *   Cr Rounding                 cash rounding adjustment, when positive
 *
 * COST ENTRY
 *   Dr Cost of Goods Sold       cost of the goods
 *   Cr Inventory                the same amount
 *
 * TWO SUBTLETIES WORTH NAMING.
 *
 * Change. If a customer hands over a fifty for a four-dollar basket, cash is
 * debited with the FULL fifty and credited again with the change. Netting the
 * two would also balance, but it would hide the cash that physically left the
 * drawer — and drawer reconciliation is the whole point of the cash account.
 *
 * Discounts. Line discounts reduce the revenue recognised; they are NOT also
 * credited to the Sales Discount account. Doing both would credit the discount
 * twice. The Sales Discount account exists for contra-revenue recorded by hand
 * (a post-hoc price correction) and is reported separately in the P&L.
 *
 * They are separate entries because they answer different questions: the first
 * is the till reconciliation, the second is the gross margin. Keeping them
 * apart is also what makes a mid-period stocktake variance land in COGS instead
 * of silently rewriting revenue.
 */
async function postSaleAccounting(tx: Tx, input: SaleAccountingInput): Promise<void> {
  const accounts = await resolveSystemAccounts(tx, input.businessId);

  const revenueAccount = await accountIdFor(accounts, ACCOUNT_CODES.SALES_REVENUE);
  const taxAccount = await accountIdFor(accounts, ACCOUNT_CODES.TAX_PAYABLE);
  const receivableAccount = await accountIdFor(accounts, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
  const cashAccount = await accountIdFor(accounts, ACCOUNT_CODES.CASH);
  const cogsAccount = await accountIdFor(accounts, ACCOUNT_CODES.COGS);
  const inventoryAccount = await accountIdFor(accounts, ACCOUNT_CODES.INVENTORY);

  const netRevenue = input.lines.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const cashReceived = input.payments.reduce((sum, p) => sum + p.amount, 0);

  // `total` is what the customer owed; anything beyond that is change.
  const changeGiven = Math.max(0, cashReceived - input.total);
  const rounding = input.total - netRevenue - input.taxTotal;

  // --- Revenue entry --------------------------------------------------------
  const revenueLines: Array<{
    account: string;
    debit?: number;
    credit?: number;
    memo?: string;
    partyId?: string | null;
  }> = [];

  if (cashReceived > 0) {
    revenueLines.push({ account: cashAccount, debit: cashReceived, memo: `Sale ${input.saleCode}` });
  }
  if (changeGiven > 0) {
    revenueLines.push({ account: cashAccount, credit: changeGiven, memo: `Change given ${input.saleCode}` });
  }
  if (input.balanceDue > 0) {
    revenueLines.push({
      account: receivableAccount,
      debit: input.balanceDue,
      partyId: input.customerId,
      memo: `Sale ${input.saleCode} on account`,
    });
  }
  if (netRevenue > 0) {
    revenueLines.push({ account: revenueAccount, credit: netRevenue, memo: `Revenue ${input.saleCode}` });
  }
  if (input.taxTotal > 0) {
    revenueLines.push({ account: taxAccount, credit: input.taxTotal, memo: `Tax ${input.saleCode}` });
  }
  // Cash rounding is a credit when rounded down (the shop keeps less), and a
  // debit when rounded up, so it always lands on the correct side.
  if (rounding > 0) {
    revenueLines.push({ account: revenueAccount, credit: rounding, memo: `Cash rounding ${input.saleCode}` });
  } else if (rounding < 0) {
    revenueLines.push({ account: revenueAccount, debit: -rounding, memo: `Cash rounding ${input.saleCode}` });
  }

  if (revenueLines.length > 0) {
    await postJournal(
      tx,
      {
        businessId: input.businessId,
        branchId: input.branchId,
        date: input.occurredAt,
        source: 'SALE',
        memo: `Sale ${input.saleCode}`,
        referenceType: 'SALE',
        referenceId: input.saleId,
        saleId: input.saleId,
        lines: revenueLines,
      },
      accounts,
    );
  }

  // --- COGS entry -----------------------------------------------------------
  const cogsTotal = input.lines.reduce((sum, l) => sum + l.lineCost, 0);
  if (cogsTotal > 0) {
    await postJournal(
      tx,
      {
        businessId: input.businessId,
        branchId: input.branchId,
        date: input.occurredAt,
        source: 'SALE',
        memo: `Cost of goods sold ${input.saleCode}`,
        referenceType: 'SALE',
        referenceId: `${input.saleId}:cogs`,
        saleId: input.saleId,
        lines: [
          { account: cogsAccount, debit: cogsTotal, memo: `COGS ${input.saleCode}` },
          { account: inventoryAccount, credit: cogsTotal, memo: `Inventory ${input.saleCode}` },
        ],
      },
      accounts,
    );
  }

  // --- Tax records for period reporting -------------------------------------
  const periodYear = input.occurredAt.getUTCFullYear();
  const periodMonth = input.occurredAt.getUTCMonth() + 1;

  for (const line of input.lines) {
    if (line.taxAmount === 0) continue;
    await tx.taxRecord.create({
      data: {
        businessId: input.businessId,
        branchId: input.branchId,
        taxId: line.taxId,
        accountId: taxAccount,
        sourceType: 'SALE',
        sourceId: input.saleId,
        periodYear,
        periodMonth,
        taxableAmount: line.lineSubtotal,
        taxAmount: line.taxAmount,
        taxRate: line.taxRate,
      },
    });
  }
}

function formatQty(qtyMilli: QtyMilli): string {
  const whole = Math.trunc(qtyMilli / 1000);
  const frac = Math.abs(qtyMilli % 1000);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}
