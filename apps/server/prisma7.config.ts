import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from '@prisma/prisma7/config';

/**
 * Prisma 7 moved connection strings out of `schema.prisma` and into this file.
 *
 * Note the division of responsibility:
 *   * Migrate/studio read `datasource.url` below.
 *   * The application runtime NEVER reads this file — it constructs its client
 *     with a driver adapter in `src/db/client.ts`, which is what actually opens
 *     pooled connections in production.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
