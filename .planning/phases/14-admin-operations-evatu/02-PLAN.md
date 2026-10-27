---
phase: 14-admin-operations-evatu
plan: 02
title: Schema — conflict resolution, supplier transfers, E-VAT submissions, settings
lane: api
depends_on: [01]
requirements: [ADM-07, PAY-04, PAY-06, EVAT-01, EVAT-03]
---

# Plan 02 — Five tables and one column that make the rest possible

## Goal

The database can record a conflict resolution, a supplier transfer and its allocation
plan, an E-VAT submission and its certificate, and the cash refund a Z-report must
itemise. Nothing in this plan serves a request; it is the ground every later API plan
stands on.

## Read first

- `00-DECISIONS.md` P14-D13, D14, D22, D25, D30, D34–D38, D41.
- `01-RESEARCH.md` facts 17, 38–41, 48.
- `api/migrations/0013_enum_phase13.sql` + `0014_phase13_payments.sql` — the enum-file-then-
  DDL-file shape this plan repeats verbatim.
- `api/src/modules/pos/pos.schema.ts:333-365` (`sync_conflict`), `:624-679` (`shift_report`).
- `api/src/modules/payables/payables.schema.ts:156-226` — the payment/allocation pair the
  transfer pair deliberately mirrors.
- `api/src/modules/payments/payments.schema.ts:121-141` (`payment_event`).
- `api/src/modules/suppliers/suppliers.schema.ts:60-96` — the payment detail whose
  `paystackRecipientCode` finally gets a writer.
- `api/src/modules/platform/settings.validation.ts:5-348`, `settings.service.ts:32-38`.
- `api/src/modules/platform/phase13-schema.test.ts` — the schema test this plan copies.

## Tasks

### 1. The enum-only migration — `api/migrations/0016_enum_phase14.sql`

Four new enums and nothing else. It must apply before any DDL that uses them, because
`drizzle-kit migrate` wraps each file in a transaction and PostgreSQL 17 will not use a
value added in that transaction.

```sql
CREATE TYPE conflict_resolution_code AS ENUM (
  'CONFIRMED','CORRECTED_ELSEWHERE','ACCEPTED_RISK','TILL_INSTRUCTION','DUPLICATE');
CREATE TYPE supplier_transfer_status AS ENUM (
  'PENDING','AWAITING_OTP','SUCCESS','FAILED','REVERSED','BLOCKED','REJECTED');
CREATE TYPE evat_document_kind AS ENUM ('INVOICE','REFUND');
CREATE TYPE evat_submission_status AS ENUM (
  'QUEUED','WAITING_FOR_INVOICE','SUBMITTING','CERTIFIED','RETRY','ATTENTION');
```

No `ALTER TYPE … ADD VALUE` anywhere: this phase adds no value to an existing enum.

### 2. The DDL migration — `api/migrations/0017_phase14_schema.sql`

**`sync_conflict` gains one column:**

```sql
ALTER TABLE sync_conflict ADD COLUMN resolution_code conflict_resolution_code;
CREATE INDEX sync_conflict_status_created_idx ON sync_conflict (status, created_at DESC);
```

Nullable, because 149 existing rows were resolved by nobody. The index has a reader: the
console's default queue is "open, newest first, all branches" and the existing
`(branch_id, status, severity)` cannot serve it.

**`shift_report` gains one column:**

```sql
ALTER TABLE shift_report ADD COLUMN cash_refund_minor integer;
```

Nullable on purpose. A snapshot taken before this phase did not record the figure, and
backfilling it from today's `refund_tender` would be inventing a number for a day nobody
measured. The print says "not itemised" for those rows (Plan 12).

**`payment_event` gains a nullable link:**

```sql
ALTER TABLE payment_event ADD COLUMN supplier_transfer_id uuid
  REFERENCES supplier_transfer(id) ON DELETE SET NULL;
CREATE INDEX payment_event_transfer_idx ON payment_event (supplier_transfer_id);
```

**`supplier_transfer`** — the provider intent:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `branch_id`, `supplier_id` | uuid FK restrict | the branch that owes, the supplier owed |
| `payment_detail_id` | uuid FK restrict | the account the money goes to |
| `method` | `supplier_payment_method` | `BANK` or `MOMO`; `CASH` is refused in the service |
| `amount_minor` | integer | `CHECK (amount_minor > 0)` |
| `reference` | text | our reference; `UNIQUE`, `CHECK (char_length(reference) BETWEEN 16 AND 50)` |
| `idempotency_key` | text | the client's key; `UNIQUE (branch_id, idempotency_key)` with `supplier_transfer_idempotency_unique` |
| `status` | `supplier_transfer_status` | default `PENDING` |
| `provider` | `payment_provider` | `PAYSTACK` or `MOCK` |
| `recipient_code`, `provider_transfer_code`, `provider_transfer_id` | text null | code is `TRF_…`, id is the u64 **as text** |
| `reason`, `note` | text | narration / internal |
| `failure_code`, `failure_message` | text null | Paystack's own words |
| `payment_id` | uuid FK `supplier_payment` set null | set exactly once, on settlement |
| `unallocated_minor` | integer not null default 0 | what the plan could not apply |
| `initiated_by`, `finalized_at`, `settled_at`, `last_verified_at` | text / timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: unique `reference`; unique `(branch_id, idempotency_key)`; partial unique
`payment_id WHERE payment_id IS NOT NULL` (one payment per transfer, and one transfer per
payment); `(branch_id, created_at DESC)`; `(status, created_at)` for the sweep;
`(supplier_id, created_at DESC)`.

**`supplier_transfer_allocation`** — the plan, not the fact:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `transfer_id` | uuid FK cascade | |
| `invoice_id` | uuid FK restrict | |
| `amount_minor` | integer | `CHECK (amount_minor > 0)` |
| `created_at` | timestamptz | |

`UNIQUE (transfer_id, invoice_id)`. It mirrors `supplier_payment_allocation`'s *intent*
half; the settled rows are still written to `supplier_payment_allocation` by Plan 06, which
is what keeps `supplier_payment` the only ledger fact.

**`evat_submission`** — one row per document, one certificate:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | `evat_document_kind` | |
| `branch_id`, `terminal_id` | uuid FK restrict | terminal null for a console-originated correction? No: both not null; a refund always has one |
| `sale_id`, `refund_id` | uuid FK restrict, nullable | exactly one, enforced by a `CHECK` |
| `status` | `evat_submission_status` | default `QUEUED` |
| `attempts` | integer not null default 0 | |
| `next_attempt_at`, `due_at` | timestamptz | `due_at = occurred_at + 24h`, stored once for the index |
| `provider` | text not null | `MOCK` today |
| `provider_invoice_number`, `sdc_id`, `serial`, `signature`, `internal_data`, `machine_code` | text null | GRA's `num`, `ysdcid`, `ysdcrecnum`, `ysdcregsig`, `ysdcintdata`, `ysdcmrc` |
| `stamped_at` | timestamptz null | GRA's `ysdcmrctim`/`ysdctime` |
| `qr_payload` | text null | GRA's `qr_code`, stored as returned, never composed |
| `last_error_code`, `last_error_message` | text null | `E700`…`E900` or our own |
| `submitted_at`, `certified_at`, `created_at`, `updated_at` | timestamptz | |

```sql
CHECK ((kind = 'INVOICE' AND sale_id IS NOT NULL AND refund_id IS NULL)
    OR (kind = 'REFUND'  AND refund_id IS NOT NULL AND sale_id IS NULL))
CREATE UNIQUE INDEX evat_submission_sale_unique ON evat_submission (sale_id)
  WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX evat_submission_refund_unique ON evat_submission (refund_id)
  WHERE refund_id IS NOT NULL;
CREATE INDEX evat_submission_queue_idx ON evat_submission (status, next_attempt_at);
CREATE INDEX evat_submission_branch_created_idx ON evat_submission (branch_id, created_at DESC);
```

The two partial uniques are the idempotency: a sale has one certificate, a refund has one.

### 3. Settings — five new keys

`api/src/modules/platform/settings.validation.ts`, appended after
`pos.refundApprovalThresholdMinor`:

| Key | Schema | Default | Scope | `writableBy` |
|---|---|---|---|---|
| `tax.sellerTin` | `z.string().trim().max(30)` | `''` | global | admin |
| `tax.sellerVatNumber` | `z.string().trim().max(30)` | `''` | global | admin |
| `flag.supplierTransfers` | `z.boolean()` | `true` | global | admin |
| `flag.evatSubmission` | `z.boolean()` | `true` | global | admin |
| `flag.posConflictResolution` | `z.boolean()` | `true` | global | admin |

Empty string is the honest default for a TIN we do not have yet: it prints nothing rather
than printing `undefined`. The flag keys must be typed by `FlagKey`, so
`SETTING_DEFINITIONS` gets a compile-time check that its `flag.*` keys are exactly
`FLAG_KEYS` — a literal-union assignment, not a runtime loop.

### 4. Idempotent seed

`api/src/seed/demo.ts`: `ensureSetting('tax.sellerTin', 'C0012345678')` and
`ensureSetting('tax.sellerVatNumber', 'C0012345678')` so the demo's receipt copy and the
E-VAT payload look like a real business. Flags are **not** seeded — their defaults are the
product's intended state, and a seeded row would make `source: 'global'` look like a
decision somebody made.

### 5. Tests — `api/src/modules/platform/phase14-schema.test.ts`

- the four enums exist with the exact values and `enumsortorder` matching the shared
  unions in both directions (the `phase13-schema.test.ts:315-338` pattern);
- `sync_conflict.resolution_code` exists, is nullable, and its type is
  `conflict_resolution_code`;
- `supplier_transfer` and `supplier_transfer_allocation` exist with the columns, the
  reference length check, the positive-amount checks, and both uniques;
- `evat_submission` rejects `kind = 'INVOICE'` with a `refund_id`, rejects a row with both
  or neither, and refuses a second row for the same sale;
- `shift_report.cash_refund_minor` exists and is nullable;
- `payment_event.supplier_transfer_id` exists and nulls on transfer delete;
- the five settings resolve with the table's defaults, scope and `writableBy`, and a
  manager writing any of them is a 403;
- `FLAG_KEYS` and the `flag.*` keys in `SETTING_DEFINITIONS` are the same set.

## Verification

```bash
bun run db:migrate            # 16 → 18 migrations, 0016 before 0017
bun run db:test:prepare
bun run --filter api test     # 710 → ~725
bun run check-types
```

Apply the two migrations to a **scratch** database from zero as well, so the enum file is
proven to precede its own DDL on a clean cluster, not just on the dev database.

## Commits

1. `feat(api): four phase 14 enums in their own migration`
2. `feat(api): supplier transfer, its allocation plan, and the E-VAT submission`
3. `feat(api): a conflict can be resolved and a Z can itemise cash refunds`
4. `feat(api): seller tax identity and three typed feature flags`
5. `test(api): phase 14 schema, constraints and setting scope`

## Done when

- A sale can have at most one submission and a refund at most one, enforced by the
  database rather than by hoping.
- A transfer cannot exist with a zero amount, a short reference, or two settlement
  payments.
- The flag registry and the settings registry cannot drift without a type error.
