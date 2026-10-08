import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

/** Prisma 8 client. Coexists with the Prisma 7 client during migration. */
export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
