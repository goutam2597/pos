// Runs the isolated Prisma 7 CLI from tools/prisma7 with apps/server's env.
//
// The v7 CLI cannot run inside the workspace tree: the deploy platform's setup
// forces effect@4.0.0-rc.115 as the only allowed effect version, while the v7
// config loader (@prisma/config@7.10.0) requires effect@3.20.0. This runner
// keeps the CLI out of that tree and injects apps/server/.env itself, so no
// config file is needed and the CLI runs in legacy mode.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..', '..', 'apps', 'server');
dotenv.config({ path: path.join(serverDir, '.env') });

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node tools/prisma7/run.mjs <prisma7 args...>');
  process.exit(2);
}

const schema = path.join(serverDir, 'prisma', 'schema.prisma');
const finalArgs = args.includes('--schema') ? args : [...args, '--schema', schema];

const bin = path.join(here, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma7.CMD' : 'prisma7');
const res = spawnSync(bin, finalArgs, { stdio: 'inherit', cwd: here, shell: process.platform === 'win32' });
process.exit(res.status ?? 1);
