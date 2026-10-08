import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodSchema } from 'zod';
import { AppError, validation } from './errors.js';
import { paginate, normalizeListQuery, type ListQuery, type Paginated } from '@monopos/shared';

/**
 * HTTP plumbing: async error propagation, response shaping and validation.
 */

/**
 * Wrap an async handler so a rejected promise reaches Express's error pipeline.
 *
 * Express 5 forwards rejections from async handlers automatically, but the
 * wrapper is kept because it also types `next` and makes the intent explicit at
 * every call site — and it keeps the handlers working if this is ever ported to
 * Express 4.
 */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: Envelope<T> = { data };
  if (meta) body.meta = meta;
  res.json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  res.status(201);
  ok(res, data, meta);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

/** Query-string validation. Invalid input is a 422, never a silent default. */
export function parseQuery<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.query);
  if (!result.success) throw toValidationError(result.error);
  return result.data;
}

export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) throw toValidationError(result.error);
  return result.data;
}

export function toValidationError(error: ZodError): AppError {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (details[key] ??= []).push(issue.message);
  }
  return validation('The submitted data is invalid', details);
}

/**
 * Normalise and bound a paginated list query, returning both the Prisma args
 * and the page metadata helper.
 */
export function listQuery(req: Request): {
  query: Required<Pick<ListQuery, 'page' | 'pageSize'>> & ListQuery;
  skip: number;
  take: number;
} {
  const query = normalizeListQuery(req.query as ListQuery);
  return { query, skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function page<T>(res: Response, rows: T[], total: number, page: number, pageSize: number): void {
  ok(res, paginate(rows, total, page, pageSize).data, paginate(rows, total, page, pageSize).meta);
}

/**
 * A `to` date for range filters.
 *
 * A bare date (`2026-10-08`) parses to midnight, which would silently exclude
 * everything that happened during that day — including, on a `To = today`
 * filter, every sale the shop has made. Extending to end of day makes the range
 * inclusive the way every user expects, without the client having to send a
 * timestamp it does not have.
 */
export const toDateSchema = z.coerce
  .date()
  .transform((date) => new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999,
  )));

/**
 * Translate a known Postgres/Prisma error into the right typed application
 * error. Unrecognised errors are left to bubble up as 500s.
 */
export function translateDbError(error: unknown): never {
  if (error instanceof AppError) throw error;

  const e = error as { code?: string; meta?: { target?: string[]; field_name?: string } };

  switch (e?.code) {
    case 'P2002': {
      const target = e.meta?.target ?? [];
      const fields = Array.isArray(target) ? target.join(', ') : String(target);
      throw new AppError('DUPLICATE', `That value is already in use${fields ? ` (${fields})` : ''}`, {
        cause: error,
      });
    }
    case 'P2003':
      throw new AppError(
        'CONFLICT',
        'This record is still referenced by other records and cannot be changed',
        { cause: error },
      );
    case 'P2025':
      throw new AppError('NOT_FOUND', 'The record you tried to change no longer exists', {
        cause: error,
      });
    case '23505':
      throw new AppError('DUPLICATE', 'That value is already in use', { cause: error });
    case '23503':
      throw new AppError('CONFLICT', 'A related record does not exist', { cause: error });
    case '23514':
      throw new AppError('UNPROCESSABLE', 'A database constraint rejected these values', {
        cause: error,
      });
    case '40001':
    case '40P01':
      throw new AppError('CONFLICT', 'The record was modified concurrently — please retry', {
        cause: error,
      });
    default:
      throw error;
  }
}
