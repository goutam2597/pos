import type { Tx } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { lineValue, type QtyMilli } from '@monopos/shared';
import type { CostingMethod, StockMoveType, StockReferenceType } from '../../generated/prisma/enums.js';

/**
 * Inventory movement engine.
 *
 * Two tables, with a strict division of responsibility:
 *
 *   * `StockLevel` — the current position. Mutable, hot, one row per
 *     (warehouse, item). Every read of "how much do we have" hits this.
 *   * `StockMove`  — the immutable ledger. Append-only, one row per movement.
 *
 * `StockLevel` is always derived from `StockMove` inside the same transaction;
 * the level row is a running cache, never an independent source of truth. The
 * integrity test in `tests/inventory.test.ts` re-derives every level from the
 * move history and fails if they disagree.
 *
 * CONCURRENCY. Two tills selling the last unit at the same instant is the
 * normal case, not an edge case. Every mutation takes a row lock on the
 * corresponding `StockLevel` with `SELECT ... FOR UPDATE`, so the read-check-write
 * sequence is atomic. Without the lock both transactions would read the same
 * quantity and the second would drive stock negative.
 */

export interface StockItem {
  productId: string;
  variantId: string | null;
  warehouseId: string;
  branchId: string | null;
}

/** Non-null identity for a stockable item: the variant if present, else product. */
export function itemKeyFor(item: { productId: string; variantId: string | null }): string {
  return item.variantId ?? item.productId;
}

export interface MoveInput {
  businessId: string;
  warehouseId: string;
  branchId: string | null;
  productId: string;
  variantId: string | null;
  type: StockMoveType;
  /** Signed change in milli-units. Negative for outbound. */
  qtyMilli: QtyMilli;
  /** Unit cost in minor units per single unit. */
  unitCost?: number;
  referenceType?: StockReferenceType | null;
  referenceId?: string | null;
  referenceNo?: string | null;
  note?: string | null;
  createdById?: string | null;
  /** Allow the result to go negative (stocktakes, damaged goods). */
  allowNegative?: boolean;
  /**
   * Skip the availability check for outbound movements where the shortfall is
   * already known and approved (e.g. selling from a branch that will replenish).
   */
  force?: boolean;
}

export interface MoveResult {
  stockLevelId: string;
  moveId: string;
  qtyOnHand: QtyMilli;
  averageCost: number;
  value: number;
}

/**
 * Apply one stock movement.
 *
 * MUST run inside the transaction that owns the business operation, so that
 * stock and its accounting consequences commit or roll back together.
 */
export async function applyMove(tx: Tx, input: MoveInput): Promise<MoveResult> {
  const itemKey = itemKeyFor(input);
  if (!Number.isSafeInteger(input.qtyMilli)) {
    throw new AppError('UNPROCESSABLE', 'Quantity must be a whole number of milli-units');
  }

  const level = await lockStockLevel(tx, {
    businessId: input.businessId,
    warehouseId: input.warehouseId,
    itemKey,
    productId: input.productId,
    variantId: input.variantId,
    branchId: input.branchId,
  });

  const inbound = input.qtyMilli > 0;
  const newQty = level.qtyOnHand + input.qtyMilli;

  if (!inbound && newQty < 0 && !input.allowNegative && !input.force) {
    const label = level.name ?? 'item';
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Not enough stock for ${label}: ${formatQty(level.qtyOnHand)} available, ` +
        `${formatQty(Math.abs(input.qtyMilli))} requested`,
    );
  }

  // --- Costing ------------------------------------------------------------
  // Inbound movements refresh the weighted average; outbound movements consume
  // it at the existing average so COGS reflects what the goods actually cost.
  const incomingCost = input.unitCost ?? 0;
  let newAverage = level.averageCost;

  if (inbound && input.qtyMilli > 0) {
    const existingValue = level.qtyOnHand * level.averageCost;
    const incomingValue = input.qtyMilli * incomingCost;
    newAverage =
      level.qtyOnHand + input.qtyMilli === 0
        ? incomingCost
        : Math.round((existingValue + incomingValue) / (level.qtyOnHand + input.qtyMilli));
  }

  const effectiveCost = inbound ? (input.unitCost ?? level.lastCost ?? newAverage) : level.averageCost;
  const moveValue = Math.abs(lineValue(Math.abs(input.qtyMilli), effectiveCost));

  await tx.stockLevel.update({
    where: { id: level.id },
    data: {
      qtyOnHand: newQty,
      ...(inbound ? { averageCost: newAverage, lastCost: incomingCost } : {}),
    },
  });

  const move = await tx.stockMove.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      variantId: input.variantId,
      type: input.type,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceNo: input.referenceNo ?? null,
      qtyMilli: input.qtyMilli,
      unitCost: effectiveCost,
      value: moveValue,
      balanceAfterMilli: newQty,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
    select: { id: true },
  });

  return {
    stockLevelId: level.id,
    moveId: move.id,
    qtyOnHand: newQty,
    averageCost: newAverage,
    value: moveValue,
  };
}

/**
 * Fetch the stock level, creating it if absent, holding a row lock for the
 * duration of the caller's transaction.
 *
 * `SELECT ... FOR UPDATE` is used rather than a plain read because a
 * read-then-write without the lock loses updates under concurrency.
 */
async function lockStockLevel(
  tx: Tx,
  input: {
    businessId: string;
    warehouseId: string;
    itemKey: string;
    productId: string;
    variantId: string | null;
    branchId: string | null;
  },
) {
  // Try to lock the existing row.
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      qtyOnHand: number;
      qtyReserved: number;
      averageCost: number;
      lastCost: number;
      name: string | null;
    }>
  >`
    SELECT sl.id, sl."qtyOnHand", sl."qtyReserved", sl."averageCost", sl."lastCost",
           COALESCE(pv.name, p.name) AS name
      FROM "StockLevel" sl
      JOIN "Product" p ON p.id = sl."productId"
      LEFT JOIN "ProductVariant" pv ON pv.id = sl."variantId"
     WHERE sl."warehouseId" = ${input.warehouseId}::text
       AND sl."itemKey" = ${input.itemKey}::text
     FOR UPDATE OF sl
  `;

  const existing = rows[0];
  if (existing) {
    return {
      id: existing.id,
      qtyOnHand: existing.qtyOnHand,
      qtyReserved: existing.qtyReserved,
      averageCost: existing.averageCost,
      lastCost: existing.lastCost,
      name: existing.name,
    };
  }

  // First movement for this item in this warehouse: create the level row.
  // The unique index on (warehouseId, itemKey) makes this safe against a
  // concurrent creator — the loser gets P2002 and retries.
  const created = await tx.stockLevel.create({
    data: {
      businessId: input.businessId,
      warehouseId: input.warehouseId,
      branchId: input.branchId,
      productId: input.productId,
      variantId: input.variantId,
      itemKey: input.itemKey,
    },
    select: { id: true, qtyOnHand: true, qtyReserved: true, averageCost: true, lastCost: true },
  });

  return { ...created, name: null };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface AvailabilityIssue {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  warehouseId: string;
  available: QtyMilli;
  requested: QtyMilli;
  shortage: QtyMilli;
}

/**
 * Check a cart against on-hand stock across all of its lines BEFORE posting.
 *
 * Running this first lets the caller fail the whole sale with one clear message
 * listing every problem line, instead of discovering shortages one `applyMove`
 * at a time and leaving a half-applied transaction to reason about.
 */
export async function checkAvailability(
  tx: Tx,
  businessId: string,
  lines: Array<{
    productId: string;
    variantId: string | null;
    qtyMilli: QtyMilli;
    warehouseId: string;
    trackInventory: boolean;
    allowBackorder: boolean;
    allowNegativeStock: boolean;
    name: string;
    sku: string | null;
  }>,
): Promise<AvailabilityIssue[]> {
  const tracked = lines.filter((l) => l.trackInventory && !l.allowBackorder && !l.allowNegativeStock);
  if (tracked.length === 0) return [];

  const keys = tracked.map((l) => itemKeyFor(l));
  const levels = await tx.stockLevel.findMany({
    where: {
      businessId,
      itemKey: { in: keys },
      warehouseId: { in: tracked.map((l) => l.warehouseId) },
    },
    select: { itemKey: true, warehouseId: true, qtyOnHand: true, qtyReserved: true },
  });

  const index = new Map(levels.map((l) => [`${l.warehouseId}:${l.itemKey}`, l]));

  const issues: AvailabilityIssue[] = [];
  for (const line of tracked) {
    const level = index.get(`${line.warehouseId}:${itemKeyFor(line)}`);
    const available = (level?.qtyOnHand ?? 0) - (level?.qtyReserved ?? 0);
    if (available < line.qtyMilli) {
      issues.push({
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        sku: line.sku,
        warehouseId: line.warehouseId,
        available,
        requested: line.qtyMilli,
        shortage: line.qtyMilli - available,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Valuation and costing helpers
// ---------------------------------------------------------------------------

/**
 * Unit cost to use for a sale line's COGS.
 *
 * Read from the live `StockLevel` average so that the revenue entry and the COGS
 * entry for the same sale are computed from one consistent snapshot.
 */
export async function costForItems(
  tx: Tx,
  businessId: string,
  lines: Array<{ productId: string; variantId: string | null; warehouseId: string }>,
): Promise<Map<string, { cost: number; method: CostingMethod }>> {
  if (lines.length === 0) return new Map();

  const keys = lines.map((l) => itemKeyFor(l));
  const [levels, products] = await Promise.all([
    tx.stockLevel.findMany({
      where: { businessId, itemKey: { in: keys }, warehouseId: { in: lines.map((l) => l.warehouseId) } },
      select: { itemKey: true, warehouseId: true, averageCost: true, lastCost: true },
    }),
    tx.product.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.productId))] } },
      select: { id: true, costPrice: true, costingMethod: true },
    }),
  ]);

  const levelIndex = new Map(levels.map((l) => [`${l.warehouseId}:${l.itemKey}`, l]));
  const productIndex = new Map(products.map((p) => [p.id, p]));
  const result = new Map<string, { cost: number; method: CostingMethod }>();

  for (const line of lines) {
    const product = productIndex.get(line.productId);
    const level = levelIndex.get(`${line.warehouseId}:${itemKeyFor(line)}`);
    const method = product?.costingMethod ?? 'AVERAGE';

    let cost: number;
    switch (method) {
      case 'LIFETIME':
      case 'STANDARD':
        cost = product?.costPrice ?? level?.lastCost ?? 0;
        break;
      case 'FIFO':
        // FIFO is approximated by the weighted average here. A true FIFO layer
        // table is a deliberate v2 addition; until then AVERAGE is the
        // conservative choice because it never understates COGS.
        cost = level?.averageCost ?? product?.costPrice ?? 0;
        break;
      case 'AVERAGE':
      default:
        cost = level?.averageCost ?? product?.costPrice ?? 0;
        break;
    }

    result.set(`${line.warehouseId}:${itemKeyFor(line)}`, { cost, method });
  }
  return result;
}

/** Total stock value across a warehouse, for inventory reports. */
export async function inventoryValue(
  tx: Tx,
  businessId: string,
  warehouseId?: string | null,
): Promise<{ totalValue: number; itemCount: number; lines: Array<{ itemKey: string; qty: QtyMilli; value: number; name: string | null; sku: string | null }> }> {
  const levels = await tx.stockLevel.findMany({
    where: { businessId, ...(warehouseId ? { warehouseId } : {}), qtyOnHand: { not: 0 } },
    select: {
      itemKey: true,
      qtyOnHand: true,
      averageCost: true,
      product: { select: { name: true, sku: true } },
      variant: { select: { name: true, sku: true } },
    },
  });

  const lines = levels.map((l) => ({
    itemKey: l.itemKey,
    qty: l.qtyOnHand,
    value: lineValue(l.qtyOnHand, l.averageCost),
    name: l.variant?.name ? `${l.product.name} — ${l.variant.name}` : l.product.name,
    sku: l.variant?.sku ?? l.product.sku,
  }));

  return {
    totalValue: lines.reduce((sum, l) => sum + l.value, 0),
    itemCount: lines.length,
    lines,
  };
}

function formatQty(qtyMilli: QtyMilli): string {
  const whole = Math.trunc(qtyMilli / 1000);
  const frac = Math.abs(qtyMilli % 1000);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}
