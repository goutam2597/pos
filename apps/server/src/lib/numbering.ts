import type { Tx } from '../db/client.js';
import { AppError } from './errors.js';

/**
 * Document numbering.
 *
 * Every human-facing document needs a number an accountant will accept: unique,
 * sequential, and with no reuse. The counter lives in `DocumentSequence` and is
 * claimed inside the caller's transaction under a row lock, so two cashiers
 * ringing up at the same instant can never be handed the same invoice number.
 *
 * The alternative — `count() + 1` — is a classic race: two concurrent reads
 * both see N and both write N+1. That is why this uses `SELECT ... FOR UPDATE`.
 */

export type SequenceType =
  | 'SALE'
  | 'INVOICE'
  | 'PURCHASE'
  | 'RETURN'
  | 'EXPENSE'
  | 'PAYMENT'
  | 'SHIFT'
  | 'TRANSFER'
  | 'COUNT'
  | 'CUSTOMER'
  | 'SUPPLIER'
  | 'JOURNAL';

export interface SequenceScope {
  businessId: string;
  branchId?: string | null;
  registerId?: string | null;
}

/**
 * Scope strings for the unique index. NULL columns cannot be used directly
 * because SQL treats every NULL as distinct, so the scope is collapsed into one
 * non-null key (see the `scopeKey` column on `DocumentSequence`).
 */
export function scopeKeyFor(branchId?: string | null, registerId?: string | null): string {
  if (registerId) return `REGISTER:${registerId}`;
  if (branchId) return `BRANCH:${branchId}`;
  return 'GLOBAL';
}

const DEFAULT_PREFIXES: Record<SequenceType, string> = {
  SALE: 'SALE',
  INVOICE: 'INV',
  PURCHASE: 'PUR',
  RETURN: 'RET',
  EXPENSE: 'EXP',
  PAYMENT: 'PAY',
  SHIFT: 'SHFT',
  TRANSFER: 'TRF',
  COUNT: 'CNT',
  CUSTOMER: 'CUS',
  SUPPLIER: 'SUP',
  JOURNAL: 'JE',
};

export interface NextNumberOptions extends SequenceScope {
  type: SequenceType;
  /** Override the configured prefix for this document. */
  prefix?: string;
  padding?: number;
}

/**
 * Claim the next number in a sequence.
 *
 * MUST be called with the transaction that creates the document. If that
 * transaction rolls back, the number is released along with the document — which
 * is correct, and is why the counter is a row rather than a Postgres sequence
 * (a sequence would leave gaps on every failed transaction).
 */
export async function nextNumber(tx: Tx, options: NextNumberOptions): Promise<string> {
  const scopeKey = scopeKeyFor(options.branchId, options.registerId);
  const prefix = options.prefix ?? DEFAULT_PREFIXES[options.type];
  const padding = options.padding ?? 6;

  // Create the sequence row on first use — seeded past everything ever issued.
  // Codes are unique across the whole BUSINESS while buckets are per
  // branch/register: a new bucket starting at 1 would re-issue numbers another
  // bucket already spent, and the document create would die on the unique
  // constraint. Gaps between buckets are fine; reissued numbers are not.
  const seeded = await tx.$queryRaw<Array<{ next: number }>>`
    SELECT COALESCE(MAX("nextValue"), 0) + 1 AS next
      FROM "DocumentSequence"
     WHERE "businessId" = ${options.businessId} AND "type" = ${options.type}
  `;
  const seedNextValue = Number(seeded[0]?.next ?? 1) || 1;

  await tx.documentSequence.upsert({
    where: {
      businessId_type_scopeKey: {
        businessId: options.businessId,
        type: options.type,
        scopeKey,
      },
    },
    create: {
      businessId: options.businessId,
      branchId: options.branchId ?? null,
      registerId: options.registerId ?? null,
      scopeKey,
      type: options.type,
      prefix,
      padding,
      nextValue: seedNextValue,
    },
    update: {},
  });

  // Lock the counter, then read and increment it atomically.
  // Prisma's tagged template parameterises these values — no interpolation.
  const rows = await tx.$queryRaw<
    Array<{
      nextValue: number;
      prefix: string;
      padding: number;
      resetYearly: boolean;
      lastYear: number | null;
    }>
  >`
    SELECT "nextValue", prefix, padding, "resetYearly", "lastYear"
      FROM "DocumentSequence"
     WHERE "businessId" = ${options.businessId}
       AND type = ${options.type}
       AND "scopeKey" = ${scopeKey}
     FOR UPDATE
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError('INTERNAL', 'Failed to allocate a document number');
  }

  const currentYear = new Date().getUTCFullYear();
  let nextValue = row.nextValue;
  let lastYear = row.lastYear;

  // Yearly reset: the counter restarts at 1 each January, and the year is
  // recorded so a back-dated document still lands in the right stream.
  if (row.resetYearly && lastYear !== currentYear) {
    nextValue = 1;
    lastYear = currentYear;
  }

  const code = `${row.prefix}${String(nextValue).padStart(row.padding, '0')}`;

  await tx.documentSequence.update({
    where: {
      businessId_type_scopeKey: {
        businessId: options.businessId,
        type: options.type,
        scopeKey,
      },
    },
    data: { nextValue: { increment: 1 }, lastYear },
  });

  return code;
}
