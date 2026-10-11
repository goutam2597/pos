# Prisma 8 migration status

## Current state

**Phases 1–2 of the official upgrade guide are complete.** Both clients are
installed and working side by side:

| Package | Version | Role |
|---|---|---|
| `prisma` (CLI) | 8.0.0-rc.21 | v8 contract + database tooling; satisfies the deploy platform's version check |
| `tools/prisma7` | 7.10.0 | v7 CLI in an **isolated install** (`npm run db:generate` / `db:push` / `db:migrate` / `db:studio` route through `tools/prisma7/run.mjs`) — the v8 CLI dropped these commands |
| `@prisma/client` | 7.10.0 | runtime for the existing data layer (`src/generated/prisma`) |
| `@prisma/adapter-pg` | 7.10.0 | driver adapter for the v7 client |
| `@prisma/orm-postgres` | 8.0.0-rc.16 | v8 runtime (`src/prisma/db.ts`) |

**Why the v7 CLI is isolated:** the deploy platform (Prisma's own) asserts
`effect@4.0.0-rc.115` as the *only* effect version in the workspace tree (its
Composer 0.28.0 pins it exactly, enforced via the root `overrides`). The v7
CLI's config loader (`@prisma/config@7.10.0`) requires `effect@3.20.0` and
crashes under the v4 RC, so it cannot live in the workspace tree.
`tools/prisma7` is deliberately not an npm workspace — it has its own
`node_modules` with `effect@3.20.0`. `tools/prisma7/run.mjs` loads
`apps/server/.env` and passes `--schema` explicitly, so the v7 CLI runs in
legacy mode with no config file (the old `prisma7.config.ts` is gone).

Two config files, as the guide requires:
- `prisma.config.ts` — v8 shape, imports `@prisma/cli-engine` + `@prisma/orm-postgres/config`
- (v7 config removed — replaced by `tools/prisma7/run.mjs` legacy-mode invocation)

`prisma contract emit` succeeds; `prisma db update` confirms the live database
matches the contract across all 57 tables.

## Phase 3 progress

### What works on the current RC packages (verified against the live DB)

```ts
db.orm.public.Sale
  .where({ status: 'COMPLETED' })
  .orderBy(s => s.id.asc())
  .limit(1).offset(1)
  .all()
```

`all`, `where`, `orderBy`, `limit`, `offset`, `include`, `create`, and
`db.transaction()` all work.

### What does NOT work on the current RC packages

| Capability | Status | What it blocks |
|---|---|---|
| `select({...})` | **broken** — `identifier.includes is not a function` inside the RC's SQL quoting code | column projection on every read |
| `count()` | **unavailable** — only inside `include()` refinement callbacks | pagination metadata on ~30 list routes |
| `aggregate` / `groupBy` | **unavailable** | all reports, dashboard KPIs, trial balance |
| `$queryRaw` | **different API** — `db.raw` exists but is untested against `FOR UPDATE` row locking | stock-level row locking, document-number claiming (`nextNumber`) |
| DateTime fields | **arrive as strings, not `Date`** when v8 reads a v7 schema | fiscal-period locking, shift reconciliation, report bucketing |

### Why most routes are blocked

Nearly every route in this codebase needs at least one of the above. For
example, a paginated list route needs `count()` for `meta.total`; a report needs
`aggregate`; any financial write needs `nextNumber`, which claims document
numbers with `SELECT ... FOR UPDATE`.

The root cause is a **version skew inside Prisma's own release candidates**: the
CLI is at `rc.21` but the latest published `@prisma/orm-postgres` runtime is
`rc.16`. The `select` failure is internal to their code (`quoteIdentifier`
receiving a non-string), not to this repository.

## Phase 3 begun — parity proof

`scripts/prisma8-parity.ts` fetches the same completed sale through BOTH clients
and asserts business-data parity. **11/11 checks pass**:

- same sale code, total, tax total, branch
- aggregate parity (sum of totals matches)
- DateTime confirmed to arrive as a timezone-less string
- parsing it naively shifts the instant by the machine's UTC offset — confirmed,
  and handled by pinning to UTC before comparison

That script is the gate every migrated route must pass.

## Path forward

1. When Prisma publishes a matching runtime (rc.17+ aligned with the rc.21
   contract format), re-run this probe:
   `node --experimental-strip-types -e "import('./src/prisma/db.ts').then(m => m.db.orm.public.Sale.select({code:true}).limit(1).all()).then(r => console.log(r))"`
2. Migrate in this order, lowest risk first:
   1. Read-only helpers that need no `count`/`aggregate`
   2. Auth/session service (findUnique + create + update only)
   3. Inventory reads
   4. Financial services (sales, ledger, sync) — last, and each behind its e2e check
3. Audit every date comparison as routes move (string vs `Date`).
4. After all routes move: remove `@prisma/client`, `@prisma/adapter-pg`,
   `tools/prisma7`, and `src/generated/prisma`.

## Verification

- `npm run db:generate` regenerates the v7 client (via `tools/prisma7/run.mjs`; the client is committed to git so platform builds don't need the tools install)
- `npx prisma contract emit` regenerates the v8 contract
- `npm run verify -w @monopos/server` runs the 48-check e2e suite
- `npx tsx scripts/pricing-parity.ts` verifies client/server pricing agreement
