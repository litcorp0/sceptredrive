---
phase: 04-customers-credit
plan: 01
wave: 1
title: Phase 4 schema, settings, permissions, phone helper, and demo seed
requirements: [CUS-01, CUS-02, CUS-03, LOY-01, LOY-02, LOY-04, LOY-05, ADM-05]
depends_on: []
status: planned
created: 2026-10-18
---

# Plan 01 — Schema, Settings, Permissions, Phone Helper, Demo Seed

**Goal:** The customer, branch credit, and global loyalty tables exist with the right
constraints and indexes; sequences and settings for Phase 4 are configured; the new
permissions and the Ghana phone helper exist in `@gikautos/shared`; the demo seed
carries idempotent customers, credit, and loyalty fixtures.

## Task 1 — Customer, credit, and loyalty schema + migration

**Files:** `api/src/modules/customers/customers.schema.ts`,
`api/src/modules/credit/credit.schema.ts`,
`api/src/modules/loyalty/loyalty.schema.ts`, generated `api/migrations/0004_*.sql`
(+ `api/migrations/meta/`)

- `customers.schema.ts`: `pgEnum('customer_status', ['ACTIVE','ARCHIVED'])`;
  `customer`: uuid pk defaultRandom; `name` text notNull; `phone` text (nullable —
  required by the service unless anonymized); `email` text; `address` text;
  `createdBranchId` fk branch (restrict); `status` enum notNull default `ACTIVE`;
  `anonymizedAt` timestamptz; `createdBy` text; timestamps with `$onUpdate`.
  Indexes: partial unique `customer_phone_uq` on `phone` `WHERE anonymized_at IS NULL`;
  `(createdBranchId)`; `(status)`.
- Trigram search indexes: after generating the migration, append custom SQL to the same
  migration file — `CREATE EXTENSION IF NOT EXISTS pg_trgm;` plus
  `CREATE INDEX customer_name_trgm ON customer USING gin (name gin_trgm_ops);` and
  `CREATE INDEX customer_phone_trgm ON customer USING gin (phone gin_trgm_ops);`
  (drizzle-kit cannot express the extension; the test DB also runs migrations, so both
  databases get it).
- `credit.schema.ts`: `pgEnum('credit_entry_kind', ['CHARGE','REPAYMENT','REFUND','ADJUSTMENT'])`;
  `pgEnum('credit_reason_code', ['SALE','OPENING_BALANCE','CORRECTION','WRITE_OFF','DISPUTE','RETURN','OTHER'])`;
  `pgEnum('credit_override_reason', ['TEMPORARY_APPROVAL','TRUSTED_CUSTOMER','URGENT_NEED','OTHER'])`;
  `pgEnum('credit_method', ['CASH','MOMO','BANK'])`.
  - `credit_profile`: uuid pk; `customerId` fk customer (restrict); `branchId` fk branch
    (restrict); `limitMinor` integer notNull default 0; `hold` boolean notNull default
    false; `paymentTermDays` integer notNull default 0; `notes` text; `balanceMinor`
    integer notNull default 0 (projection); `createdBy` text; timestamps with
    `$onUpdate`; `unique(customerId, branchId)`; `index(branchId)`.
  - `credit_ledger_entry`: uuid pk; `customerId` fk (restrict); `branchId` fk
    (restrict); `kind` enum notNull; `amountMinor` integer notNull (signed, non-zero —
    service-validated); `reasonCode` enum; `method` enum (repayments); `note` text;
    `dueDate` date (charges); `referenceType` text; `referenceId` uuid;
    `referenceNumber` text; `overrideReason` enum; `overriddenBy` text;
    `receivedBy` text; `idempotencyKey` text; `createdBy` text; `occurredAt` timestamptz
    notNull; `createdAt` defaultNow. Indexes: `(customerId, branchId, occurredAt)`,
    `(branchId, occurredAt)`, unique `(branchId, idempotencyKey)` (Postgres keeps
    nulls distinct, so rows without a key never collide).
- `loyalty.schema.ts`: `pgEnum('loyalty_entry_kind', ['EARN','REDEEM','CLAWBACK','ADJUST','EXPIRE'])`;
  `pgEnum('loyalty_reason_code', ['EXPIRY','RETURN','CORRECTION','GOODWILL','OTHER'])`.
  - `loyalty_account`: uuid pk; `customerId` fk (restrict, unique); `balancePoints`
    integer notNull default 0 (projection); timestamps with `$onUpdate`.
  - `loyalty_ledger_entry`: uuid pk; `accountId` fk (restrict); `customerId` fk
    (restrict, denormalized); `branchId` fk (restrict, nullable — global expiry);
    `kind` enum notNull; `pointsDelta` integer notNull (signed, non-zero);
    `reasonCode` enum; `note`; `referenceType`/`referenceId`/`referenceNumber`;
    `idempotencyKey`; `createdBy` (nullable — jobs); `occurredAt` notNull;
    `createdAt` defaultNow. Indexes: `(accountId, occurredAt)`,
    `(customerId, occurredAt)`, `(branchId, occurredAt)`, unique
    `(branchId, idempotencyKey)`.
  - `loyalty_lot`: uuid pk; `accountId` fk (restrict); `earnEntryId` fk
    loyalty_ledger_entry (restrict, unique); `points` integer notNull; `remainingPoints`
    integer notNull (projection of consumption); `expiresAt` timestamptz notNull;
    `createdAt` defaultNow; `index(accountId, expiresAt)`;
    partial `index(expiresAt)` `WHERE remaining_points > 0` for the expiry scan.
  - `loyalty_lot_consumption`: uuid pk; `lotId` fk (restrict); `entryId` fk
    loyalty_ledger_entry (restrict); `points` integer notNull; `createdAt`;
    `unique(lotId, entryId)`; `index(entryId)`.
- Generate with `bun run db:generate`; inspect the SQL; add the extension + trigram
  statements; then `bun run db:migrate` and `bun run db:test:prepare`.

**Verify:** migrations apply cleanly on the dev DB and the test DB; `\d customer`,
`\d credit_ledger_entry`, `\d loyalty_lot` show the indexes; `SELECT * FROM pg_extension
WHERE extname = 'pg_trgm'` returns a row; `bun run --filter api check-types`.
**Commit:** `feat(api): add customer, credit, and loyalty schema`

## Task 2 — Phase 4 settings and repayment sequence

**Files:** `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/platform/settings.service.ts`,
`api/src/modules/platform/platform.test.ts`

- New settings: `loyalty.minimumRedeemPoints` (int ≥ 1, default 100),
  `credit.repaymentPrefix` (string regex 1–8 alphanumeric, default `REP`),
  `credit.repaymentSequence` (int ≥ 1, default 1). Tighten `loyalty.earnPointsPerCedi`
  from `z.number().positive()` to `z.number().int().min(1)`.
- Extend `SequenceKey` with `credit.repaymentSequence` and `SEQUENCE_FORMATS` (pad 5,
  label “repayment receipt number”) per the existing pattern.
- Global settings stay admin-only (existing rule).

**Verify:** platform tests: `REP-00001`-style allocation, peek without consuming,
`advanceSequencePast`; manager update of a global Phase 4 setting → 403;
`loyalty.earnPointsPerCedi = 1.5` rejected; full `bun run test` green after
`db:test:prepare`.
**Commit:** `feat(api): add phase 4 settings and repayment sequence`

## Task 3 — Shared permissions and Ghana phone helper

**Files:** `packages/shared/src/permissions.ts`, `packages/shared/src/permissions.test.ts`,
`packages/shared/src/phone.ts`, `packages/shared/src/phone.test.ts`,
`packages/shared/src/index.ts`, `packages/shared/package.json`

- Add `libphonenumber-js` to the root catalog and `packages/shared` (`catalog:`).
- `permissions.ts`: add `customer.read`, `customer.create`, `customer.update`,
  `customer.archive`, `customer.anonymize`, `credit.read`, `credit.profile.manage`,
  `credit.repayment`, `credit.adjust`, `credit.override`, `loyalty.read`,
  `loyalty.adjust`, `loyalty.settings`.
- `ROLE_PERMISSIONS`: ADMIN gets all; MANAGER gets all except `customer.archive`,
  `customer.anonymize`, `loyalty.settings`; CASHIER gets none.
- `phone.ts`: `normalizeGhanaPhone(input: string): string | null` — parse with
  `parsePhoneNumberFromString(input, 'GH')`, return `.number` (E.164) when valid and
  country GH, else null; `formatGhanaPhone(e164: string): string` for display
  (national format when parseable, else the raw value). Export both from `index.ts`.
- Tests: `0241234567` → `+233241234567`; `+233 24 123 4567`, `233241234567`, dashes and
  spaces normalize; `0123456789`, `+441234…`, garbage → null; formatting round-trip;
  permissions tests updated (manager/admin/cashier matrices, no duplicates).

**Verify:** `bun run --filter shared test` (phone + permissions green);
`bun run --filter api check-types` after the permission rename ripple.
**Commit:** `feat(shared): add phase 4 permissions and phone normalization`

## Task 4 — Demo seed customers, credit, and loyalty

**Files:** `api/src/seed/demo.ts`, `api/src/seed/helpers.ts`

- Helpers (direct Drizzle in one transaction, idempotent by natural key, services do
  not exist during seeding): `ensureCustomer({ name, phone, email?, address?,
  createdBranchId, actor })` also inserts the `loyalty_account` row;
  `ensureCreditOpening({ customerId, branchId, amountMinor })` creates the profile
  (limit set), one `CHARGE` with `reasonCode: 'OPENING_BALANCE'` and one `REPAYMENT`
  (`REP-00001` via the sequence settings, half the charge), updating `balanceMinor`;
  `ensureLoyaltyEarn({ customerId, points, branchId })` creates an `EARN` entry plus
  its lot with `expiresAt = now + loyalty.expiryMonths`, updating `balancePoints`.
- Demo data: three customers at ACC-SPX (`+233241000001` with credit: limit
  GHS 500, opening charge GHS 120, repayment GHS 60; `+233241000002` with 250 loyalty
  points; `+233241000003` plain). Re-running `db:seed --demo` creates nothing new.
- Never mutate existing rows on re-run; look up by phone / reference first.

**Verify:** fresh DB → `db:seed` → `db:seed --demo` twice → counts unchanged;
`credit_profile.balance_minor` equals the seeded entries' sum;
`loyalty_account.balance_points` equals the seeded ledger sum and lot remainder;
`loyalty_lot.expires_at` is 12 months out.
**Commit:** `feat(api): seed demo customers, credit, and loyalty`

## Done When

All Phase 4 tables exist with constraints, indexes, and the trigram extension; the
`REP` sequence and additional settings allocate through the settings mechanism; the new
permissions and `normalizeGhanaPhone` are exported from `@gikautos/shared`; the demo
seed carries idempotent customers, a reconciled credit balance, and loyalty points with
a lot.
