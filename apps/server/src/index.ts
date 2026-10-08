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

const server = app.listen(env.port, env.host, async () => {
  // Fail fast if the database is unreachable — better than accepting traffic
  // that will fail on the first query.
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`[monopos] API listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
    console.log(`[monopos] database connected`);
  } catch (error) {
    console.error('[monopos] FATAL: cannot reach the database', error);
    process.exit(1);
  }
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
