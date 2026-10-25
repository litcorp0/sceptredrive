---
phase: 11-procurement-replenishment
plan: 02
title: Schema, migration, settings, document numbering, seeds
lane: api
depends_on: [01]
requirements: [PROC-01, PROC-02, PROC-05, PROC-06, PROC-08, PROC-09, PROC-10, MGR-01, MGR-02]
---

# Plan 02 — The schema everything else stands on

## Goal

Every table, column, enum, setting, sequence and seed helper this phase needs exists, applies to
a fresh database **and** to the current development database, and is proven by a query rather
than by a successful `migrate` exit code. Three empty module routers are created and mounted so
no later plan has to edit `app.ts` again.

No service logic, no endpoint behaviour, no screen.

## Read first

- `00-DECISIONS.md` P11-D3, P11-D14, P11-D15, P11-D16.
- `01-RESEARCH.md` § "PostgreSQL 17 — adding enum values is a two-migration problem".
- `api/src/modules/inventory/inventory.schema.ts:15-166` — the stock ledger, receipt, and
  threshold shapes this plan extends.
- `api/src/modules/payables/payables.schema.ts:19-124` — invoice and line shapes.
- `api/src/modules/suppliers/suppliers.schema.ts:103-132` — `supplier_product`.
- `api/src/modules/platform/settings.validation.ts` in full — the declaration style to extend.
- `api/src/modules/platform/settings.service.ts:84-166` — `updateSetting`, whose branch rules
  change here.
- `api/migrations/0007_common_next_avengers.sql:8-9` — the enum-addition precedent.
- `api/src/seed/helpers.ts:533-670` — `ensureStockReceipt`, `ensureStockThreshold`.

## Tasks

### 1. `approvals` module — the shared entity

`api/src/modules/approvals/approvals.schema.ts`:

```ts
export const approvalTypeEnum = pgEnum('approval_type', [
  'PURCHASE_ORDER', 'PRODUCT_CREATE', 'TRANSFER_REQUEST', 'STOCK_WRITE_OFF',
  'PRICE_CHANGE', 'CREDIT_LIMIT_CHANGE', 'SHIFT_VARIANCE_REVIEW', 'REFUND',
])
export const approvalStatusEnum = pgEnum('approval_status',
  ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'])
export const approvalReasonCodeEnum = pgEnum('approval_reason_code',
  ['OVER_THRESHOLD', 'PRICE_TOO_HIGH', 'OUT_OF_POLICY', 'INCOMPLETE', 'DUPLICATE', 'OTHER'])
```

`approval` columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `type` | `approval_type` NOT NULL | only `PURCHASE_ORDER` and `PRODUCT_CREATE` are written in Phase 11; a comment names the owning phase for the rest |
| `entity_id` | uuid NULL | the PO id; **NULL for `PRODUCT_CREATE`**, because the product does not exist yet |
| `branch_id` | uuid NOT NULL → branch restrict | the branch the decision is about |
| `status` | `approval_status` NOT NULL DEFAULT `PENDING` | |
| `requested_by` | text NOT NULL | `actorLabel` — staff id, else user id |
| `requested_at` | timestamptz NOT NULL DEFAULT now() | |
| `request_note` | text NULL | |
| `amount_minor` | integer NULL | goods value at request time (P11-D2); the number the decision is about |
| `payload` | jsonb NOT NULL DEFAULT `'{}'` | the proposed product for `PRODUCT_CREATE`; `{}` for a PO |
| `decided_by` | text NULL | |
| `decided_at` | timestamptz NULL | |
| `decision_reason_code` | `approval_reason_code` NULL | |
| `decision_note` | text NULL | |
| `created_at` / `updated_at` | timestamptz NOT NULL | `updated_at` `$onUpdate` |

Indexes:

- `uniqueIndex('approval_open_entity_unique').on(type, entityId).where(sql\`status = 'PENDING' AND entity_id IS NOT NULL\`)`
  — one open approval per order, so a double-submit cannot queue two decisions.
- `index('approval_branch_status_requested_idx').on(branchId, status, requestedAt)`
- `index('approval_type_status_idx').on(type, status)`

`approvals.schema.ts` must **not** import `procurement.schema.ts`; the reference is a plain uuid
by design (polymorphic), and that keeps the dependency one-directional.

Create the remaining six files as minimal, compiling stubs (`export const approvalsRoutes =
factory.createApp()` and a doc comment naming the plan that fills them). Plan 03 fills them.

### 2. `procurement` module — orders, returns, credit notes

`api/src/modules/procurement/procurement.schema.ts`:

```ts
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED',
  'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED',
])
export const supplierReturnStatusEnum = pgEnum('supplier_return_status', ['DRAFT', 'POSTED', 'CANCELLED'])
export const overReceiptReasonEnum = pgEnum('over_receipt_reason', [
  'SUPPLIER_SENT_MORE', 'ORDER_ROUNDING', 'SUBSTITUTE', 'OTHER',
])
```

**`purchase_order`** — no money columns (P11-D2):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `number` | text NOT NULL | `purchase_order_number_unique`; `PO-ACC-202610-0001` |
| `branch_id` | uuid NOT NULL → branch restrict | |
| `supplier_id` | uuid NOT NULL → supplier restrict | |
| `status` | enum NOT NULL DEFAULT `DRAFT` | |
| `expected_date` | date NULL | drives on-time rate |
| `note` | text NULL | |
| `requested_by` | text NOT NULL | |
| `approval_id` | uuid NULL → `approval.id` restrict | null for auto-approved orders (P11-D6) |
| `submitted_at`, `approved_at`, `rejected_at`, `sent_at`, `closed_at`, `cancelled_at` | timestamptz NULL | |
| `sent_by`, `closed_by`, `cancelled_by` | text NULL | |
| `close_note`, `cancel_reason` | text NULL | |
| `idempotency_key` | text NULL | unique with `branch_id` |
| `created_by`, `created_at`, `updated_at` | | |

Indexes: unique `number`; unique `(branch_id, idempotency_key)`; `(branch_id, status, created_at)`;
`(supplier_id, status)`; `(expected_date)`.

**`purchase_order_line`**: `id`, `order_id` → cascade, `line_number` integer, `product_id` →
restrict, `quantity` integer NOT NULL, `unit_cost_minor` integer NOT NULL, `created_at`.
Unique `(order_id, product_id)` and `(order_id, line_number)`; index `product_id`.

**`supplier_return`**: `id`, `number` (unique, `PR-…`), `branch_id`, `supplier_id`,
`purchase_order_id` → restrict NULL, `receipt_id` → `stock_receipt` restrict NULL,
`status` DEFAULT `DRAFT`, `reason` text NOT NULL, `note` NULL,
`credit_note_number` text NULL (ours, set at post), `supplier_credit_note_number` text NULL
(theirs), `posted_at`/`posted_by`, `cancelled_at`/`cancelled_by`/`cancel_reason`,
`idempotency_key` (unique with branch), `created_by`, timestamps.
Indexes: `(branch_id, status, created_at)`, `(supplier_id, created_at)`.

**`supplier_return_line`**: `id`, `return_id` → cascade, `receipt_line_id` →
`stock_receipt_line` restrict, `purchase_order_line_id` → restrict NULL, `product_id` → restrict,
`quantity` integer NOT NULL, `unit_cost_minor` integer NOT NULL.
Unique `(return_id, receipt_line_id)`; index `receipt_line_id`.

**`supplier_credit_note`**: `id`, `number` (unique, `SCN-…`), `branch_id`, `supplier_id`,
`return_id` → restrict **unique**, `amount_minor` integer NOT NULL, `posted_at`, `created_by`,
`created_at`. Indexes: `(branch_id, posted_at)`, `(supplier_id)`.

Create the other six files as compiling stubs (empty router), filled by Plans 04, 05 and 07.

### 3. Extend the tables Phase 3 and 5 already own

| Table | Adds | Why |
|---|---|---|
| `stock_threshold` | `max_quantity` integer NULL, `min_order_quantity` integer NOT NULL DEFAULT 0 | P11-D3 |
| `stock_receipt` | `purchase_order_id` uuid NULL → `purchase_order` restrict; index; `idempotency_key` text NULL with `unique(branch_id, idempotency_key) WHERE idempotency_key IS NOT NULL` | D4, P11-D20 |
| `stock_receipt_line` | `purchase_order_line_id` uuid NULL → `purchase_order_line` restrict (index), `over_receipt_reason` enum NULL, `over_receipt_note` text NULL | D4 |
| `supplier_invoice` | `purchase_order_id` uuid NULL → `purchase_order` restrict; index | D5 |
| `supplier_invoice_line` | `purchase_order_line_id` uuid NULL → `purchase_order_line` restrict (index), `match_status` `invoice_match_status` NOT NULL DEFAULT `UNMATCHED` | D5 + line-level matching |
| both movement enums | `SUPPLIER_RETURN` | D6 |

`invoice_match_status` enum: `UNMATCHED`, `MATCHED`, `PRICE_VARIANCE`, `QUANTITY_VARIANCE`,
`PRICE_AND_QUANTITY_VARIANCE`, `NOT_ON_ORDER`.

**The `stock_receipt_line` unique index stays** `(receipt_id, product_id)`. One product once per
receipt is already the rule, and a PO cannot carry a product on two lines either
(`(order_id, product_id)` unique), so the two constraints agree.

### 4. `document_sequence` (P11-D15)

`api/src/modules/platform/sequences.schema.ts`:

```ts
export const documentSequence = pgTable('document_sequence', {
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').notNull().references(() => branch.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  period: text('period').notNull(),        // 'YYYY-MM', Africa/Accra
  value: integer('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [uniqueIndex('document_sequence_unique').on(t.branchId, t.kind, t.period)])
```

`api/src/modules/platform/sequences.service.ts`:

```ts
export type DocumentKind = 'purchase_order' | 'supplier_return' | 'supplier_credit_note'

/** Prefix setting, label, and zero-padding per document kind. */
export const DOCUMENT_KINDS: Record<DocumentKind, {
  prefixKey: 'procurement.orderPrefix' | 'procurement.returnPrefix' | 'procurement.creditNotePrefix'
  label: string
  pad: number
}>

/** Locks the (branch, kind, period) row, increments it, and returns e.g. PO-ACC-202610-0001. */
export async function allocateDocumentNumber(
  kind: DocumentKind,
  branchId: string,
  executor: DbExecutor,          // REQUIRED, as allocateFromSequence
): Promise<{ number: string; sequenceValue: number }>
```

- The period is `new Date().toISOString().slice(0, 7)`. Africa/Accra is UTC+0 with no DST, so a
  UTC month boundary is an Accra month boundary — state that in a comment; do not import a
  timezone library.
- **The counter stores the last serial issued, not the next one**, and is bumped with
  `UPDATE … SET value = value + 1 … RETURNING value`. That statement takes the row lock for its
  own duration, so the allocator is safe in an autocommit call as well as inside a transaction —
  whereas a `SELECT … FOR UPDATE` followed by a write is only safe inside one, and this helper is
  reachable from both. The first-use race is `insert … on conflict do nothing` (value 0) and a
  retry. Implemented this way during execution; the concurrency test fails if it regresses to
  read-then-write.
- The branch code is read from `branch.code`; the prefix from `getSettingValue(prefixKey, {},
  executor)`.
- Three attempts, then `AppError(500, 'INTERNAL', 'Could not allocate a <label>')`.
- Gaps are acceptable and documented: a rolled-back transaction burns its number.

Tests (`api/src/modules/platform/sequences.test.ts`, real database):

- two sequential calls on the same branch/kind/period yield `…-0001`, `…-0002`;
- two **concurrent** calls yield two distinct numbers and the stored value is 3 after both;
- a different branch starts at 1; a different month starts at 1;
- a rolled-back outer transaction does not consume a number that a later call repeats
  (gaps allowed, duplicates not) — assert uniqueness, not contiguity.

### 5. Settings: `writableBy`, and six new keys

`settings.validation.ts` — each definition gains an **optional** `writableBy?: 'admin' | 'manager'`.
Default, implemented once in `updateSetting`:

```ts
const writableBy = definition.writableBy ?? (definition.branchScoped ? 'manager' : 'admin')
```

That default preserves today's behaviour exactly: global keys are already admin-only, and
branch-scoped keys are already manager-writable for their own branch. Only the new keys set it
explicitly.

`updateSetting` (`settings.service.ts:84-166`) gains one check, before the existing branch rules:

```ts
if (writableBy === 'admin' && roleOf(user) !== 'ADMIN') {
  throw new ForbiddenError('Only an admin can change this setting')
}
```

New keys:

| Key | Schema | Default | `branchScoped` | `writableBy` |
|---|---|---|---|---|
| `procurement.approvalThresholdMinor` | `z.number().int().min(0).max(1_000_000_000)` | `1_000_000` | true | `'admin'` |
| `procurement.safetyDays` | `z.number().int().min(0).max(365)` | `7` | true | `'manager'` |
| `procurement.defaultLeadDays` | `z.number().int().min(1).max(365)` | `14` | false | — |
| `procurement.orderPrefix` | `z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/)` | `'PO'` | false | — |
| `procurement.returnPrefix` | same | `'PR'` | false | — |
| `procurement.creditNotePrefix` | same | `'SCN'` | false | — |

Do **not** add sequence counters here — P11-D15 moved counters to `document_sequence`.

Tests (`settings` block inside `platform.test.ts` or a new `settings.test.ts`):

- a manager writing `procurement.approvalThresholdMinor` on their own branch → **403**;
- an admin writing it for a branch → 200, resolved with `source: 'branch'`;
- a manager writing `procurement.safetyDays` on their own branch → 200 (unchanged behaviour);
- a manager writing `procurement.defaultLeadDays` → 403 (global, as today);
- an unknown value (negative, a float) → 400.

### 6. Generate the migration, then split it by hand

```bash
bun run --filter api db:generate     # writes one file for everything above
```

Then **split** — this is the step that fails on a real database if skipped (P11-D16):

1. `api/migrations/NNNN_enum_supplier_return.sql` — exactly:

```sql
ALTER TYPE "public"."stock_movement_reference" ADD VALUE 'SUPPLIER_RETURN';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'SUPPLIER_RETURN';
```

2. `api/migrations/NNNN_procurement.sql` — every other statement the generator produced.

Rules:
- The enum file contains **no** `CREATE`, `ALTER TABLE`, `INSERT`, `UPDATE`, or `DEFAULT` that
  mentions `SUPPLIER_RETURN`.
- `journal.json` must list both files in the split order, with increasing `idx` and `when`
  values. Hand-edit it and re-run `db:migrate` to prove the runner accepts the pair.
- Do **not** re-run `db:generate` after the split; the next phase starts from the split state.
  If the generator must be re-run, delete both hand-split files and repeat.

Then apply to both databases:

```bash
bun run db:migrate
bun run db:test:prepare
```

The dev database is not empty: it holds Phase 1–10 data. The migration must apply to it without
a manual step. `stock_threshold` needs a backfill:

```sql
UPDATE stock_threshold SET max_quantity = threshold * 2 WHERE max_quantity IS NULL;
```

(Generated by drizzle as a data statement inside the main file, after the `ADD COLUMN`.)

### 7. Seed helpers (`api/src/seed/helpers.ts`)

Add, matching the existing `ensure*` style (idempotent, returns whether it created):

```ts
export async function ensureDocumentSequence(kind: string, branchId: string, period: string, value: number): Promise<boolean>
export async function ensurePurchaseOrder(input: {
  number?: string; branchCode: string; supplierCode: string;
  status?: PurchaseOrderStatus; expectedDate?: string;
  lines: { sku: string; quantity: number; unitCostMinor: number }[];
}): Promise<{ id: string; number: string }>
export async function ensureApproval(input: {
  type: ApprovalType; entityId?: string | null; branchId: string;
  requestedBy: string; amountMinor?: number; payload?: unknown; status?: ApprovalStatus;
}): Promise<{ id: string }>
```

`ensurePurchaseOrder` must allocate through `allocateDocumentNumber` when `number` is omitted, so
a seeded order and a real one cannot disagree about the format.

### 8. API module skeleton for `replenishment`

`api/src/modules/replenishment/` — the seven files, minimal and compiling. `replenishment.schema.ts`
is `export {}` with a doc comment, exactly like `analytics/analytics.schema.ts:1-10`, because the
module owns no tables. Plan 08 fills the rest.

**The admin module gate is not touched in this plan.** `scripts/check-modules.mjs` treats a
required-but-absent module directory as a hard failure, and `PENDING_MODULES` makes `--strict`
red, which is CI. The two console module names are added by Plan 09 in the same commit that
creates their directories, so the gate is green at every commit in this phase.

### 9. Mount the three routers

`api/src/app.ts` — three imports and three `app.route('/', xRoutes)` lines, in the existing
alphabetical block. The routers are empty in this plan; mounting them is a no-op that saves every
later plan an edit to a shared file.

## Verification

```bash
bun run db:migrate
bun run db:test:prepare
bun run --filter api test
bun run check-types
bun run lint
bun run modules:check
```

And query the database, do not trust the exit code:

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname IN ('stock_movement_type','stock_movement_reference') AND enumlabel = 'SUPPLIER_RETURN';
-- 2 rows

SELECT count(*) FROM stock_threshold WHERE max_quantity IS NULL;          -- 0
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'supplier_invoice_line' AND column_name IN ('purchase_order_line_id','match_status'); -- 2
SELECT count(*) FROM information_schema.tables WHERE table_name IN
 ('purchase_order','purchase_order_line','supplier_return','supplier_return_line',
  'supplier_credit_note','approval','document_sequence');                  -- 7
```

Expected: API suite **unchanged** at its Phase 10 count (394) and green; shared unchanged at its
Plan 01 count; `modules:check` still reports 15/15 admin modules (the two console modules arrive
in Plan 09); no client file touched.

## Commits

1. `feat(api): procurement, approval, return and credit-note schema`
2. `feat(api): branch-month document numbering`
3. `feat(api): procurement settings and the admin-only writable flag`
4. `feat(api): seed helpers for purchase orders, approvals and sequences`
5. `chore(api): generate the phase 11 migration and split the enum additions`

## Done when

- Every table and column in this plan exists in `api/migrations/**` and in the running dev and
  test databases.
- `SUPPLIER_RETURN` is present in both movement enums, added by a migration that contains
  nothing else.
- `allocateDocumentNumber` produces `PO-ACC-202610-0001`, unique under concurrency, and resets
  per branch and per month.
- A manager cannot change the approval threshold; an admin can, per branch.
- Existing `stock_threshold` rows have `max_quantity = threshold × 2`.
- Three module routers are mounted and empty; no endpoint answers differently than before.
