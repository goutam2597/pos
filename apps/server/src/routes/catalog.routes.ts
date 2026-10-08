import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handler, ok, parseBody, listQuery, page } from '../lib/http.js';
import { context, assertBranchAccess } from '../lib/context.js';
import { crudRoute } from '../lib/crud.js';
import { AppError, notFound } from '../lib/errors.js';
import { itemKeyFor } from '../modules/inventory/stock.js';
import { applyMove } from '../modules/inventory/stock.js';
import { transaction } from '../db/client.js';

/**
 * Catalog routes: products, categories, brands, units, taxes.
 *
 * These are the reference data every other module depends on, so they are
 * deliberately conservative: a category or tax that is in use cannot be
 * deleted, only deactivated.
 */

export const catalogRouter = Router();

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const money = z.number().int();
const optionalText = z.string().trim().max(500).nullable().optional();

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  slug: z.string().trim().max(80).optional(),
  parentId: z.string().nullish(),
  description: optionalText,
  imageUrl: z.string().url().nullish(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  taxId: z.string().nullish(),
});

catalogRouter.use(
  '/categories',
  crudRoute({
    path: '',
    permissions: { create: 'category:create', update: 'category:update', delete: 'category:delete' },
    entityType: 'Category',
    modelName: 'Category',
    model: () => prisma.category,
    createSchema: categorySchema,
    updateSchema: categorySchema.partial(),
    select: { id: true, name: true, slug: true, parentId: true, isActive: true, sortOrder: true, imageUrl: true, taxId: true },
    searchFields: ['name', 'slug'],
    orderBy: { sortOrder: 'asc' },
    scopeById: () => ({}),
    mapCreate: (input, req) => {
      const body = input as z.infer<typeof categorySchema>;
      return {
        name: body.name,
        slug: body.slug ?? slugify(body.name),
        parentId: body.parentId ?? null,
        description: body.description ?? null,
        imageUrl: body.imageUrl ?? null,
        sortOrder: body.sortOrder ?? 0,
        isActive: body.isActive ?? true,
        taxId: body.taxId ?? null,
      };
    },
    mapUpdate: (input) => input as Record<string, unknown>,
    beforeDelete: async (record) => {
      const children = await prisma.category.count({ where: { parentId: record.id } });
      const products = await prisma.product.count({ where: { categoryId: record.id } });
      if (children > 0 || products > 0) {
        throw new AppError(
          'ACCOUNT_IN_USE',
          `Cannot delete: ${children} sub-categor${children === 1 ? 'y' : 'ies'} and ` +
            `${products} product(s) use this category. Deactivate it instead.`,
        );
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

const brandSchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().max(80).optional(),
  logoUrl: z.string().url().nullish(),
  description: optionalText,
  isActive: z.boolean().default(true),
});

catalogRouter.use(
  '/brands',
  crudRoute({
    path: '',
    permissions: { create: 'brand:create', update: 'brand:update', delete: 'brand:delete' },
    entityType: 'Brand',
    modelName: 'Brand',
    model: () => prisma.brand,
    createSchema: brandSchema,
    updateSchema: brandSchema.partial(),
    select: { id: true, name: true, slug: true, logoUrl: true, isActive: true },
    searchFields: ['name', 'slug'],
    orderBy: { name: 'asc' },
    mapCreate: (input) => {
      const body = input as z.infer<typeof brandSchema>;
      return {
        name: body.name,
        slug: body.slug ?? slugify(body.name),
        logoUrl: body.logoUrl ?? null,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
      };
    },
    mapUpdate: (input) => input as Record<string, unknown>,
    beforeDelete: async (record) => {
      const products = await prisma.product.count({ where: { brandId: record.id } });
      if (products > 0) {
        throw new AppError('ACCOUNT_IN_USE', `Cannot delete: ${products} product(s) use this brand`);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------

const unitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  plural: z.string().trim().max(60).nullish(),
  allowFraction: z.boolean().default(true),
  conversionFactor: z.number().int().positive().default(1000),
});

catalogRouter.use(
  '/units',
  crudRoute({
    path: '',
    permissions: { create: 'product:create', update: 'product:update', delete: 'product:update' },
    entityType: 'Product',
    modelName: 'Unit',
    model: () => prisma.unit,
    createSchema: unitSchema,
    updateSchema: unitSchema.partial(),
    select: { id: true, name: true, code: true, plural: true, allowFraction: true, conversionFactor: true },
    searchFields: ['name', 'code'],
    orderBy: { name: 'asc' },
    mapCreate: (input) => input as Record<string, unknown>,
    mapUpdate: (input) => input as Record<string, unknown>,
  }),
);

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

const taxSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20),
  /** Basis points: 2000 = 20%. */
  rate: z.number().int().min(0).max(100_000).default(0),
  fixedAmount: money.nonnegative().default(0),
  type: z.enum(['PERCENTAGE', 'FIXED', 'INCLUSIVE', 'EXCLUSIVE']).default('PERCENTAGE'),
  scope: z.enum(['SALE', 'PURCHASE', 'BOTH']).default('SALE'),
  exemptAbove: money.nonnegative().nullish(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

catalogRouter.use(
  '/taxes',
  crudRoute({
    path: '',
    permissions: { create: 'tax:create', update: 'tax:update', delete: 'tax:update' },
    entityType: 'Tax',
    modelName: 'Tax',
    model: () => prisma.tax,
    createSchema: taxSchema,
    updateSchema: taxSchema.partial(),
    select: { id: true, name: true, code: true, rate: true, type: true, scope: true, isActive: true, isDefault: true },
    searchFields: ['name', 'code'],
    orderBy: { name: 'asc' },
    mapCreate: (input) => input as Record<string, unknown>,
    mapUpdate: (input) => input as Record<string, unknown>,
    beforeDelete: async (record) => {
      const used = await prisma.product.count({ where: { taxId: record.id } });
      if (used > 0) throw new AppError('ACCOUNT_IN_USE', `Cannot delete: ${used} product(s) use this tax`);
    },
  }),
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const variantSchema = z.object({
  id: z.string().nullish(),
  sku: z.string().trim().max(64).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  name: z.string().trim().max(120).nullish(),
  price: money.nonnegative().default(0),
  costPrice: money.nonnegative().default(0),
  compareAtPrice: money.nonnegative().nullish(),
  isActive: z.boolean().default(true),
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  sku: z.string().trim().max(64).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  description: optionalText,
  type: z.enum(['SIMPLE', 'VARIANT', 'BUNDLE', 'SERVICE']).default('SIMPLE'),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']).default('ACTIVE'),
  categoryId: z.string().nullish(),
  brandId: z.string().nullish(),
  unitId: z.string().nullish(),
  taxId: z.string().nullish(),
  price: money.nonnegative().default(0),
  costPrice: money.nonnegative().default(0),
  compareAtPrice: money.nonnegative().nullish(),
  costingMethod: z.enum(['AVERAGE', 'FIFO', 'LIFETIME', 'STANDARD']).default('AVERAGE'),
  trackInventory: z.boolean().default(true),
  allowBackorder: z.boolean().default(false),
  allowNegativeStock: z.boolean().default(false),
  imageUrl: z.string().url().nullish(),
  sortOrder: z.number().int().default(0),
  variants: z.array(variantSchema).optional(),
});

catalogRouter.use(
  '/products',
  crudRoute({
    path: '',
    permissions: { create: 'product:create', update: 'product:update', delete: 'product:delete' },
    entityType: 'Product',
    modelName: 'Product',
    model: () => prisma.product,
    createSchema: productSchema,
    updateSchema: productSchema.partial(),
    searchFields: ['name', 'sku', 'barcode', 'description'],
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true, code: true, allowFraction: true } },
      tax: { select: { id: true, name: true, rate: true, type: true } },
      variants: {
        select: {
          id: true, sku: true, barcode: true, name: true, price: true,
          costPrice: true, compareAtPrice: true, isActive: true, position: true,
        },
        orderBy: { position: 'asc' },
      },
    },
    buildListWhere: (req) => {
      const q = req.query as Record<string, string>;
      const where: Record<string, unknown> = {};
      if (q.categoryId) where.categoryId = q.categoryId;
      if (q.brandId) where.brandId = q.brandId;
      if (q.status) where.status = q.status;
      if (q.type) where.type = q.type;
      return where;
    },
    mapCreate: (input) => {
      const body = input as z.infer<typeof productSchema>;
      const { variants, ...rest } = body;
      return {
        ...rest,
        ...(variants?.length
          ? {
              type: 'VARIANT' as const,
              variants: {
                create: variants.map((v, index) => ({
                  sku: v.sku ?? null,
                  barcode: v.barcode ?? null,
                  name: v.name ?? null,
                  price: v.price,
                  costPrice: v.costPrice,
                  compareAtPrice: v.compareAtPrice ?? null,
                  isActive: v.isActive,
                  position: index,
                })),
              },
            }
          : {}),
      } as Record<string, unknown>;
    },
    mapUpdate: (input) => {
      const body = input as Partial<z.infer<typeof productSchema>>;
      // Variants are managed by their own endpoints; nested replacement here
      // would silently delete variants that are not in the payload.
      const { variants: _variants, ...rest } = body;
      return rest as Record<string, unknown>;
    },
    beforeDelete: async (record) => {
      const sold = await prisma.saleItem.count({ where: { productId: record.id } });
      if (sold > 0) {
        throw new AppError(
          'ACCOUNT_IN_USE',
          `Cannot delete: this product appears on ${sold} sale line(s). ` +
            'Archive it instead so history stays intact.',
        );
      }
    },
  }),
);

// --- Product variants (owned by the product, managed separately) -----------

const variantCreateSchema = variantSchema.extend({ sku: z.string().trim().max(64).min(1) });

catalogRouter.post(
  '/products/:productId/variants',
  handler(async (req, res) => {
    const ctx = context();
    const product = await prisma.product.findFirst({
      where: { id: String(req.params.productId), businessId: ctx.businessId },
      select: { id: true },
    });
    if (!product) throw notFound('Product', String(req.params.productId));

    const input = parseBody(variantCreateSchema, req);
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: input.sku,
        barcode: input.barcode ?? null,
        name: input.name ?? null,
        price: input.price,
        costPrice: input.costPrice,
        compareAtPrice: input.compareAtPrice ?? null,
        isActive: input.isActive,
      },
    });
    res.status(201);
    ok(res, variant);
  }),
);

catalogRouter.patch(
  '/products/:productId/variants/:variantId',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(variantSchema.partial(), req);
    const variant = await prisma.productVariant.findFirst({
      where: { id: String(req.params.variantId), productId: String(req.params.productId), product: { businessId: ctx.businessId } },
      select: { id: true },
    });
    if (!variant) throw notFound('Variant', String(req.params.variantId));

    const { id: _ignored, ...patch } = input;
    ok(res, await prisma.productVariant.update({ where: { id: variant.id }, data: patch }));
  }),
);

catalogRouter.delete(
  '/products/:productId/variants/:variantId',
  handler(async (req, res) => {
    const ctx = context();
    const variant = await prisma.productVariant.findFirst({
      where: { id: String(req.params.variantId), productId: String(req.params.productId), product: { businessId: ctx.businessId } },
      select: { id: true },
    });
    if (!variant) throw notFound('Variant', String(req.params.variantId));

    const sold = await prisma.saleItem.count({ where: { variantId: variant.id } });
    if (sold > 0) throw new AppError('ACCOUNT_IN_USE', 'Cannot delete a variant that has been sold');

    await prisma.productVariant.delete({ where: { id: variant.id } });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Stock levels, grouped by product — what the Products list shows
// ---------------------------------------------------------------------------

catalogRouter.get(
  '/products-stock/summary',
  handler(async (req, res) => {
    const ctx = context();
    const { query, skip, take } = listQuery(req);
    const q = query as { search?: string; warehouseId?: string; lowStock?: string };

    const where: Record<string, unknown> = { businessId: ctx.businessId, status: { not: 'ARCHIVED' } };

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, sku: true, price: true, costPrice: true, trackInventory: true,
          allowNegativeStock: true,
          stockLevels: {
            where: q.warehouseId ? { warehouseId: q.warehouseId } : {},
            select: {
              warehouseId: true, qtyOnHand: true, qtyReserved: true, averageCost: true,
              reorderPointMilli: true, reorderQtyMilli: true,
              warehouse: { select: { name: true, code: true } },
            },
          },
        },
      }),
    ]);

    const data = rows.map((product) => {
      const levels = product.stockLevels;
      const onHand = levels.reduce((sum, l) => sum + l.qtyOnHand, 0);
      const reorderPoint = levels.reduce((sum, l) => sum + l.reorderPointMilli, 0);
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        costPrice: product.costPrice,
        trackInventory: product.trackInventory,
        qtyOnHand: onHand,
        stockValue: levels.reduce((sum, l) => sum + Math.round((l.qtyOnHand * l.averageCost) / 1000), 0),
        reorderPoint,
        isLowStock: product.trackInventory && reorderPoint > 0 && onHand <= reorderPoint,
        isOutOfStock: product.trackInventory && onHand <= 0,
        warehouses: levels.map((l) => ({
          warehouseId: l.warehouseId,
          warehouseName: l.warehouse.name,
          qtyOnHand: l.qtyOnHand,
          qtyReserved: l.qtyReserved,
          averageCost: l.averageCost,
        })),
      };
    });

    page(res, data, total, query.page, query.pageSize);
  }),
);

// ---------------------------------------------------------------------------
// Stock adjustments
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  warehouseId: z.string().min(1, 'Choose a warehouse'),
  note: z.string().trim().max(300).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullish(),
        countedQtyMilli: z.number().int().nonnegative('Counted quantity cannot be negative'),
        note: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, 'Add at least one line'),
});

catalogRouter.post(
  '/inventory/adjust',
  handler(async (req, res) => {
    const ctx = context();
    const input = parseBody(adjustSchema, req);
    assertBranchAccess(null);

    const result = await transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, businessId: ctx.businessId },
        select: { id: true, branchId: true, code: true },
      });
      if (!warehouse) throw notFound('Warehouse', input.warehouseId);

      const adjustments = [];

      for (const line of input.lines) {
        const itemKey = itemKeyFor({ productId: line.productId, variantId: line.variantId ?? null });
        const level = await tx.stockLevel.findUnique({
          where: { warehouseId_itemKey: { warehouseId: warehouse.id, itemKey } },
          select: { id: true, qtyOnHand: true, averageCost: true },
        });

        const systemQty = level?.qtyOnHand ?? 0;
        const delta = line.countedQtyMilli - systemQty;
        if (delta === 0) {
          adjustments.push({ ...line, systemQty, countedQty: line.countedQtyMilli, delta: 0, applied: false });
          continue;
        }

        const product = await tx.product.findFirst({
          where: { id: line.productId, businessId: ctx.businessId },
          select: { id: true, trackInventory: true, name: true },
        });
        if (!product) throw notFound('Product', line.productId);

        await applyMove(tx, {
          businessId: ctx.businessId,
          warehouseId: warehouse.id,
          branchId: warehouse.branchId,
          productId: line.productId,
          variantId: line.variantId ?? null,
          type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          qtyMilli: delta,
          unitCost: level?.averageCost ?? 0,
          referenceType: 'ADJUSTMENT',
          note: line.note ?? input.note ?? 'Stocktake adjustment',
          createdById: ctx.userId,
          allowNegative: true,
        });

        adjustments.push({
          ...line,
          systemQty,
          countedQty: line.countedQtyMilli,
          delta,
          applied: true,
        });
      }

      return adjustments;
    });

    ok(res, { adjustments: result, count: result.filter((a) => a.applied).length });
  }),
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
