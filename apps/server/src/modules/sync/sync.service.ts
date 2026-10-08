import { z } from 'zod';
import type { Tx } from '../../db/client.js';
import { prisma, transaction } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { context, assertBranchAccess } from '../../lib/context.js';
import { audit } from '../../lib/audit.js';
import { createSaleInTransaction, type CreateSaleInput } from '../sales/sale.service.js';
import { postJournal, resolveSystemAccounts, ACCOUNT_CODES, accountIdFor } from '../accounting/ledger.js';
import { applyMove } from '../inventory/stock.js';
import { nextNumber } from '../../lib/numbering.js';
import {
  SYNC_PROTOCOL_VERSION,
  OFFLINE_OP_SET,
  type SyncDelta,
  type OfflineOpType,
  type SyncEntity,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushItem,
  type SyncPushItemResult,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@monopos/shared';

/**
 * Offline synchronisation.
 *
 * This is where the promise "the system must never silently lose a transaction"
 * is actually kept.
 *
 * THE MODEL. A disconnected till does not queue "HTTP requests". It queues
 * *business operations* in IndexedDB, each stamped with a `clientTxnId` the
 * device minted at the moment of capture. When connectivity returns the device
 * pushes a batch; this module applies each operation in its own transaction and
 * reports the outcome per item.
 *
 * WHY PER-OPERATION TRANSACTIONS. A batch of twenty sales where the seventh
 * conflicts must still commit the other nineteen. Wrapping the batch in one
 * transaction would mean one bad sale silently discarding a shift's takings —
 * exactly the data loss this design exists to prevent. So the batch is a loop of
 * independent transactions, and a failure is isolated to its own item.
 *
 * WHY `SyncOperation` EXISTS. `clientTxnId` is also UNIQUE on `Sale`, `Payment`,
 * `Customer` and `Supplier`, which is the real idempotency guarantee. The
 * `SyncOperation` table is the cross-cutting journal: it records operations that
 * have no natural home for a unique key (a held cart, a cash drop), and it gives
 * an operator a single place to see what a device did while it was dark.
 */

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

/**
 * Validators for each offline-capable operation.
 *
 * A payload arriving from a device that has been offline for days may be a week
 * behind the server, so it is validated far more defensively than an equivalent
 * online request: unknown fields are stripped rather than rejected, and every
 * amount must still be a safe integer of minor units.
 */
const money = z.number().int();

const saleLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullish(),
  qtyMilli: z.number().int().positive(),
  unitPrice: money.nonnegative().optional(),
  discountType: z.enum(['NONE', 'PERCENT', 'FIXED']).optional(),
  discountValue: money.nonnegative().optional(),
  note: z.string().max(500).nullish(),
});

const salePayloadSchema = z.object({
  branchId: z.string().min(1),
  registerId: z.string().min(1).nullish(),
  customerId: z.string().min(1).nullish(),
  shiftId: z.string().min(1).nullish(),
  channel: z.enum(['POS', 'OFFLINE']).optional(),
  lines: z.array(saleLineSchema).min(1).max(500),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER']),
        amount: money.positive(),
        reference: z.string().max(200).nullish(),
        cardLast4: z.string().regex(/^\d{4}$/).nullish(),
        approvalCode: z.string().max(64).nullish(),
      }),
    )
    .min(1)
    .max(20),
  cartDiscount: money.nonnegative().optional(),
  allowCredit: z.boolean().optional(),
  note: z.string().max(1000).nullish(),
  customerNote: z.string().max(1000).nullish(),
  capturedAt: z.number().int().optional(),
});

const customerPayloadSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(40).nullish(),
  email: z.string().email().nullish(),
  address: z.string().max(300).nullish(),
  city: z.string().max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  tier: z.enum(['RETAIL', 'WHOLESALE', 'VIP', 'DISTRIBUTOR']).optional(),
});

const holdPayloadSchema = z.object({
  branchId: z.string().min(1),
  label: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.number().int().nullish(),
});

const cashMovementPayloadSchema = z.object({
  branchId: z.string().min(1),
  registerId: z.string().min(1),
  shiftId: z.string().min(1),
  type: z.enum(['DROP', 'PAYOUT', 'COUNT_IN', 'COUNT_OUT', 'FLOAT']),
  amount: money.positive(),
  reason: z.string().max(200).nullish(),
});

const VOID_SALE_SCHEMA = z.object({
  saleCode: z.string().min(1),
  reason: z.string().min(1).max(300),
});

const REFUND_SCHEMA = z.object({
  saleCode: z.string().min(1),
  amount: money.positive(),
  method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER']).default('CASH'),
  reason: z.string().max(300).nullish(),
});

const PAYMENT_ADD_SCHEMA = z.object({
  saleCode: z.string().min(1),
  method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'GIFT_CARD', 'COUPON', 'OTHER']),
  amount: money.positive(),
  reference: z.string().max(200).nullish(),
});

type PayloadSchema = z.ZodTypeAny;

const PAYLOAD_SCHEMAS: Record<string, PayloadSchema> = {
  SALE_CREATE: salePayloadSchema,
  SALE_UPDATE: z.object({ saleCode: z.string().min(1), note: z.string().max(1000).nullish() }),
  SALE_VOID: VOID_SALE_SCHEMA,
  SALE_REFUND: REFUND_SCHEMA,
  CUSTOMER_CREATE: customerPayloadSchema,
  CUSTOMER_UPDATE: customerPayloadSchema.partial().extend({ customerId: z.string().min(1) }),
  HOLD_CREATE: holdPayloadSchema,
  HOLD_RELEASE: z.object({ holdId: z.string().min(1) }),
  PAYMENT_ADD: PAYMENT_ADD_SCHEMA,
  REGISTER_CASH_DROP: cashMovementPayloadSchema,
  REGISTER_CASH_COUNT: cashMovementPayloadSchema,
};

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export const pushRequestSchema = z.object({
  protocolVersion: z.number().int(),
  deviceId: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        clientTxnId: z.string().min(8).max(100),
        type: z.string().min(1),
        capturedAt: z.number().int(),
        registerId: z.string().nullish(),
        payload: z.unknown(),
      }),
    )
    .min(1),
});

export async function pushOperations(
  raw: z.infer<typeof pushRequestSchema>,
): Promise<SyncPushResponse> {
  const ctx = context();
  const businessId = ctx.businessId;

  if (raw.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new AppError(
      'OFFLINE_CONFLICT',
      `This device speaks sync protocol v${raw.protocolVersion} but the server is on ` +
        `v${SYNC_PROTOCOL_VERSION}. Update the terminal software before syncing.`,
    );
  }

  const results: SyncPushItemResult[] = [];

  for (const item of raw.items) {
    // One transaction per item, in its own try/catch. A failure here must never
    // prevent the remaining items in the batch from being applied.
    try {
      const result = await transaction((tx) =>
        applyOperation(tx, {
          businessId,
          userId: ctx.userId,
          deviceId: raw.deviceId,
          item: item as unknown as SyncPushItem,
        }),
      );
      results.push(result);
    } catch (error) {
      results.push(toFailure(item as unknown as SyncPushItem, error));
    }
  }

  const applied = results.filter((r) => r.kind === 'applied' || r.kind === 'duplicate').length;
  if (applied > 0) {
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: ctx.userId,
        action: 'SYNC',
        entityType: 'Sale',
        changes: {
          deviceId: raw.deviceId,
          pushed: raw.items.length,
          applied,
          failed: results.length - applied,
        },
      },
    });
  }

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    serverTime: Date.now(),
    results,
    nextCursor: await currentCursor(businessId),
  };
}

interface ApplyContext {
  businessId: string;
  userId: string;
  deviceId: string;
  item: SyncPushItem;
}

/**
 * Apply one offline operation, idempotently.
 *
 * The first thing this does is check `SyncOperation` for the `clientTxnId`.
 * If a previous attempt already recorded it, the original result is replayed
 * back to the client and nothing is written — which is what makes a retried
 * batch a genuine no-op rather than a second sale.
 */
async function applyOperation(tx: Tx, ctx: ApplyContext): Promise<SyncPushItemResult> {
  const item = ctx.item;

  if (!OFFLINE_OP_SET.has(item.type)) {
    throw new AppError('OFFLINE_CONFLICT', `"${item.type}" cannot be performed from an offline terminal`);
  }
  // Narrowed to the offline-op union so the dispatch below is type-safe.
  const type = item.type as OfflineOpType;

  const schema = PAYLOAD_SCHEMAS[type];
  if (!schema) {
    throw new AppError('OFFLINE_CONFLICT', `No handler is registered for operation "${item.type}"`);
  }

  // --- Idempotency check ---------------------------------------------------
  const prior = await tx.syncOperation.findUnique({
    where: {
      businessId_clientTxnId: {
        businessId: ctx.businessId,
        clientTxnId: item.clientTxnId,
      },
    },
  });

  if (prior) {
    if (prior.status === 'REJECTED') {
      // A permanently rejected operation stays rejected. Re-sending it would
      // fail identically, so tell the client to stop retrying.
      return {
        clientTxnId: item.clientTxnId,
        kind: 'rejected',
        code: prior.message ?? 'REJECTED',
        note: prior.message ?? 'This operation was previously rejected.',
      };
    }
    return {
      clientTxnId: item.clientTxnId,
      kind: 'duplicate',
      serverId: prior.resultId ?? undefined,
      serverRef: prior.resultRef ?? undefined,
      note: 'Already applied — no duplicate was created.',
    };
  }

  // --- Validate -------------------------------------------------------------
  const parsed = schema.safeParse(item.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await recordOperation(tx, ctx, 'REJECTED', null, null, null, detail, parsed.data as unknown);
    throw new AppError('VALIDATION_FAILED', `Invalid "${item.type}" payload — ${detail}`);
  }

  const capturedAt = new Date(item.capturedAt);

  // --- Dispatch -------------------------------------------------------------
  switch (type) {
    case 'SALE_CREATE': {
      const payload = parsed.data as z.infer<typeof salePayloadSchema>;
      assertBranchAccess(payload.branchId);

      const input: CreateSaleInput = {
        businessId: ctx.businessId,
        branchId: payload.branchId,
        registerId: payload.registerId ?? null,
        userId: ctx.userId,
        customerId: payload.customerId ?? null,
        shiftId: payload.shiftId ?? null,
        channel: 'OFFLINE',
        offline: true,
        lines: payload.lines,
        payments: payload.payments,
        cartDiscount: payload.cartDiscount ?? 0,
        allowCredit: payload.allowCredit ?? false,
        note: payload.note ?? null,
        customerNote: payload.customerNote ?? null,
        clientTxnId: item.clientTxnId,
        capturedAt,
      };

      // A duplicate that slipped past the SyncOperation check (for example two
      // devices racing on the same id) is caught by the unique index on
      // (businessId, clientTxnId) and surfaces as a duplicate result.
      const result = await createSaleInTransaction(tx, input);

      await recordOperation(tx, ctx, result.duplicate ? 'DUPLICATE' : 'APPLIED', 'Sale', result.saleId, result.saleCode, null, parsed.data);

      return {
        clientTxnId: item.clientTxnId,
        kind: result.duplicate ? 'duplicate' : 'applied',
        serverId: result.saleId,
        serverRef: result.saleCode,
        note: 'Captured offline and posted to the ledger.',
      };
    }

    case 'CUSTOMER_CREATE': {
      const payload = parsed.data as z.infer<typeof customerPayloadSchema>;

      const customer = await tx.party.create({
        data: {
          businessId: ctx.businessId,
          type: 'CUSTOMER',
          name: payload.name,
          phone: payload.phone ?? null,
          email: payload.email ?? null,
          address: payload.address ?? null,
          city: payload.city ?? null,
          notes: payload.notes ?? null,
          customerProfile: {
            create: { tier: payload.tier ?? 'RETAIL', clientTxnId: item.clientTxnId },
          },
        },
        select: { id: true, name: true },
      });

      await recordOperation(tx, ctx, 'APPLIED', 'Customer', customer.id, customer.name, null, parsed.data);

      return {
        clientTxnId: item.clientTxnId,
        kind: 'applied',
        serverId: customer.id,
        serverRef: customer.name,
      };
    }

    case 'HOLD_CREATE': {
      const payload = parsed.data as z.infer<typeof holdPayloadSchema>;
      assertBranchAccess(payload.branchId);

      const hold = await tx.saleHold.create({
        data: {
          businessId: ctx.businessId,
          branchId: payload.branchId,
          label: payload.label,
          payload: payload.payload as never,
          clientTxnId: item.clientTxnId,
          expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        },
        select: { id: true },
      });

      await recordOperation(tx, ctx, 'APPLIED', 'Sale', hold.id, payload.label, null, parsed.data);

      return { clientTxnId: item.clientTxnId, kind: 'applied', serverId: hold.id };
    }

    case 'REGISTER_CASH_DROP':
    case 'REGISTER_CASH_COUNT': {
      const payload = parsed.data as z.infer<typeof cashMovementPayloadSchema>;
      assertBranchAccess(payload.branchId);

      const movement = await tx.cashMovement.create({
        data: {
          shiftId: payload.shiftId,
          type: item.type === 'REGISTER_CASH_DROP' ? 'DROP' : 'COUNT_IN',
          amount: payload.amount,
          reason: payload.reason ?? null,
          clientTxnId: item.clientTxnId,
          createdById: ctx.userId,
        },
        select: { id: true },
      });

      await recordOperation(tx, ctx, 'APPLIED', 'Shift', movement.id, null, null, parsed.data);

      return { clientTxnId: item.clientTxnId, kind: 'applied', serverId: movement.id };
    }

    case 'SALE_VOID':
    case 'SALE_REFUND':
    case 'PAYMENT_ADD': {
      // These reference a sale by its server-assigned code. A device that
      // created that sale offline will already have received the code from an
      // earlier sync push; if it has not, this is a genuine conflict the
      // operator must resolve.
      const payload = parsed.data as Record<string, unknown>;
      const sale = await tx.sale.findFirst({
        where: { businessId: ctx.businessId, code: String(payload.saleCode) },
        select: { id: true, code: true, status: true, total: true, paidTotal: true, branchId: true },
      });

      if (!sale) {
        throw new AppError(
          'OFFLINE_CONFLICT',
          `Sale ${payload.saleCode} is not on the server yet. Push the originating sale first.`,
        );
      }
      assertBranchAccess(sale.branchId);

      if (item.type === 'SALE_VOID') {
        if (sale.status === 'VOIDED') {
          return { clientTxnId: item.clientTxnId, kind: 'duplicate', serverId: sale.id, serverRef: sale.code };
        }
        await voidSaleInTransaction(tx, { saleId: sale.id, businessId: ctx.businessId, reason: String(payload.reason), userId: ctx.userId });
        await recordOperation(tx, ctx, 'APPLIED', 'Sale', sale.id, sale.code, null, parsed.data);
        return { clientTxnId: item.clientTxnId, kind: 'applied', serverId: sale.id, serverRef: sale.code };
      }

      const payment = await tx.payment.create({
        data: {
          businessId: ctx.businessId,
          branchId: sale.branchId,
          type: item.type === 'SALE_REFUND' ? 'REFUND' : 'SALE',
          method: (payload.method ?? 'CASH') as never,
          status: 'PAID',
          direction: item.type === 'SALE_REFUND' ? 'OUT' : 'IN',
          amount: Number(payload.amount),
          saleId: sale.id,
          userId: ctx.userId,
          clientTxnId: item.clientTxnId,
          reference: (payload.reference as string) ?? null,
          note: (payload.reason as string) ?? null,
        },
        select: { id: true },
      });

      await recordOperation(tx, ctx, 'APPLIED', 'Payment', payment.id, sale.code, null, parsed.data);

      return { clientTxnId: item.clientTxnId, kind: 'applied', serverId: payment.id, serverRef: sale.code };
    }

    default:
      throw new AppError('OFFLINE_CONFLICT', `Operation "${item.type}" is recognised but not handled`);
  }
}

/** Record an operation in the idempotency journal. */
async function recordOperation(
  tx: Tx,
  ctx: ApplyContext,
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT',
  resultType: string | null,
  resultId: string | null,
  resultRef: string | null,
  message: string | null,
  payload: unknown,
): Promise<void> {
  await tx.syncOperation.create({
    data: {
      businessId: ctx.businessId,
      deviceId: ctx.deviceId,
      clientTxnId: ctx.item.clientTxnId,
      type: ctx.item.type,
      status,
      resultType,
      resultId,
      resultRef,
      message,
      payload: (payload ?? null) as never,
      capturedAt: new Date(ctx.item.capturedAt),
    },
  });
}

/** Turn a thrown error into the per-item result the client expects. */
function toFailure(item: SyncPushItem, error: unknown): SyncPushItemResult {
  if (error instanceof AppError) {
    // A validation or business-rule rejection is permanent: retrying cannot help,
    // and the client must surface it to an operator rather than retry forever.
    const permanent = [
      'VALIDATION_FAILED',
      'UNPROCESSABLE',
      'INSUFFICIENT_STOCK',
      'FORBIDDEN',
      'OFFLINE_CONFLICT',
      'PERIOD_CLOSED',
      'JOURNAL_UNBALANCED',
    ].includes(error.code);

    return {
      clientTxnId: item.clientTxnId,
      kind: 'rejected',
      code: error.code,
      note: permanent
        ? error.message
        : `${error.message} This is a temporary problem — it will be retried automatically.`,
    };
  }

  return {
    clientTxnId: item.clientTxnId,
    kind: 'rejected',
    code: 'INTERNAL',
    note: 'An unexpected server error occurred. The item stays in the queue and will be retried.',
  };
}

// ---------------------------------------------------------------------------
// Void (shared with the online route)
// ---------------------------------------------------------------------------

export async function voidSaleInTransaction(
  tx: Tx,
  input: { saleId: string; businessId: string; reason: string; userId: string },
): Promise<void> {
  const sale = await tx.sale.findUnique({
    where: { id: input.saleId },
    include: { items: true, payments: true, invoice: true },
  });

  if (!sale || sale.businessId !== input.businessId) {
    throw new AppError('NOT_FOUND', 'Sale not found');
  }
  if (sale.status === 'VOIDED') {
    throw new AppError('CONFLICT', 'This sale has already been voided');
  }
  if (sale.status === 'REFUNDED') {
    throw new AppError('CONFLICT', 'This sale has been fully refunded and cannot be voided');
  }

  const accounts = await resolveSystemAccounts(tx, input.businessId);

  // Reverse the revenue entry and the COGS entry, and put the stock back.
  const journals = await tx.journalEntry.findMany({
    where: { saleId: sale.id, status: 'POSTED' },
    select: { id: true },
  });

  const revenueAccount = await accountIdFor(accounts, ACCOUNT_CODES.SALES_REVENUE);
  const discountAccount = await accountIdFor(accounts, ACCOUNT_CODES.SALES_DISCOUNT);
  const taxAccount = await accountIdFor(accounts, ACCOUNT_CODES.TAX_PAYABLE);
  const receivableAccount = await accountIdFor(accounts, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
  const cashAccount = await accountIdFor(accounts, ACCOUNT_CODES.CASH);
  const cogsAccount = await accountIdFor(accounts, ACCOUNT_CODES.COGS);
  const inventoryAccount = await accountIdFor(accounts, ACCOUNT_CODES.INVENTORY);

  const cashReceived = sale.payments
    .filter((p) => p.direction === 'IN' && p.type === 'SALE')
    .reduce((sum, p) => sum + p.amount, 0);

  // The original entry debited the drawer with the GROSS cash handed over and
  // credited the change straight back out. Reversing it therefore has to debit
  // the change again — otherwise the reversal credits more cash than the sale
  // ever put in, and the drawer slowly inflates with voided sales.
  const changeGiven = Math.max(0, cashReceived - sale.total);

  // Cash rounding was posted on the ORIGINAL entry as: a CREDIT to revenue when
  // the sale was rounded UP, and a DEBIT when it was rounded DOWN (which is the
  // all-cash case). The reversal must be the exact mirror — same magnitude,
  // opposite side — or the void is out of balance by precisely the rounding.
  const rounding = sale.total - sale.subtotal - sale.taxTotal;

  await postJournal(
    tx,
    {
      businessId: input.businessId,
      branchId: sale.branchId,
      date: new Date(),
      source: 'MANUAL',
      memo: `Void sale ${sale.code}: ${input.reason}`,
      referenceType: 'SALE',
      referenceId: sale.id,
      saleId: sale.id,
      lines: [
        ...(sale.subtotal > 0 ? [{ account: revenueAccount, debit: sale.subtotal }] : []),
        ...(sale.taxTotal > 0 ? [{ account: taxAccount, debit: sale.taxTotal }] : []),
        ...(rounding > 0
          ? [{ account: revenueAccount, debit: rounding, memo: 'Reverse cash rounding' }]
          : rounding < 0
            ? [{ account: revenueAccount, credit: -rounding, memo: 'Reverse cash rounding' }]
            : []),
        ...(changeGiven > 0 ? [{ account: cashAccount, debit: changeGiven, memo: 'Reverse change given' }] : []),
        ...(cashReceived > 0 ? [{ account: cashAccount, credit: cashReceived }] : []),
        ...(sale.balanceDue > 0 ? [{ account: receivableAccount, credit: sale.balanceDue, partyId: sale.customerId }] : []),
      ],
    },
    accounts,
  );

  const costTotal = sale.items.reduce((sum, i) => sum + i.lineCost, 0);
  if (costTotal > 0) {
    await postJournal(
      tx,
      {
        businessId: input.businessId,
        branchId: sale.branchId,
        date: new Date(),
        source: 'MANUAL',
        memo: `Reverse cost of goods sold ${sale.code}`,
        referenceType: 'SALE',
        referenceId: `${sale.id}:cogs:void`,
        saleId: sale.id,
        lines: [
          { account: inventoryAccount, debit: costTotal },
          { account: cogsAccount, credit: costTotal },
        ],
      },
      accounts,
    );
  }

  // Return the goods to stock.
  for (const item of sale.items) {
    if (!item.warehouseId) continue;
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { trackInventory: true },
    });
    if (!product?.trackInventory) continue;

    await applyMove(tx, {
      businessId: input.businessId,
      warehouseId: item.warehouseId,
      branchId: sale.branchId,
      productId: item.productId,
      variantId: item.variantId,
      type: 'RETURN_IN',
      qtyMilli: item.qtyMilli,
      unitCost: item.unitCost,
      referenceType: 'RETURN',
      referenceId: sale.id,
      referenceNo: sale.code,
      note: `Void ${sale.code}`,
      createdById: input.userId,
    });
  }

  await tx.payment.updateMany({
    where: { saleId: sale.id, status: { not: 'VOIDED' } },
    data: { status: 'VOIDED' },
  });

  await tx.sale.update({
    where: { id: sale.id },
    data: { status: 'VOIDED', note: `Voided: ${input.reason}` },
  });

  if (sale.invoice) {
    await tx.invoice.update({
      where: { id: sale.invoice.id },
      data: { status: 'VOID', balanceDue: 0, paidTotal: 0 },
    });
  }

  await audit(tx, {
    action: 'VOID',
    entityType: 'Sale',
    entityId: sale.id,
    entityCode: sale.code,
    after: { status: 'VOIDED', reason: input.reason },
    deviceId: ctxSafeDeviceId(),
  });
}

function ctxSafeDeviceId(): string | null {
  try {
    return context().deviceId ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pull (delta feed)
// ---------------------------------------------------------------------------

export const pullRequestSchema = z.object({
  protocolVersion: z.number().int(),
  deviceId: z.string().min(1).max(200),
  cursor: z.string().nullish(),
  limit: z.number().int().positive().max(5000).optional(),
});

interface EntityFeed {
  fetch(tx: Tx, businessId: string, updatedAfter: Date, limit: number): Promise<SyncDelta[]>;
}

const toMs = (d: Date) => d.getTime();

const FEEDS: Record<SyncEntity, EntityFeed> = {
  /**
   * The product feed is PROJECTED, not raw.
   *
   * A till cannot use raw rows: it needs the tax RATE (it only holds a
   * `taxId`), the category and brand NAMES (a lookup table would have to ship
   * too), and the on-hand quantity. Making the server send exactly what the
   * till needs means one self-contained record per product, so the client
   * applies it in a single write instead of merging a `product` delta with a
   * separate `stock` delta and hoping they compose.
   */
  product: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.product.findMany({
        where: { businessId, updatedAt: { gt: after } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        include: {
          category: { select: { name: true } },
          brand: { select: { name: true } },
          unit: { select: { name: true } },
          tax: { select: { rate: true } },
          stockLevels: { select: { qtyOnHand: true, qtyReserved: true } },
          variants: { select: { id: true, sku: true, barcode: true, name: true, price: true, costPrice: true } },
        },
      });
      return rows.map((r) => ({
        entity: 'product' as const,
        id: r.id,
        updatedAt: toMs(r.updatedAt),
        deleted: false,
        data: {
          id: r.id,
          sku: r.sku,
          barcode: r.barcode,
          name: r.name,
          imageUrl: r.imageUrl,
          price: r.price,
          costPrice: r.costPrice,
          categoryId: r.categoryId,
          categoryName: r.category?.name ?? null,
          brandName: r.brand?.name ?? null,
          unitName: r.unit?.name ?? null,
          // Basis points, matching `Tax.rate`. The till prices offline, so it
          // needs the number rather than an id it cannot resolve.
          taxRate: r.tax?.rate ?? 0,
          trackInventory: r.trackInventory,
          allowNegativeStock: r.allowNegativeStock,
          status: r.status,
          qtyOnHand: r.stockLevels.reduce((sum, l) => sum + l.qtyOnHand, 0),
          qtyReserved: r.stockLevels.reduce((sum, l) => sum + l.qtyReserved, 0),
          updatedAt: toMs(r.updatedAt),
        } as Record<string, unknown>,
      }));
    },
  },
  category: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.category.findMany({
        where: { businessId, updatedAt: { gt: after } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
      return rows.map((r) => ({ entity: 'category' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  brand: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.brand.findMany({
        where: { businessId, updatedAt: { gt: after } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
      return rows.map((r) => ({ entity: 'brand' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  customer: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.party.findMany({
        where: { businessId, updatedAt: { gt: after }, type: { in: ['CUSTOMER', 'BOTH'] } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        include: { customerProfile: true },
      });
      return rows.map((r) => ({ entity: 'customer' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  supplier: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.party.findMany({
        where: { businessId, updatedAt: { gt: after }, type: { in: ['SUPPLIER', 'BOTH'] } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
      return rows.map((r) => ({ entity: 'supplier' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  tax: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.tax.findMany({ where: { businessId, updatedAt: { gt: after } }, orderBy: { updatedAt: 'asc' }, take: limit });
      return rows.map((r) => ({ entity: 'tax' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  warehouse: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.warehouse.findMany({ where: { businessId, updatedAt: { gt: after } }, orderBy: { updatedAt: 'asc' }, take: limit });
      return rows.map((r) => ({ entity: 'warehouse' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  branch: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.branch.findMany({ where: { businessId, updatedAt: { gt: after } }, orderBy: { updatedAt: 'asc' }, take: limit });
      return rows.map((r) => ({ entity: 'branch' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
  stock: {
    async fetch(tx, businessId, after, limit) {
      const rows = await tx.stockLevel.findMany({
        where: { businessId, updatedAt: { gt: after } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        select: {
          id: true, warehouseId: true, productId: true, variantId: true,
          qtyOnHand: true, qtyReserved: true, averageCost: true, updatedAt: true,
        },
      });
      return rows.map((r) => ({ entity: 'stock' as const, id: r.id, updatedAt: toMs(r.updatedAt), deleted: false, data: r as unknown as Record<string, unknown> }));
    },
  },
};

/**
 * The pull watermark.
 *
 * A cursor is simply "the newest `updatedAt` seen so far, plus a tiebreak on
 * id", encoded as `epochMillis:entity:id`. Using a single scalar would skip
 * records that share a timestamp with the boundary, which is a real risk when a
 * bulk import writes thousands of rows in one transaction.
 */
async function currentCursor(businessId: string): Promise<string> {
  const newest = await prisma.product.findFirst({
    where: { businessId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { updatedAt: true, id: true },
  });
  return newest ? `${toMs(newest.updatedAt)}:product:${newest.id}` : '0:';
}

export async function pullChanges(
  raw: z.infer<typeof pullRequestSchema>,
): Promise<SyncPullResponse> {
  const ctx = context();
  const businessId = ctx.businessId;

  if (raw.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new AppError('OFFLINE_CONFLICT', `Unsupported sync protocol v${raw.protocolVersion}`);
  }

  const limit = raw.limit ?? 500;
  const after = decodeCursor(raw.cursor ?? null);

  const deltas: SyncDelta[] = [];

  // Merge every entity feed into one time-ordered page. Each feed is paged
  // independently and then re-sorted, so a device catches up on everything
  // changed since its cursor rather than draining one entity type at a time.
  await transaction(async (tx) => {
    for (const feed of Object.values(FEEDS)) {
      const batch = await feed.fetch(tx, businessId, after, limit);
      deltas.push(...batch);
      if (deltas.length >= limit) break;
    }
  });

  deltas.sort((a, b) => a.updatedAt - b.updatedAt);
  const page = deltas.slice(0, limit);
  const hasMore = deltas.length > limit;

  const last = page[page.length - 1];
  const nextCursor: string | null = last
    ? `${last.updatedAt}:${last.entity}:${last.id}`
    : (raw.cursor ?? null);

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    serverTime: Date.now(),
    deltas: page,
    nextCursor,
    hasMore,
  };
}

function decodeCursor(cursor: string | null): Date {
  if (!cursor) return new Date(0);
  const millis = Number.parseInt(cursor.split(':')[0] ?? '0', 10);
  if (!Number.isFinite(millis) || millis <= 0) return new Date(0);
  return new Date(millis);
}

// ---------------------------------------------------------------------------
// Operator view of sync health
// ---------------------------------------------------------------------------

export interface SyncOverview {
  devices: Array<{
    deviceId: string;
    total: number;
    applied: number;
    rejected: number;
    duplicate: number;
    lastSyncAt: Date | null;
  }>;
  recentFailures: Array<{
    clientTxnId: string;
    type: string;
    deviceId: string;
    message: string | null;
    capturedAt: Date;
    processedAt: Date;
  }>;
  pendingTotal: number;
}

export async function syncOverview(businessId: string): Promise<SyncOverview> {
  const grouped = await prisma.syncOperation.groupBy({
    by: ['deviceId', 'status'],
    where: { businessId },
    _count: { _all: true },
    _max: { processedAt: true },
  }) as unknown as Array<{
    deviceId: string;
    status: string;
    count: number;
    lastSyncAt: Date | null;
  }>;

  const rows = grouped.map((g) => ({
    deviceId: g.deviceId,
    status: g.status,
    count: g.count,
    lastSyncAt: g.lastSyncAt,
  }));

  const byDevice = new Map<string, SyncOverview['devices'][number]>();
  for (const row of rows) {
    const entry = byDevice.get(row.deviceId) ?? {
      deviceId: row.deviceId,
      total: 0,
      applied: 0,
      rejected: 0,
      duplicate: 0,
      lastSyncAt: null,
    };
    entry.total += row.count;
    if (row.status === 'APPLIED') entry.applied += row.count;
    if (row.status === 'REJECTED') entry.rejected += row.count;
    if (row.status === 'DUPLICATE') entry.duplicate += row.count;
    if (row.lastSyncAt && (!entry.lastSyncAt || row.lastSyncAt > entry.lastSyncAt)) {
      entry.lastSyncAt = row.lastSyncAt;
    }
    byDevice.set(row.deviceId, entry);
  }

  const recentFailures = await prisma.syncOperation.findMany({
    where: { businessId, status: 'REJECTED' },
    orderBy: { processedAt: 'desc' },
    take: 50,
    select: {
      clientTxnId: true,
      type: true,
      deviceId: true,
      message: true,
      capturedAt: true,
      processedAt: true,
    },
  });

  return {
    devices: [...byDevice.values()].sort((a, b) => b.total - a.total),
    recentFailures,
    pendingTotal: [...byDevice.values()].reduce((sum, d) => sum + d.rejected, 0),
  };
}
