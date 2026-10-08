import type { Request } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { forbidden, unauthenticated } from './errors.js';
import type { Permission } from '@monopos/shared';

/**
 * Per-request context.
 *
 * Services need to know who is acting and, critically, WHICH transaction and
 * device an operation belongs to. Threading those through every function
 * signature would be noisy, so an AsyncLocalStorage context carries them.
 *
 * This is safe under async/await: each request gets its own store, and any
 * concurrent request sees only its own values.
 */

export interface RequestContext {
  userId: string;
  businessId: string;
  email: string;
  sessionId: string;
  /** Effective permission set, snapshotted at login. */
  permissions: Set<Permission>;
  /**
   * Branch ids the user may act in. An EMPTY array means "all branches" and is
   * why the check below tests `length === 0` first.
   */
  branchIds: string[];
  /** Set on requests originating from an offline POS replay. */
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function context(): RequestContext {
  const current = storage.getStore();
  if (!current) {
    // Reaching here means a service was called outside a request (a seed script
    // or a background job). Failing loudly beats silently acting as nobody.
    throw new Error('No request context available — wrap this call in runWithContext()');
  }
  return current;
}

export function tryContext(): RequestContext | undefined {
  return storage.getStore();
}

// --- Express plumbing ------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: RequestContext;
      /** Present only for offline POS sync requests. */
      deviceId?: string;
    }
  }
}

export function attachContext(req: Request): void {
  const context = req.ctx;
  if (!context) {
    throw unauthenticated();
  }
  // Re-entrant for nested `service()` calls: the module-level `context()` is the
  // documented accessor, and this keeps that working inside an existing request.
  storage.enterWith(context);
}

export function can(permission: Permission): boolean {
  return context().permissions.has(permission);
}

export function assertCan(permission: Permission): void {
  if (!can(permission)) {
    throw forbidden(`Your role does not include the "${permission}" permission`);
  }
}

export function assertAnyCan(permissions: Permission[]): void {
  if (!permissions.some((p) => can(p))) {
    throw forbidden(`Your role does not include any of: ${permissions.join(', ')}`);
  }
}

/**
 * Assert the acting user may operate in `branchId`.
 *
 * This is the multi-branch guard. It is enforced in the service layer rather
 * than only in routes, because a sale posted to the wrong branch silently
 * corrupts branch-level reporting.
 */
export function assertBranchAccess(branchId: string | null | undefined): void {
  if (!branchId) return;
  const { branchIds } = context();
  if (branchIds.length === 0) return; // unrestricted
  if (!branchIds.includes(branchId)) {
    throw forbidden('You do not have access to that branch');
  }
}

export function assertOwns<T extends { businessId: string }>(record: T): void {
  if (record.businessId !== context().businessId) {
    // Deliberately 404 rather than 403: confirming the existence of another
    // tenant's record is itself an information leak.
    throw unauthenticated('Record not found');
  }
}
