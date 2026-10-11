import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma, disconnect } from './db/client.js';

/**
 * Server entrypoint.
 *
 * Shutdown is handled explicitly: in-flight HTTP requests are allowed to
 * finish, then the database pool is closed. Without that, a `docker restart`
 * during a busy minute would abort transactions mid-sale and leave the till's
 * idempotency records half written.
 */

const app = createApp();

/**
 * Wait for the database with bounded retries instead of exiting on the first
 * failed query. A managed Postgres (Prisma Postgres and friends) suspends an
 * idle database and the first connection after a cold start can time out while
 * it wakes — a fail-fast boot there turns a few-second warm-up into a crash
 * loop, and the proxy in front serves 502 the whole time. The HTTP server is
 * already listening (this runs in the `listen` callback), so liveness probes
 * pass while we wait; readiness at /api/v1/health reports the real state.
 */
async function waitForDatabase(): Promise<void> {
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('[monopos] database connected');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[monopos] database not ready (attempt ${attempt}/${maxAttempts}): ${message}`);
      if (attempt === maxAttempts) {
        console.error('[monopos] database still unreachable after retries; serving anyway, queries will retry on demand');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

const server = app.listen(env.port, env.host, () => {
  console.log(`[monopos] API listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
  void waitForDatabase();
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[monopos] ${signal} received, shutting down…`);

  // Stop accepting new connections, then drain.
  const forced = setTimeout(() => {
    console.error('[monopos] forced shutdown after 10s');
    process.exit(1);
  }, 10_000);
  forced.unref();

  server.close(async () => {
    try {
      await disconnect();
      console.log('[monopos] shut down cleanly');
      process.exit(0);
    } catch (error) {
      console.error('[monopos] error during shutdown', error);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[monopos] unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  // An uncaught exception leaves the process in an unknown state. Log it and
  // let the supervisor restart us rather than limping on.
  console.error('[monopos] uncaught exception', error);
  void shutdown('uncaughtException');
});
