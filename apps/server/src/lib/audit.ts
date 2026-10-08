import type { Tx } from '../db/client.js';
import { prisma } from '../db/client.js';
import { tryContext } from './context.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuditAction, AuditEntityType } from '../generated/prisma/enums.js';

/**
 * Audit trail.
 *
 * Records WHO changed WHAT, WHEN, from WHERE — including changes that
 * originated on an offline terminal, which is why `deviceId` is captured
 * separately from the session user.
 *
 * Two rules keep this useful rather than a firehose nobody queries:
 *
 *   1. Audit rows are written inside the same transaction as the change they
 *      describe. An audit entry that could survive a rolled-back transaction
 *      would be worse than useless — it would be evidence of something that
 *      never happened.
 *   2. Only the fields that actually changed are stored, as a `before`/`after`
 *      diff. Storing whole records would bloat the table to the point where it
 *      stops being queryable.
 */

export interface AuditInput {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  entityCode?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Fields to exclude entirely — password hashes, tokens, raw payloads. */
  redact?: string[];
  deviceId?: string | null;
}

const DEFAULT_REDACT = ['passwordHash', 'password', 'token', 'refreshToken', 'secret'];

/**
 * Write an audit row within an existing transaction.
 *
 * Use this from service code so the log commits atomically with the change.
 */
export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  const ctx = tryContext();

  await tx.auditLog.create({
    data: {
      businessId: ctx?.businessId ?? '',
      userId: ctx?.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityCode: input.entityCode ?? null,
      before: input.before ? sanitise(input.before, input.redact) : undefined,
      after: input.after ? sanitise(input.after, input.redact) : undefined,
      changes: diff(input.before, input.after),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      deviceId: input.deviceId ?? ctx?.deviceId ?? null,
    },
  });
}

/**
 * Write an audit row outside any transaction.
 *
 * Only appropriate for events that are not part of a business transaction —
 * login attempts, health checks, rejected requests.
 */
export async function auditStandalone(input: AuditInput & { businessId: string; userId?: string | null }): Promise<void> {
  await prisma.auditLog.create({
    data: {
      businessId: input.businessId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityCode: input.entityCode ?? null,
      before: input.before ? sanitise(input.before, input.redact) : undefined,
      after: input.after ? sanitise(input.after, input.redact) : undefined,
      changes: diff(input.before, input.after),
      ip: tryContext()?.ip ?? null,
      userAgent: tryContext()?.userAgent ?? null,
      deviceId: input.deviceId ?? null,
    },
  });
}

function sanitise(record: Record<string, unknown>, redact?: string[]): Prisma.InputJsonValue {
  const blocked = new Set([...DEFAULT_REDACT, ...(redact ?? [])]);
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = blocked.has(key) ? '[redacted]' : (normalise(value) as Prisma.InputJsonValue);
  }
  return out;
}

/** Make a value JSON-safe: Dates to ISO strings, BigInt to string. */
function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalise(v);
    return out;
  }
  return value;
}

/** Field-level difference between two records. */
function diff(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!before || !after) return undefined;
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = normalise(before[key]);
    const to = normalise(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from: from as Prisma.InputJsonValue, to: to as Prisma.InputJsonValue };
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * Fields that differ between two versions of a record, for update auditing.
 * Excludes `updatedAt`, which changes on every write and carries no meaning.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const raw = diff(before, after);
  const result: Record<string, { from: unknown; to: unknown }> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      result[key] = value as { from: unknown; to: unknown };
    }
  }
  // `updatedAt` changes on every write and carries no audit signal.
  delete result.updatedAt;
  return result;
}
