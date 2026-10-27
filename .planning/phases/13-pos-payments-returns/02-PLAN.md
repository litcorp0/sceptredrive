---
phase: 13-pos-payments-returns
plan: 02
title: Schema, enum migrations, payment and refund tables, settings, sequences
lane: api
depends_on: [01]
requirements: [POS-10, POS-11, POS-12, POS-13, PAY-01, PAY-02, PAY-03, PAY-07]
---

# Plan 02 — The tables money will land in

## Goal

Every enum, table, index, setting and queue name this phase needs exists and is migrated, with no
service behaviour yet. After this plan the API boots, the suite is green, and nothing has changed
for any existing caller.

## Read first

- `00-DECISIONS.md` P13-D1, D2, D6, D17, D19, D22, D28, D32, D37, D38.
- `01-RESEARCH.md` §4 items 16–29 (transaction ownership, the closed unions, settings shape, the
  enum rule).
- `api/src/modules/pos/pos.schema.ts:18-64,120-231,264-324` — the enums, `sale`, `sale_tender`,
  `pos_sync_transaction`, `sync_conflict`.
- `api/src/modules/inventory/inventory.schema.ts:15-38` — the movement enums.
- `api/src/modules/platform/settings.validation.ts:176-292` — the declaration shape and the two
  comment styles to copy.
- `api/src/config/env.ts:26-53` — where the `PAYSTACK_*` keys go.
- `api/migrations/0011_enum_branch_ops.sql` — the enum-only migration template.

## Tasks

### 1. The enum-only migration

Generate the schema change, then **split by hand** into `NNNN_enum_phase13.sql` containing only:

```sql
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'MOMO';
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'CARD';
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'CREDIT_REPAYMENT';
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'CART_VOID';
ALTER TYPE "public"."stock_movement_type" ADD VALUE IF NOT EXISTS 'RETURN';
ALTER TYPE "public"."stock_movement_reference" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "public"."sync_conflict_type" ADD VALUE IF NOT EXISTS 'PAYMENT_LATE_SETTLEMENT';
ALTER TYPE "public"."sync_conflict_type" ADD VALUE IF NOT EXISTS 'PAYMENT_AMOUNT_MISMATCH';
```

`drizzle-kit generate` must not be re-run after the split (P11-D16, P12-D9).

### 2. `sale_tender` — sequence instead of method uniqueness

`pos.schema.ts`: add `sequence: integer('sequence').notNull().default(1)`, add
`paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' })`, and replace
the unique index:

```ts
uniqueIndex('sale_tender_sale_sequence_unique').on(table.saleId, table.sequence),
uniqueIndex('sale_tender_payment_unique')
  .on(table.paymentId)
  .where(sql`${table.paymentId} is not null`),
index('sale_tender_payment_idx').on(table.paymentId),
```

The partial unique is not tidiness: one payment settles one tender, ever, and a constraint is the
only version of that rule a retry cannot talk its way around (P13-D6).

`reference` stays (it holds the provider reference copied for printing and dispute handling).
`sale_tender.payment_id` is the real link; `reference` is display only.

### 3. `api/src/modules/payments/payments.schema.ts` (new module)

```ts
export const paymentMethodEnum = pgEnum('payment_method', ['MOMO', 'CARD', 'BANK_TRANSFER'])
export const paymentProviderEnum = pgEnum('payment_provider', ['PAYSTACK', 'MOCK'])
export const paymentStatusEnum = pgEnum('payment_status',
  ['PENDING', 'PAID', 'FAILED', 'ABANDONED', 'EXPIRED'])
```

`payment`:

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk defaultRandom | |
| `branch_id`, `terminal_id`, `device_id` | uuid not null FK restrict | `org` |
| `shift_id` | uuid not null | **no FK** — see below |
| `client_payment_id` | uuid not null | minted by the till |
| `cashier_user_id`, `cashier_staff_id` | text not null | |
| `method` | `payment_method` | |
| `amount_minor` | integer not null | |
| `provider` | `payment_provider` | |
| `provider_reference` | text not null | ours, sent to Paystack |
| `provider_email` | text not null | P13-D7 routing label |
| `provider_transaction_id` | text | u64 kept as text |
| `status` | `payment_status` default `PENDING` | |
| `channel` | text | provider channel string |
| `display_text` | text | what to show the customer |
| `authorization_url` | text | card only |
| `account_number`, `account_name`, `account_bank` | text | bank transfer only |
| `expires_at` | timestamptz | |
| `paid_at` | timestamptz | |
| `failed_code`, `failed_message` | text | ≤200 |
| `orphaned` | boolean not null default false | P13-D9 |
| `last_verified_at` | timestamptz | P13-D12 |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `unique(terminal_id, client_payment_id)`, `unique(provider_reference)`,
`(branch_id, created_at)`, `(status, created_at)`, `(shift_id)`.

> **Why `shift_id` has no foreign key.** The dependency must run one way: `pos` references
> `payments`, never the reverse. A real FK here would make `payments.schema.ts` import `pos.schema.ts`
> while `pos.schema.ts` imports `payments.schema.ts` for `sale_tender.payment_id`. `applySale` and
> `createPayment` both lock the shift row before trusting it, so the integrity is enforced where the
> money is.

`payment_event`:

| Column | Type |
|---|---|
| `id` | uuid pk |
| `provider` | `payment_provider` |
| `event_type` | text not null (allowlisted in the service) |
| `body_sha256` | text not null |
| `provider_reference` | text |
| `payment_id` | uuid FK `payment` set null |
| `status` | text not null (`PROCESSED\|IGNORED\|FAILED`) |
| `detail` | jsonb not null default `{}` (allowlisted projection only) |
| `received_at`, `processed_at` | timestamptz |

`unique(provider, body_sha256)`; index `(payment_id)`, `(event_type, received_at)`.

### 4. Refund tables (in `pos.schema.ts`)

```ts
export const refundReasonEnum = pgEnum('refund_reason',
  ['CUSTOMER_CHANGED_MIND','WRONG_ITEM','DEFECTIVE','PRICE_DISPUTE','DUPLICATE_SALE','OTHER'])
export const refundRestockEnum = pgEnum('refund_restock',
  ['RESALABLE','DAMAGED','NOT_RETURNED'])
export const refundTenderStatusEnum = pgEnum('refund_tender_status',
  ['SETTLED','PENDING','FAILED','NEEDS_ATTENTION'])
```

`refund`: `id` (= the upload's `clientTransactionId`), `number` (unique), `sale_id` FK restrict,
`branch_id`, `terminal_id`, `device_id`, `shift_id` FK restrict, `customer_id` FK set null,
`reason_code`, `note`, `refunded_minor`, the four tax columns plus `tax_total_minor` and `base_minor`,
the PIN proof (`approved_by_user_id`, `approved_by_staff_id`, `approval_pin_version`,
`approval_reason_code`, `approved_at`), `approval_id` FK `approval` restrict, `occurred_at`,
`received_at`, `created_at`. Indexes: `unique(number)`, `(sale_id)`, `(branch_id, occurred_at)`,
`(shift_id)`.

`refund_line`: `id`, `refund_id` FK cascade, `sale_line_id` FK restrict, `product_id` FK restrict,
`line_number`, `quantity`, `unit_price_minor`, `unit_cost_minor`, `restock`, `damage_reason`,
`base_minor`, `vat_minor`, `nhil_minor`, `getfund_minor`, `tax_total_minor`, `total_minor`.
`unique(refund_id, line_number)`, index `(sale_line_id)`.

`refund_tender`: `id`, `refund_id` FK cascade, `sequence`, `method` (`sale_tender_method`),
`amount_minor`, `sale_tender_id` FK restrict, `payment_id` FK `payment` restrict,
`provider_refund_reference`, `status` default `SETTLED`, `settled_at`, `failed_message`.
`unique(refund_id, sequence)`, index `(sale_tender_id)`, `(provider_refund_reference)`.

**Why the refund references `sale_line` and `sale_tender`, not just the sale:** the cap is per line
and per tender (P13-D19), and a cap that is not tied to a row is a cap a retry can exceed.

### 5. `cart_void` (in `pos.schema.ts`)

```ts
export const cartVoidReasonEnum = pgEnum('cart_void_reason',
  ['CUSTOMER_CHANGED_MIND','WRONG_ITEM','PRICE_DISPUTE','DUPLICATE_SCAN','CUSTOMER_LEFT','OTHER'])
```

Columns: `id`, `branch_id`, `terminal_id`, `device_id`, `shift_id` FK restrict,
`cashier_user_id`, `cashier_staff_id`, `reason_code`, `note`, `item_count`, `gross_minor`, `label`,
`lines` jsonb, `occurred_at`, `received_at`, `created_at`. Indexes: `(branch_id, occurred_at)`,
`(terminal_id, occurred_at)`, `(reason_code)`.

### 6. `shift_report` (in `pos.schema.ts`)

One row per shift, `unique(shift_id)`, no update path. Columns: `id`, `shift_id` FK restrict,
`branch_id`, `terminal_id`, `device_id`, `number`, `opened_at`, `closed_at`, `opening_float_minor`,
`sale_count`, `item_count`, `refund_count`, `void_count`, `gross_minor`, `refund_minor`,
`net_minor`, `line_discount_minor`, `sale_discount_minor`, `loyalty_discount_minor`,
`loyalty_redeem_points`, `loyalty_earned_points`, `base_minor`, `vat_minor`, `nhil_minor`,
`getfund_minor`, `tax_total_minor`, `cash_minor`, `credit_minor`, `momo_minor`, `card_minor`,
`bank_transfer_minor`, `change_minor`, `cash_in_minor`, `cash_out_minor`, `expected_cash_minor`,
`counted_cash_minor`, `variance_minor`, `created_at`.

Index `(branch_id, closed_at)`. The comment on the table states P13-D32 in one line: *written inside
the close transaction and never updated; a correction is a new document.*

### 7. Settings, sequences, queue names

`settings.validation.ts`, appended in this order:

```ts
'pos.refundApprovalThresholdMinor': { schema: z.number().int().min(0).max(1_000_000),
  defaultValue: 20_000, branchScoped: true, writableBy: 'admin' },
```

One key, not three. There is no `pos.refundPrefix`/`pos.refundSequence`: the **till** allocates the
refund number from its local `document_sequence` because a refund must be numbered offline, and a
server sequence nothing writes is a setting that lies.

`jobs/queues.ts` gains two exported names and nothing else in this plan:

```ts
export const POS_REFUND_DISPATCH_QUEUE = 'pos-refund-dispatch'
export const POS_PAYMENT_RECONCILE_QUEUE = 'pos-payment-reconcile'
export const POS_PAYMENT_RECONCILE_CRON = '20 1 * * *'
```

Registering the workers and schedules lands in Plans 05 and 07 with the code they run.

### 8. Environment

`api/src/config/env.ts`:

```ts
PAYSTACK_MODE: z.enum(['mock', 'test', 'live']).default('mock'),
PAYSTACK_SECRET_KEY: optionalNonEmpty(z.string().min(8)),
PAYSTACK_WEBHOOK_SECRET: optionalNonEmpty(z.string().min(8)),
PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
PAYSTACK_EMAIL_DOMAIN: z.string().min(3).default('sceptre-drive.example'),
```

Then a refinement: `mode !== 'mock'` requires `PAYSTACK_SECRET_KEY`; `mode === 'live'` requires
`NODE_ENV === 'production'`; `PAYSTACK_WEBHOOK_SECRET` falls back to the secret key. Failure is a boot
error naming the variable, not a runtime 500.

`.env.example` gains the four new keys with `PAYSTACK_MODE=mock` unchanged, and one comment saying
that `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` and `PAYSTACK_EMAIL_DOMAIN` are what Phase 15's
go-live checklist fills.

### 9. `pos.types.ts`

`SyncConflictType` gains `'PAYMENT_LATE_SETTLEMENT' | 'PAYMENT_AMOUNT_MISMATCH'`, and
`pos.schema.ts`'s `sync_conflict_type` pgEnum is extended to match — the two lists are asserted equal
by an existing test, which must stay green.

## Tests

- `api/src/modules/platform/settings.test.ts`: the new key resolves to its default, the threshold is
  branch-overridable and **refuses a manager write**.
- `api/src/modules/platform/env.test.ts` (or the existing env test): `mode = 'test'` without a key
  throws with the variable name; `mode = 'mock'` boots without any key; `live` outside production
  throws.
- A migration test that is really a smoke test: the whole suite runs against a database migrated from
  zero (`db:test:prepare`), so a missing `ALTER TYPE` fails every suite at once. Plan 13 records the
  from-zero cycle.
- `sync_conflict_type` parity: the pgEnum values and `SyncConflictType` are the same set, in order.

## Verification

```bash
bun run db:migrate
bun run db:test:prepare
bun run --filter api test
bun run check-types
```

Expected: API stays at **596** (this plan adds no POS behaviour), shared at its Plan 01 figure, and
no existing test edited except the two count assertions named above.

## Commits

1. `feat(api): enum-only migration for the phase 13 tender, ledger and conflict values`
2. `feat(api): payment and payment-event tables with a one-way dependency on pos`
3. `feat(api): refund, refund-line and refund-tender tables`
4. `feat(api): cart-void and the immutable shift report`
5. `feat(api): refund threshold, numbering and the payment environment keys`
6. `test(api): settings scope, env fail-closed and enum parity`

## Done when

- A split sale can be stored: two tenders of one method, ordered, one of them referencing a payment.
- A refund has somewhere to record a per-line restock choice and a per-tender cap.
- `PAYSTACK_MODE=mock` boots with no credentials and `mode=test` refuses to.
