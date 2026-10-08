# MonoPOS

**A complete Point of Sale, Inventory, ERP, Online & Offline POS, Invoicing, Accounting and Business Management Platform.**

MonoPOS is not a cash-register app with a product table bolted on. It is a business
operating system in which selling something, buying stock, paying a supplier and
paying rent all flow through the same double-entry ledger, and all of it keeps
working when the internet does not.

---

## What makes it different

Most POS products are "record a sale, print a receipt". This one is built around
four commitments, and every one of them is enforced by code rather than by
convention:

### 1. Money is never a floating-point number

Every amount in this system — in the database, over the wire, in the browser, in
the ledger — is an **integer number of minor units** (cents, paisa, fils). There
is no `float` anywhere in the financial path.

Quantities follow the same discipline as **integer milli-units**, so 1.5 kg of
apples is exactly `1500` and never drifts after ten thousand additions.

This is enforced in `packages/shared/src/money.ts` and `quantity.ts`, which every
other package depends on. It is the single most important correctness decision in
the codebase: `0.1 + 0.2 !== 0.3` is unacceptable in a ledger, and a bookkeeper
who finds a penny missing stops trusting the whole system.

### 2. A sale is one transaction, not five

Ringing up a basket produces, inside a **single database transaction**:

```
Sale → SaleItem[] → Invoice → Payment[]
     → StockMove[]      (stock down)
     → JournalEntry     revenue + tax + cash/AR
     → JournalEntry     cost of goods sold + inventory
```

Either all of it exists or none of it does. A crash halfway through cannot leave a
customer charged for goods that were never deducted, or stock decremented with no
revenue recorded — the two failure modes that make a POS unusable at month end.

### 3. The books are the source of truth

Reports do not recompute revenue from the sales table, and no module stores a
"total" that the journal does not already imply. The P&L, balance sheet, trial
balance and AR/AP ageing are all derived from the ledger at query time.

Journals are **append-only**. A mistake is corrected by posting a *reversing*
entry linked to the original, never by editing it — so the audit trail shows both
what was posted and what fixed it.

### 4. Offline is a first-class mode, not a fallback

See below. This is the part most POS products get wrong.

---

## Offline architecture

The guarantee:

> A sale taken on a register with no network is either applied on the server
> **exactly once**, or still sitting in the device's outbox with a visible,
> actionable error. It is never dropped, and never silently duplicated.

Three rules implement it:

**1. The client mints the identity.** Every operation carries a `clientTxnId`
(UUIDv4) generated at the moment of capture, before any network call. It is the
primary key of the IndexedDB outbox, so enqueuing twice is one row, and it is the
idempotency key the server dedupes on.

**2. The server dedupes on that id.** `clientTxnId` is UNIQUE on `Sale`, `Payment`,
`Customer` and `Supplier`. A replayed batch returns `duplicate` with the original
document id — it does not create a second sale.

**3. Sync is atomic per operation, not per batch.** A push of 200 sales where the
7th conflicts still commits the other 199. Wrapping the batch in one transaction
would mean one bad sale silently discarding a shift's takings — exactly the data
loss this design exists to prevent.

```
(new) ──enqueue──► pending ──claim──► syncing ──┬─ applied  ─► synced
                                                 ├─ duplicate ► duplicate   (SUCCESS)
                                                 ├─ conflict ─► conflict    (needs a human)
                                                 ├─ rejected ─► failed      (permanent)
                                                 └─ transient ► pending     (backoff + retry)
syncing ──tab crash on startup──► pending          (recovered at boot)
failed  ──operator retry────────► pending          (same id, so it comes back duplicate)
```

`rejected` is **never** retried — it is permanent by definition, and retrying it
forever would hide a real problem behind an infinite spinner. `pending`, `syncing`,
`synced`, `failed` and `conflict` are all surfaced in the UI with the server's own
explanation, because "Offline" on its own tells a shop owner nothing.

Conflict resolution is deterministic and identical on both sides: newest
`updatedAt` wins, ties broken by id — a total order, so both sides reach the same
conclusion without another round trip.

---

## Stack

| Layer | Choice | Note |
|---|---|---|
| Runtime | Node.js 20+ / TypeScript 5.7 (ESM) | strict, `noUncheckedIndexedAccess` |
| API | Express 5 | async error propagation built in |
| ORM | **Prisma 7.10** | see the note below |
| Database | PostgreSQL 16 | via Docker |
| Web | React 19 + Vite 6 + Tailwind v4 | |
| Client data | TanStack Query | |
| Offline store | IndexedDB via Dexie | real embedded DB, not localStorage |
| Validation | Zod 4 | one schema per endpoint |

### A note on "Prisma 8+"

The brief asked for Prisma 8. As of writing, **Prisma 8 is not actually
releasable**: the `prisma` CLI publishes an `8.0.0-rc` tag, but `@prisma/client`
has no matching release — only `8.1.0-dev.*` prereleases. The latest usable
client is **7.10.0**, so that is what is pinned.

This is not a downgrade in capability. Prisma 7 already ships the architecture
Prisma 8 makes mandatory, and this project uses all of it:

- **Query Compiler** enabled — the Rust query engine is gone; queries are compiled
  by WASM and executed over a **driver adapter** (`@prisma/adapter-pg`).
- **ESM-only**, `output` on the generator, no `url` in the datasource block
  (it lives in `prisma.config.ts`).

Moving to 8.1 when it stabilises is a version bump, not a migration.

---

## Running it

```bash
# 1. dependencies
npm install

# 2. database (Docker)
npm run db:up

# 3. schema + seed
npm run db:push
npm run db:seed

# 4. both apps
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/v1

**Seeded sign-in:** `admin@monopos.test` / `ChangeMe!2026` (Owner role)
Also seeded: `cashier@monopos.test` / `Cashier!2026` (Cashier role, to see
permission filtering), 16 products with opening stock, 4 customers, 3 suppliers,
a 24-account chart of accounts, and 4 languages including Arabic (RTL).

> Port note: this machine already had something else on 5432, so MonoPOS
> publishes Postgres on **5434**. `docker-compose.yml` and `apps/server/.env`
> must agree.

---

## Verifying the guarantees

The claims in this README are not assertions — they are executable:

```bash
npm run db:up
npm run db:push && npm run db:seed
npm run dev:server           # in one terminal
npm run verify -w @monopos/server   # in another
```

`apps/server/scripts/e2e-check.ts` runs 48 checks against a **live server and a
real database**, covering:

- integer money arithmetic, rounding half-away-from-zero, penny-perfect allocation
- authentication, session expiry, permission enforcement
- a sale writing sale + invoice + payments + stock + balanced journals
- every journal balancing, and the whole ledger tying out
- stock decrementing by exactly the quantity sold
- **a replayed sale creating nothing new** — no second record, no second stock
  movement, no second posting
- **a bad item in a sync batch not blocking the good ones**
- overselling refused with a named shortage
- trial balance, balance sheet and P&L reconciling
- voiding reversing the entry *and* returning the goods to stock

---

## Architecture

```
mono-pos/
├── packages/shared/          Money + quantity maths, permissions, sync contract, domain enums
├── apps/server/
│   ├── prisma/schema.prisma 57 tables
│   ├── src/
│   │   ├── config/          Validated environment, fails fast at boot
│   │   ├── db/              Prisma client + transaction helper with deadlock retry
│   │   ├── lib/             Errors, HTTP, request context, audit, numbering, CRUD factory
│   │   ├── middleware/      Auth, RBAC, branch scoping, rate limiting, errors
│   │   ├── modules/
│   │   │   ├── accounting/  THE LEDGER — the only writer of JournalEntry
│   │   │   ├── inventory/   THE STOCK ENGINE — StockLevel + StockMove
│   │   │   ├── sales/       Pricing (pure) + the unified sale transaction
│   │   │   ├── sync/        Offline ingest, conflict handling
│   │   │   └── auth/
│   │   └── routes/
│   └── prisma/seed.ts
└── apps/web/
    ├── src/lib/             API client, Dexie DB, i18n, theme, auth, formatting
    ├── src/lib/offline/     Sync engine, outbox, pricing, conflicts
    ├── src/components/ui/   The design system
    └── src/pos/             The offline-capable till
```

### Multi-tenancy and multi-branch, from day one

Every business-owned row carries `businessId`, and every list endpoint is scoped
by it in a shared CRUD factory — so tenant isolation is structural rather than
remembered per endpoint. Branch access is a single non-null `branchIds` array on
the user, snapshotted onto the session so authorisation is one indexed read.

Nullable columns are never used inside a `@@unique` in this schema, because SQL
treats every NULL as distinct. Where a constraint spans optional columns the key
is collapsed into a non-null `scopeKey` (`"GLOBAL"`, `"BRANCH:<id>"`,
`"REGISTER:<id>"`) or `itemKey`, which also makes the upsert on every sale a
single indexed write.

---

## Design system

Tokens live in `apps/web/src/index.css` as CSS custom properties, with light and
dark as two token sets — components never branch on theme, they just read the
variable.

- **Radius capped at 12px** (`--radius-xs` … `--radius-xl`).
- **Control heights**: 32 / 36 / 40px, so a form row lines up regardless of which
  control was used.
- **Flat surfaces, 1px borders, minimal shadows.** Depth comes from border and
  background tint. No decorative gradients, no glassmorphism, no glow.
- One accent colour, used sparingly and purposefully.
- Tabular figures everywhere, because money must align in columns.
- `prefers-reduced-motion` honoured globally.

**RTL is a document property.** The `dir` attribute on `<html>` comes from the
language record the admin configured, and because every component styles with
logical properties (`ms-*`, `me-*`, `ps-*`, `start-*`), no component contains a
single RTL-specific rule. Adding Arabic is a database row plus translations — the
client has no hard-coded language list.

**Localisation is admin-managed.** `Language` and `Translation` are first-class
tables; Settings → Languages seeds a new language with the English baseline so
the editor opens complete, and flags which keys are still untranslated.

### Accessibility

Semantic roles throughout, keyboard-operable everywhere (the POS is fully
keyboard-driven with a discoverable shortcut bar), visible focus preserved by a
single global `:focus-visible` rule that components do not remove, and
`aria-*` on custom controls. Charts are `role="img"` with a label plus a
visually-hidden data table.

---

## Security

- Passwords bcrypt-hashed, cost re-evaluated and upgraded transparently on login.
- Access tokens short-lived and in memory only — never `localStorage`.
- Refresh tokens are httpOnly cookies, stored only as a SHA-256 hash, and
  **rotated on every use**; reuse of a spent token revokes the whole family and is
  logged, which is the standard signal for token theft.
- Login is rate-limited per IP+email and locks the account after repeated failures.
- Unknown cost is charged to a dummy bcrypt hash so response timing cannot
  enumerate which emails have accounts.
- Helmet, CORS allowlist, 1 MB body cap, typed errors that never leak internals.
- Audit log records who changed what, when, from where — including which offline
  device originated the change.

---

## Known limitations

Stated plainly rather than hidden:

- **Rate limiting is in-process.** Correct for a single-instance deployment, which
  is what a per-branch POS is. A multi-instance deployment must move it to Redis.
- **FIFO costing uses weighted average.** A true layer table is a deliberate v2
  addition; average is the conservative interim because it never understates COGS.
- **Purchases and expenses have schema, journal support and read endpoints, but
  the create flows are thinner than the sale path.** The sale path — the one that
  carries the offline guarantee and the full accounting chain — is complete.
- **Multi-currency is single-currency per business.** The `currency` columns exist
  so the constraint can be added later without a rewrite.

---

## Licence

Proprietary. All rights reserved.
