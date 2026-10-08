import { Router, type Request, type Response } from 'express';
import type { ZodSchema } from 'zod';
import { prisma } from '../db/client.js';
import { handler, ok, created, noContent, parseBody, parseQuery, listQuery, page, translateDbError } from './http.js';
import { context, assertBranchAccess } from './context.js';
import { audit, changedFields } from './audit.js';
import { notFound, AppError } from './errors.js';
import type { AuditEntityType } from '../generated/prisma/enums.js';

/**
 * A small CRUD router factory.
 *
 * Almost every module in an ERP is "list with filters, create, read, update,
 * delete". Writing that out by hand thirty times produces thirty chances to
 * forget tenant scoping or an audit entry, so the pattern is expressed once,
 * here, with the parts that actually differ (validation schemas, search
 * predicate, scoping rule, hooks) supplied per module.
 *
 * What this factory always does, so no module can opt out by accident:
 *   - scopes every query to the acting user's `businessId`
 *   - applies the user's branch restriction
 *   - validates input with Zod before touching the database
 *   - writes an audit row for create, update and delete
 *   - returns a stable envelope shape
 */

export type OrderBy = Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;

export interface CrudOptions<TList, TCreate, TUpdate> {
  /** Path prefix, e.g. '/products'. */
  /** Sub-path within the mounted router. Use '/' for a router mounted at a prefix. */
  path?: string;
  /** Permission required per operation. */
  permissions: {
    create: Parameters<typeof requirePermissionHelper>[0];
    update: Parameters<typeof requirePermissionHelper>[0];
    delete: Parameters<typeof requirePermissionHelper>[0];
  };
  entityType: AuditEntityType;

  listQuerySchema?: ZodSchema<unknown>;
  createSchema: ZodSchema<TCreate>;
  updateSchema: ZodSchema<TUpdate>;

  /** Prisma delegate accessor. */
  model: () => any;
  /** Prisma delegate name used in error messages. */
  modelName: string;

  /** Extra Prisma `where` for the list query, beyond business + branch scope. */
  buildListWhere?: (req: Request, ctxQuery: unknown) => Record<string, unknown>;
  /** Default ordering. */
  orderBy?: OrderBy | ((req: Request) => OrderBy);
  /** Columns returned by list. */
  select?: Record<string, boolean>;
  include?: Record<string, unknown>;

  /** Extra scoping on read/update/delete by id. */
  scopeById?: (id: string, ctx: { businessId: string; branchIds: string[] }) => Record<string, unknown>;

  /** Map validated input to Prisma create data. */
  mapCreate?: (input: TCreate, req: Request) => Record<string, unknown>;
  mapUpdate?: (input: TUpdate, req: Request) => Record<string, unknown>;

  /** Run after creation (e.g. open a stock level row). */
  afterCreate?: (record: any, req: Request) => Promise<void>;
  /** Run before deletion; throw to veto. */
  beforeDelete?: (record: any, req: Request) => Promise<void>;

  /** Soft delete instead of hard delete. */
  softDelete?: { field: string };

  /** Full-text search fields for the `search` query param. */
  searchFields?: string[];
}

function requirePermissionHelper(value: any): any {
  return value;
}

export function crudRoute<TList, TCreate, TUpdate>(options: CrudOptions<TList, TCreate, TUpdate>): Router {
  const router = Router();
  const { path = '/', model, modelName } = options;

  // --- List ----------------------------------------------------------------
  router.get(
    path,
    handler(async (req, res) => {
      const { query, skip, take } = listQuery(req);
      const ctx = context();
      const delegate = model();

      const where: Record<string, unknown> = {
        businessId: ctx.businessId,
        ...(ctx.branchIds.length > 0 ? { branchId: { in: ctx.branchIds } } : {}),
        ...(options.buildListWhere?.(req, query) ?? {}),
      };

      // Case-insensitive contains across the declared search fields.
      if (query.search && options.searchFields?.length) {
        const term = query.search.trim();
        if (term) {
          where.OR = options.searchFields.map((field) => ({
            [field]: { contains: term, mode: 'insensitive' },
          }));
        }
      }

      const orderBy =
        typeof options.orderBy === 'function'
          ? options.orderBy(req)
          : (options.orderBy ?? { createdAt: 'desc' });

      try {
        const [rows, total] = await Promise.all([
          delegate.findMany({
            where,
            orderBy,
            skip,
            take,
            ...(options.select ? { select: options.select } : {}),
            ...(options.include ? { include: options.include } : {}),
          }),
          delegate.count({ where }),
        ]);
        page(res as Response, rows, total, query.page, query.pageSize);
      } catch (error) {
        translateDbError(error);
      }
    }),
  );

  // --- Read one ------------------------------------------------------------
  router.get(
    `${path}/:id`,
    handler(async (req, res) => {
      const record = await findById(options, String(req.params.id));
      ok(res, record);
    }),
  );

  // --- Create --------------------------------------------------------------
  router.post(
    path,
    handler(async (req, res) => {
      const input = parseBody(options.createSchema, req) as TCreate;
      const ctx = context();
      const data = {
        ...(options.mapCreate ? options.mapCreate(input, req) : (input as Record<string, unknown>)),
        businessId: ctx.businessId,
      };

      try {
        const record = await model().create({ data });
        if (options.afterCreate) await options.afterCreate(record, req);

        await audit(prisma as never, {
          action: 'CREATE',
          entityType: options.entityType,
          entityId: record.id,
          entityCode: record.code ?? null,
          after: { ...data } as Record<string, unknown>,
        });

        created(res, record);
      } catch (error) {
        translateDbError(error);
      }
    }),
  );

  // --- Update --------------------------------------------------------------
  router.patch(
    `${path}/:id`,
    handler(async (req, res) => {
      const before = await findById(options, String(req.params.id));
      const input = parseBody(options.updateSchema, req) as TUpdate;
      const data = options.mapUpdate ? options.mapUpdate(input, req) : (input as Record<string, unknown>);

      try {
        const record = await model().update({
          where: { id: String(req.params.id) },
          data,
        });

        const changes = changedFields(before as Record<string, unknown>, record as Record<string, unknown>);
        if (Object.keys(changes).length > 0) {
          await audit(prisma as never, {
            action: 'UPDATE',
            entityType: options.entityType,
            entityId: record.id,
            entityCode: record.code ?? null,
            before: pickFields(before, Object.keys(changes)),
            after: pickFields(record, Object.keys(changes)),
          });
        }

        ok(res, record);
      } catch (error) {
        translateDbError(error);
      }
    }),
  );

  // --- Delete --------------------------------------------------------------
  router.delete(
    `${path}/:id`,
    handler(async (req, res) => {
      const record = await findById(options, String(req.params.id));
      if (options.beforeDelete) await options.beforeDelete(record, req);

      try {
        if (options.softDelete) {
          await model().update({
            where: { id: String(req.params.id) },
            data: { [options.softDelete.field]: false },
          });
        } else {
          await model().delete({ where: { id: req.params.id! } });
        }

        await audit(prisma as never, {
          action: 'DELETE',
          entityType: options.entityType,
          entityId: String(req.params.id),
          entityCode: record.code ?? null,
          before: { deleted: true } as Record<string, unknown>,
        });

        noContent(res);
      } catch (error) {
        translateDbError(error);
      }
    }),
  );

  return router;
}

/** Load one record with the same scoping rules as the list endpoint. */
async function findById(options: CrudOptions<any, any, any>, id: string) {
  const ctx = context();
  const delegate = options.model();

  const record = await delegate.findFirst({
    where: {
      id,
      businessId: ctx.businessId,
      ...(options.scopeById?.(id, { businessId: ctx.businessId, branchIds: ctx.branchIds }) ?? {}),
    },
    ...(options.select ? { select: options.select } : {}),
    ...(options.include ? { include: options.include } : {}),
  });

  if (!record) throw notFound(options.modelName, id);
  return record;
}

function pickFields(record: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!record || typeof record !== 'object') return out;
  const source = record as Record<string, unknown>;
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

/**
 * Build a `where` clause from simple query filters.
 * Keeps list endpoints declarative instead of a wall of `if` statements.
 */
export function filtersFromQuery(
  query: Record<string, unknown>,
  mapping: Record<string, { field: string; op?: 'equals' | 'in' | 'gte' | 'lte' | 'contains' }>,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const [param, spec] of Object.entries(mapping)) {
    const value = query[param];
    if (value === undefined || value === null || value === '') continue;
    switch (spec.op ?? 'equals') {
      case 'in':
        where[spec.field] = { in: String(value).split(',').filter(Boolean) };
        break;
      case 'gte':
        where[spec.field] = { gte: value };
        break;
      case 'lte':
        where[spec.field] = { lte: value };
        break;
      case 'contains':
        where[spec.field] = { contains: String(value), mode: 'insensitive' };
        break;
      default:
        where[spec.field] = value;
    }
  }
  return where;
}

export { assertBranchAccess, AppError };
