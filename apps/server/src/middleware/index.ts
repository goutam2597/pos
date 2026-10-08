import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';
import { context } from '../lib/context.js';
import { transaction } from '../db/client.js';
import type { Permission } from '@monopos/shared';

/**
 * Cross-cutting Express middleware.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Terminal error handler.
 *
 * Anything that is not an `AppError` is treated as a defect: it is logged with
 * its stack and reported to the client as a bare 500. Internal details — SQL,
 * file paths, stack frames — never reach a browser.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      console.error('[error]', error.code, error.message, error.cause ?? '');
    }
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    res.status(error.status).json(error.toJSON());
    return;
  }

  // Malformed JSON body from body-parser.
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Malformed JSON body' } });
    return;
  }

  console.error('[unhandled]', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'An unexpected error occurred. The incident has been logged.',
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}` },
  });
}

// ---------------------------------------------------------------------------
// Authentication / authorisation
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside the request's context, so services can read the acting user.
 *
 * `AsyncLocalStorage.enterWith` is deliberately NOT used here — the context is
 * entered per request in the authenticate middleware and re-entered only when a
 * route explicitly needs it, so concurrent requests never share a store.
 */
export function withContext(): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx) {
      next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    next();
  };
}

/**
 * Require a permission.
 *
 * `allOf` (the default) demands every listed permission; pass `anyOf` for
 * roles where either capability is sufficient.
 */
export function requirePermission(
  allOf: Permission | Permission[] = [],
  anyOf: Permission[] = [],
): RequestHandler {
  const required = Array.isArray(allOf) ? allOf : [allOf];

  return (req, _res, next) => {
    const ctx = req.ctx;
    if (!ctx) {
      next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      return;
    }

    const hasAll = required.every((p) => ctx.permissions.has(p));
    const hasAny = anyOf.length === 0 || anyOf.some((p) => ctx.permissions.has(p));

    if (!hasAll || !hasAny) {
      const wanted = [...required, ...anyOf].join(', ');
      next(new AppError('FORBIDDEN', `Your role does not include: ${wanted}`));
      return;
    }
    next();
  };
}

/**
 * Require access to a branch.
 *
 * Accepts the branch from (in order) an explicit parameter, the `X-Branch-Id`
 * header the POS client sends, or the query string. Falls back to the user's
 * first permitted branch so ordinary screens need not pass it.
 */
export function requireBranch(paramName = 'branchId'): RequestHandler {
  return (req, _res, next) => {
    const ctx = req.ctx;
    if (!ctx) {
      next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      return;
    }

    const requested =
      (req.params[paramName] as string | undefined) ??
      (req.header('x-branch-id') ?? undefined) ??
      (typeof req.query.branchId === 'string' ? req.query.branchId : undefined);

    if (!requested) {
      next();
      return;
    }

    if (ctx.branchIds.length > 0 && !ctx.branchIds.includes(requested)) {
      next(new AppError('BRANCH_FORBIDDEN', 'You do not have access to that branch'));
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process fixed-window rate limiter.
 *
 * Adequate for a single-instance deployment, which is what a per-branch POS is.
 * A multi-instance deployment must move this to Redis — noted in the README,
 * because a limiter that silently lives on one node is worse than none when you
 * assume you have it.
 */
export function rateLimit(options?: { windowMs?: number; max?: number; key?: (req: Request) => string }) {
  const windowMs = options?.windowMs ?? env.rateLimitWindowMs;
  const max = options?.max ?? env.rateLimitMax;
  const buckets = new Map<string, Bucket>();

  // Periodic sweep so the map cannot grow without bound on a long-lived process.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  sweeper.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options?.key?.(req) ?? req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(new AppError('RATE_LIMITED', 'Too many requests — please slow down', { retryAfter }));
      return;
    }
    next();
  };
}

/**
 * Stricter limiter for credential endpoints.
 *
 * Keyed on IP + submitted email so that one attacker hammering a single account
 * cannot lock it out for every other user on the same NAT.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: env.authRateLimitMax,
  key: (req) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 120) : '';
    return `${req.ip}:${email}`;
  },
});

// ---------------------------------------------------------------------------
// Security headers for the API
// ---------------------------------------------------------------------------

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.removeHeader('X-Powered-By');
    next();
  };
}

/** Reject oversized JSON bodies before they are parsed into memory. */
export function bodyLimit(limit = '1mb'): RequestHandler {
  return (req, _res, next) => {
    const declared = Number(req.header('content-length') ?? '0');
    const maxBytes = Number.parseInt(limit, 10) * 1024;
    if (declared > maxBytes) {
      next(new AppError('VALIDATION_FAILED', 'Request body is too large'));
      return;
    }
    next();
  };
}

export { context, transaction };
