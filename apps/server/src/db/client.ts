import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/**
 * Prisma client construction.
 *
 * Prisma 7 has no built-in Rust query engine; queries are compiled by a WASM
 * query compiler and executed over a driver adapter. `PrismaPg` wraps a
 * `pg.Pool`, which means connection pooling, timeouts and statement limits are
 * ours to configure rather than Prisma's defaults — which matters for an
 * application whose hot path is a transaction per sale.
 */
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: env.isProduction ? 20 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // NOTE: do not set `statement_timeout` here. node-postgres sends it as a
  // startup parameter, and managed poolers (Prisma Postgres' pgbouncer-style
  // pooler) reject the whole connection with "Failed to connect to upstream
  // database" when the startup packet carries it. The query backstop it gave
  // us is better enforced server-side on the database role, or per-session via
  // `SET statement_timeout`, neither of which breaks pooled connections.
  application_name: 'monopos-server',
});

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'query' },
    ...(env.logLevel === 'debug' && !env.isProduction
      ? ([{ emit: 'stdout', level: 'query' }] as const)
      : []),
    ...(env.logLevel === 'debug' || env.logLevel === 'warn'
      ? ([{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }] as const)
      : []),
  ],
});

/**
 * Slow-query logging.
 *
 * A POS sale is a handful of small writes and must not exceed a few hundred
 * milliseconds end to end. Anything past this threshold is a bug worth seeing
 * in development, not something to discover in production from a support call.
 */
const SLOW_QUERY_MS = 250;

if (!env.isTest) {
  const target = prisma as unknown as {
    $on: (event: string, cb: (e: { duration: number; query: string }) => void) => void;
  };
  target.$on('query', (e) => {
    if (e.duration >= SLOW_QUERY_MS) {
      console.warn(
        `[prisma] slow query ${e.duration}ms: ${e.query.slice(0, 300)}`,
      );
    }
  });
}

/**
 * Run `fn` inside a transaction.
 *
 * Every financial or inventory mutation in this codebase goes through here.
 *
 * Three properties matter and are relied upon throughout:
 *
 *  1. **Isolation.** The default (Postgres READ COMMITTED) is sufficient because
 *     all contention is on explicitly locked rows — stock levels via
 *     `SELECT ... FOR UPDATE`, and document numbering via a locked sequence row.
 *     Escalating to SERIALIZABLE would add retry storms for no extra safety.
 *  2. **A single connection.** `fn` must only touch the `tx` client. Using the
 *     module-level `prisma` inside a transaction silently escapes it and breaks
 *     atomicity; that is the single easiest way to corrupt this system.
 *  3. **Bounded retries.** Serialization failures and deadlocks are retried with
 *     backoff, because they are transient and a cashier should never see one.
 */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const MAX_TX_ATTEMPTS = 3;

/** Postgres SQLSTATE codes worth retrying rather than surfacing. */
const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE_PG_CODES.has(code);
}

export async function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; isolationLevel?: Tx extends never ? never : 'ReadCommitted' | 'RepeatableRead' | 'Serializable' },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => fn(tx as Tx), {
        maxWait: options?.maxWait ?? 10_000,
        timeout: options?.timeout ?? 20_000,
        // Intentionally left at the driver default (READ COMMITTED) — see above.
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_TX_ATTEMPTS) throw error;
      // Linear-ish backoff with jitter; these waits are sub-second.
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }

  throw lastError;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export * from '../generated/prisma/client.js';
