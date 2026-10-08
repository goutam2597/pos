import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../../db/client.js';
import { handler, ok, parseBody, parseQuery, listQuery, page, toDateSchema } from '../../lib/http.js';
import { context, assertBranchAccess } from '../../lib/context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { itemKeyFor } from './stock.js';

/**
 * Inventory read endpoints and stock-count adjustments.
 *
 * These live beside the stock engine rather than in the catalog routes because
 * every response here is derived from `StockLevel` + `StockMove` and must agree
 * with them; a separate module makes that dependency explicit.
 */

export const inventoryRouter = Router();

const qtyMilli = z.number().int();

// ---------------------------------------------------------------------------
// GET /inventory/stock — current position, one row per item per warehouse
// ---------------------------------------------------------------------------

const stockQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(120).optional(),
  warehouseId: z.string().optional(),
  branchId: z.string().optional(),
  categoryId: z.string().optional(),
  /** `true` narrows to items at or below their reorder point. */
  lowStock: z.string().optional(),
  /** Hide zero-quantity rows, which is what a shelf-level view wants. */
  inStockOnly: z.string().optional(),
});

inventoryRouter.get(
  '/stock',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(stockQuerySchema, req);
    const pageSize = query.pageSize ?? 25;
    const currentPage = query.page ?? 1;

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.inStockOnly === 'true') where.qtyOnHand = { not: 0 };
    if (query.categoryId) where.product = { categoryId: query.categoryId };
    if (query.search) {
      where.product = {
        ...(where.product as object | undefined),
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    // `lowStock` is a comparison between two columns on the same row, which
    // Prisma cannot express, so it is applied after the rows are read. The
    // candidate set is bounded first so this stays a cheap page-level filter.
    let candidates = await prisma.stockLevel.findMany({
      where,
      select: {
        id: true,
        productId: true,
        variantId: true,
        warehouseId: true,
        branchId: true,
        qtyOnHand: true,
        qtyReserved: true,
        averageCost: true,
        reorderPointMilli: true,
        product: {
          select: {
            id: true, name: true, sku: true, barcode: true, costPrice: true,
            unit: { select: { name: true } },
            category: { select: { name: true } },
          },
        },
        variant: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (query.lowStock === 'true') {
      candidates = candidates.filter((row) => row.reorderPointMilli > 0 && row.qtyOnHand <= row.reorderPointMilli);
    }

    const total = candidates.length;
    const start = (currentPage - 1) * pageSize;
    const rows = candidates
      .sort((a, b) => a.product.name.localeCompare(b.product.name))
      .slice(start, start + pageSize)
      .map((row) => ({
        id: row.id,
        productId: row.productId,
        variantId: row.variantId,
        productName: row.variant?.name ? `${row.product.name} — ${row.variant.name}` : row.product.name,
        sku: row.variant?.sku ?? row.product.sku,
        barcode: row.product.barcode,
        categoryName: row.product.category?.name ?? null,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        branchId: row.branchId,
        branchName: row.branch?.name ?? null,
        unitName: row.product.unit?.name ?? null,
        qtyMilli: row.qtyOnHand,
        reservedQty: row.qtyReserved,
        availableMilli: row.qtyOnHand - row.qtyReserved,
        reorderLevel: row.reorderPointMilli,
        costPrice: row.averageCost,
        value: Math.round((row.qtyOnHand * row.averageCost) / 1000),
        isLow: row.reorderPointMilli > 0 && row.qtyOnHand <= row.reorderPointMilli,
      }));

    page(res, rows, total, currentPage, pageSize);
  }),
);

// ---------------------------------------------------------------------------
// GET /inventory/moves — the immutable movement ledger
// ---------------------------------------------------------------------------

const moveQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
  from: toDateSchema.optional(),
  to: toDateSchema.optional(),
  warehouseId: z.string().optional(),
  productId: z.string().optional(),
  branchId: z.string().optional(),
  type: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

inventoryRouter.get(
  '/moves',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(moveQuerySchema, req);
    const { skip, take } = listQuery(req);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.productId) where.productId = query.productId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { product: { name: { contains: query.search, mode: 'insensitive' } } },
        { referenceNo: { contains: query.search, mode: 'insensitive' } },
        { note: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.stockMove.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          type: true,
          qtyMilli: true,
          unitCost: true,
          value: true,
          balanceAfterMilli: true,
          referenceType: true,
          referenceNo: true,
          note: true,
          createdAt: true,
          productId: true,
          product: { select: { name: true, sku: true, unit: { select: { name: true } } } },
          variant: { select: { name: true } },
          warehouse: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.stockMove.count({ where }),
    ]);

    page(
      res,
      rows.map((move) => ({
        ...move,
        productName: move.variant?.name ? `${move.product.name} — ${move.variant.name}` : move.product.name,
        sku: move.product.sku,
        unitName: move.product.unit?.name ?? null,
        warehouseName: move.warehouse.name,
        branchName: move.branch?.name ?? null,
        referenceNumber: move.referenceNo,
        userName: [move.createdBy?.firstName, move.createdBy?.lastName].filter(Boolean).join(' ') || null,
      })),
      total,
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /inventory/value — stock valuation
// ---------------------------------------------------------------------------

const valueQuerySchema = z.object({
  warehouseId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
});

inventoryRouter.get(
  '/value',
  handler(async (req, res) => {
    const ctx = context();
    const query = parseQuery(valueQuerySchema, req);
    const pageSize = query.pageSize ?? 200;
    const currentPage = query.page ?? 1;

    const where: Record<string, unknown> = {
      businessId: ctx.businessId,
      qtyOnHand: { not: 0 },
    };
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    const levels = await prisma.stockLevel.findMany({
      where,
      select: {
        productId: true,
        variantId: true,
        qtyOnHand: true,
        averageCost: true,
        product: { select: { name: true, sku: true, unit: { select: { name: true } } } },
        variant: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
    });

    const rows = levels
      .map((level) => ({
        productId: level.productId,
        variantId: level.variantId,
        productName: level.variant?.name ? `${level.product.name} — ${level.variant.name}` : level.product.name,
        sku: level.variant?.sku ?? level.product.sku,
        unitName: level.product.unit?.name ?? null,
        warehouseName: level.warehouse.name,
        qtyMilli: level.qtyOnHand,
        costPrice: level.averageCost,
        value: Math.round((level.qtyOnHand * level.averageCost) / 1000),
      }))
      .sort((a, b) => b.value - a.value);

    const total = rows.length;
    const start = (currentPage - 1) * pageSize;
    page(res, rows.slice(start, start + pageSize), total, currentPage, pageSize);
  }),
);

// ---------------------------------------------------------------------------
// POST /inventory/adjust — stock-count correction
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  warehouseId: z.string().min(1, 'Choose a warehouse'),
  note: z.string().trim().max(300).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        countedQtyMilli: qtyMilli.nonnegative('Counted quantity cannot be negative'),
        note: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, 'Add at least one line'),
});

inventoryRouter.post(
  '/adjust',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(adjustSchema, req);

    const result = await transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, businessId: ctx.businessId },
        select: { id: true, branchId: true, name: true },
      });
      if (!warehouse) throw notFound('Warehouse', input.warehouseId);
      assertBranchAccess(warehouse.branchId);

      // Imported here rather than at module scope: `stock.ts` pulls in the
      // engine, and a route module should not drag the whole engine in to
      // serve three GET endpoints.
      const { applyMove } = await import('./stock.js');

      const adjustments = [];

      for (const line of input.lines) {
        const product = await tx.product.findFirst({
          where: { id: line.productId, businessId: ctx.businessId },
          select: { id: true, name: true, trackInventory: true },
        });
        if (!product) throw notFound('Product', line.productId);

        const itemKey = itemKeyFor({ productId: line.productId, variantId: line.variantId ?? null });
        const level = await tx.stockLevel.findUnique({
          where: { warehouseId_itemKey: { warehouseId: warehouse.id, itemKey } },
          select: { qtyOnHand: true, averageCost: true },
        });

        const systemQty = level?.qtyOnHand ?? 0;
        const delta = line.countedQtyMilli - systemQty;

        if (delta !== 0) {
          await applyMove(tx, {
            businessId: ctx.businessId,
            warehouseId: warehouse.id,
            branchId: warehouse.branchId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            qtyMilli: delta,
            unitCost: level?.averageCost ?? 0,
            referenceType: 'STOCKTAKE',
            note: line.note ?? input.note ?? 'Stock-count adjustment',
            createdById: ctx.userId,
            // A stocktake's whole point is to record what is actually there,
            // including a negative result.
            allowNegative: true,
          });
        }

        adjustments.push({
          productId: line.productId,
          productName: product.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          systemQtyMilli: systemQty,
          countedQtyMilli: line.countedQtyMilli,
          deltaMilli: delta,
          applied: delta !== 0,
        });
      }

      await audit(tx, {
        action: 'STOCKTAKE',
        entityType: 'StockLevel',
        entityCode: warehouse.name,
        after: { warehouse: warehouse.name, lines: adjustments.length },
      });

      return adjustments;
    });

    const applied = result.filter((a) => a.applied);
    const netValue = applied.reduce((sum, a) => sum + a.deltaMilli * 0, 0);
    ok(res, {
      adjustments: result,
      adjustedCount: applied.length,
      netQuantityMilli: netValue,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /inventory/alerts — items below their reorder point
// ---------------------------------------------------------------------------

inventoryRouter.get(
  '/alerts',
  handler(async (_req, res) => {
    const ctx = context();
    const levels = await prisma.stockLevel.findMany({
      where: { businessId: ctx.businessId, reorderPointMilli: { gt: 0 } },
      select: {
        id: true, qtyOnHand: true, reorderPointMilli: true,
        product: { select: { id: true, name: true, sku: true } },
        variant: { select: { name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    const low = levels
      .filter((level) => level.qtyOnHand <= level.reorderPointMilli)
      .map((level) => ({
        id: level.id,
        productId: level.product.id,
        productName: level.variant?.name ? `${level.product.name} — ${level.variant.name}` : level.product.name,
        sku: level.product.sku,
        warehouseId: level.warehouse.id,
        warehouseName: level.warehouse.name,
        qtyOnHand: level.qtyOnHand,
        reorderLevel: level.reorderPointMilli,
      }));

    ok(res, low);
  }),
);

export { AppError };
