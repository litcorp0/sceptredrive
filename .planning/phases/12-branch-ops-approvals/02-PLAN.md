---
phase: 12-branch-ops-approvals
plan: 02
title: Schema, enum migrations, settings, document kind, seeds
lane: api
depends_on: [01]
requirements: [APR-01, APR-02, BRN-01, BRN-02, BRN-04, CC-01, CC-03, CC-05]
---

# Plan 02 — The tables, the enum files, and the settings

## Goal

Every table, column, enum value, index, setting and sequence the phase needs exists, migrates from
zero, and is seeded. This is the **only** plan that runs `drizzle-kit generate`, and it produces
**two** migration files: one that adds enum values, one that uses them.

## Read first

- `00-DECISIONS.md` P12-D2, P12-D9, P12-D14, P12-D15, P12-D16, P12-D17, P12-D24, P12-D28, P12-D30.
- `01-RESEARCH.md` §2 items 1–3, 12–13 and §3 items 14, 18, 20–23.
- `api/migrations/0009_enum_supplier_return.sql` — the precedent: an enum-only migration file.
- `api/migrations/0010_procurement.sql:1-33,117-145` — the precedent for a main migration with
  enums, a table, and partial indexes.
- `api/src/modules/approvals/approvals.schema.ts`, `transfers/transfers.schema.ts`,
  `counts/counts.schema.ts`, `inventory/inventory.schema.ts`, `pos/pos.schema.ts`,
  `org/branches.schema.ts`.
- `api/src/modules/platform/settings.validation.ts` and `sequences.service.ts`.
- PostgreSQL 17 `ALTER TYPE` note in `01-RESEARCH.md` §1.

## Tasks

### 1. Enum-only migration (its own file, no DDL)

`drizzle-kit generate --custom --name=enum_branch_ops`, then write:

```sql
ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE IF NOT EXISTS 'WRITE_OFF';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_reference" ADD VALUE IF NOT EXISTS 'WRITE_OFF';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'THEFT';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'OBSOLESCENCE';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'SUPPLIER_FAULT';
```

The three `stock_adjustment_reason` values exist so a posted `WRITE_OFF` movement can carry the
reason the form collected (Plan 05 maps `EXPIRY` → `EXPIRED`; every other value is shared). The
form keeps its own enum so its vocabulary can grow without touching the ledger's.

`IF NOT EXISTS` because the file may be re-run against a database restored from a later backup.
Nothing in this file may use the new values — the transaction has not committed.

### 2. Main migration (generated, then edited for the partial indexes)

New enums:

| Enum | Values |
|---|---|
| `stock_write_off_status` | `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `stock_write_off_reason` | `DAMAGE`, `EXPIRY`, `OBSOLESCENCE`, `THEFT`, `SUPPLIER_FAULT`, `OTHER` |
| `count_scope` | `CATEGORY`, `BRAND`, `ABC_CLASS`, `ROTATION` |
| `count_frequency` | `WEEKLY`, `MONTHLY`, `QUARTERLY`, `BIANNUAL` |
| `count_type` | `MANUAL`, `SCHEDULED`, `TRIGGER` |
| `count_trigger_reason` | `VARIANCE`, `OVERSELL` |
| `abc_class` | `A`, `B`, `C` |
| `shift_review_status` | `NONE`, `REQUIRED`, `REVIEWED` |

New tables (schema files listed in §3):

```text
stock_write_off      id, number unique, branch_id FK restrict, status, note, value_minor default 0,
                     approval_id FK approval restrict, requested_by, posted_at,
                     created_by, created_at, updated_at, cancelled_by, cancelled_at
stock_write_off_line id, write_off_id FK cascade, product_id FK restrict, quantity,
                     unit_cost_minor, reason, note, unique (write_off_id, product_id)
count_schedule       id, branch_id FK restrict, scope, scope_key, frequency, next_due_at date,
                     assigned_to, is_active default true, created_by, created_at, updated_at,
                     unique (branch_id, scope_key), index (is_active, next_due_at)
stock_abc_class      id, product_id FK cascade, branch_id FK restrict, class, value_minor,
                     sold_minor, score, computed_at, is_manual default false, updated_by,
                     updated_at, unique (product_id, branch_id), index (branch_id, class)
```

Extensions:

```text
approval          + decider_role text not null default 'ADMIN'
                  + decider_branch_id uuid FK branch restrict (nullable)
                  + index approval_decider_idx (decider_role, decider_branch_id, status)
stock_count       + count_type count_type not null default 'MANUAL'
                  + scope count_scope (nullable), scope_key text (nullable)
                  + due_at date (nullable), assigned_to text (nullable)
                  + schedule_id uuid FK count_schedule set null (nullable)
                  + trigger_reason count_trigger_reason (nullable)
                  + trigger_product_id uuid FK product restrict (nullable)
                  + trigger_source_id uuid (nullable)
                  + partial unique stock_count_open_trigger_unique
                      (branch_id, trigger_product_id) WHERE status='OPEN' AND trigger_product_id IS NOT NULL
                  + partial unique stock_count_open_schedule_unique
                      (schedule_id) WHERE status='OPEN' AND schedule_id IS NOT NULL
shift             + review_status shift_review_status not null default 'NONE'
                  + reviewed_by text, reviewed_at timestamptz, review_note text
                  + index shift_review_idx (branch_id, review_status, closed_at)
sync_conflict     + index sync_conflict_type_created_idx (type, created_at)
```

`decider_role` is `text`, not an enum: `staff.role` is text
(`identity/staff.schema.ts:17`), the role set lives in `@sceptre/shared`, and a Postgres enum here
would be a third copy of the vocabulary. The service validates it with `isRole`.

`stock_write_off.quantity` must be positive; enforce in the Zod schema and re-check in the service
(no `CHECK` constraints exist in this repository — do not introduce a new convention for one
column).

### 3. Schema files

| File | Change |
|---|---|
| `api/src/modules/writeoffs/writeoffs.schema.ts` (new) | the two write-off tables, enums `stock_write_off_status` / `_reason` |
| `api/src/modules/counts/counts.schema.ts` | `count_schedule`, `stock_abc_class`, the new `stock_count` columns and both partial indexes |
| `api/src/modules/approvals/approvals.schema.ts` | `deciderRole`, `deciderBranchId`, `approval_decider_idx` |
| `api/src/modules/pos/pos.schema.ts` | `shift_review_status` enum, the four shift columns, `shift_review_idx`, `sync_conflict_type_created_idx` |
| `api/src/modules/transfers/transfers.schema.ts` | `transferStatusEnum` gains the three values (no column change) |
| `api/src/modules/inventory/inventory.schema.ts` | both movement enums gain `WRITE_OFF` |

The `writeoffs` module directory is created here with only `writeoffs.schema.ts`; the remaining six
files arrive in Plan 05. The module gate only covers `admin/`, so a partial api module is legal —
but `api/src/app.ts` must not import it until Plan 05.

### 4. Settings (`platform/settings.validation.ts`)

| Key | Schema | Default | Scoped | Writable by |
|---|---|---|---|---|
| `pricing.managerBandPercent` | int 0…100 | `10` | global | admin |
| `pos.shiftVarianceToleranceMinor` | int 0…1_000_000 | `2_000` | branch | admin |
| `inventory.countVarianceToleranceMinor` | int 0…1_000_000 | `1_000` | branch | admin |
| `inventory.writeOffPrefix` | text 1…8, uppercase letters | `'WO'` | global | admin |
| `inventory.abcAThresholdBp` | int 1…9_999 | `8_000` | global | admin |
| `inventory.abcBThresholdBp` | int 2…10_000 | `9_500` | global | admin |

`abcAThresholdBp` must be less than `abcBThresholdBp`; `updateSetting` cannot express a
cross-field rule, so `settings.service.ts` gets one explicit guard for this pair (and a test).
Branch-scoped tolerances are admin-writable on purpose: a branch that sets its own tolerance has
none (the same reasoning as P11-D2).

### 5. Document kind (`platform/sequences.service.ts`)

- `DocumentKind` gains `'stock_write_off'`.
- `DOCUMENT_KINDS` gains `{ prefixKey: 'inventory.writeOffPrefix', label: 'Stock write-off', pad: 4 }`.
- No repository change: `document_sequence` is keyed by text `kind`.

### 6. Seeds

- `api/src/seed/helpers.ts`: `ensureCountSchedule({ branchId, scope, scopeKey, frequency, nextDueAt })`
  (idempotent by `(branch_id, scope_key)`) and `computeAbcClasses(branchId, tx)` that ranks
  `stock_level` rows by `value_minor + sold_minor` and upserts `stock_abc_class` with
  `is_manual = false` — the **same** ranking Plan 09's job uses, exported from the counts service
  so there is one implementation.
- `api/src/seed/demo.ts`: for each retail demo branch, seed one `ABC_CLASS` / `ABC:A` monthly
  schedule and compute the classes, so the console and the manager's view are not empty on a
  fresh `db:seed --demo`.
- No write-off, transfer request or approval fixtures in the seed: those are created by the
  walkthroughs, which is what proves the API rather than the seed.

### 7. Migration tests

Follow Phase 11 Plan 02's shape (`api/src/modules/platform/platform.test.ts` or a sibling):

- query `information_schema.columns` for every new column and `pg_enum` for every new value;
- assert both partial unique indexes exist with the right predicate
  (`pg_indexes.indexdef` contains `WHERE`);
- assert `SETTING_DEFINITIONS` contains the six keys with their defaults;
- assert `allocateDocumentNumber('stock_write_off', …)` returns `WO-<code>-<YYYYMM>-0001`.

### 8. The one-line bridge (keeps every commit green)

Plan 01 removed `procurement.approve` from the vocabulary. The decide route is the only API call
site that names it:

```ts
// api/src/modules/approvals/approvals.routes.ts:32
requirePermission('approval.decide'),   // was 'procurement.approve'
```

Change that one line here. Plan 03 rewrites the whole routes file (and adds `approval.read` to the
three read routes); this bridge exists so `bun run check-types` is green at this commit rather than
at the next one. No other route changes in this plan.

## Verification

```bash
docker compose down -v && docker compose up -d
bun run db:migrate          # every file from zero, including the enum-only file
bun run db:test:prepare
bun run db:seed --demo
bun run --filter api test
bun run check-types
bun run lint
```

Expected: `db:migrate` applies both new files with no error (the enum file must not be merged into
the DDL file — that is the whole point of P12-D9). The API suite is unchanged apart from the new
schema tests. `git status` shows exactly one new `migrations/*.sql` pair and one journal update.

## Commits

1. `feat(api): enum values for transfer requests, write-offs and reviews`
2. `feat(api): write-off, count schedule and ABC tables; approval authority columns`
3. `feat(api): band, tolerance, prefix and ABC threshold settings`
4. `test(api): schema, enum, index and setting definitions`

## Done when

- A fresh database migrates from zero with both files.
- Every new enum value is usable by the next migration file, proven by a table default or a test
  insert that uses it.
- The six settings resolve to their defaults with no row written.
- `stock_write_off` numbering allocates `WO-…-0001` per branch per month.
