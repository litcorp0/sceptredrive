---
phase: 11-procurement-replenishment
plan: 01
title: Shared vocabulary — permissions, approval types, replenishment arithmetic
lane: shared (packages/** alone)
depends_on: []
requirements: [PROC-01, PROC-02, PROC-06, PROC-07, MGR-01, MGR-02, MGR-03, MGR-04, MGR-05]
---

# Plan 01 — Shared vocabulary

## Goal

Three things are written once, before any table exists, because both the API and the console
must agree on them and a second implementation is how they drift:

1. the **permission keys** this phase's routes check and the client renders;
2. the **approval vocabulary** (types, statuses, reason codes) that Phases 11–13 share;
3. the **replenishment and order arithmetic** — pure functions with the full input exposed, so
   the screen can show every number the suggestion used.

Nothing in this plan changes an endpoint, a table, or a screen.

## Read first

- `AGENTS.md` rules 3, 4 and 5.
- `00-DECISIONS.md` P11-D2, P11-D3, P11-D12, P11-D14, P11-D18.
- `packages/shared/src/permissions.ts` in full (54 keys, `ROLE_PERMISSIONS`).
- `packages/shared/src/percent.ts` — the integer-validation and rounding conventions to copy.
- `packages/shared/src/inventory.ts` — `averageCostAfterReceipt`, the tone to match.
- `packages/shared/src/index.ts` — exports are alphabetical; keep them so.

## Tasks

### 1. Permissions (`packages/shared/src/permissions.ts`)

Add, in the existing alphabetical placement:

```
procurement.approve
procurement.create
procurement.read
procurement.receive
procurement.return
```

`ADMIN_PERMISSIONS` is already "everything", so it needs no edit. Add to `MANAGER_PERMISSIONS`:

- `procurement.read`, `procurement.create`, `procurement.receive`, `procurement.return`
- `supplier.create` — MGR-01

**Do not** add `procurement.approve`: approval is admin-only (P11-D18).

**Do not** grant `catalog.create` or `catalog.update` to the manager. `00-CONTEXT.md` D12 says
"`catalog.create` is granted to the manager but is approval-gated", but that permission also
guards category, brand, and unit creation (`api/src/modules/catalog/catalog.routes.ts`), and
there is no approval flow for those. Product submission therefore uses `procurement.create`
(P11-D21), which is exactly what it is: a procurement request. Editing a product's base price
is price policy and stays admin (`price.update`).

**Do not** add `catalog.archive` or `price.update`. Those stay admin.

Tests (`packages/shared/src/permissions.test.ts`, new file if absent):

- a manager has all five `procurement.*` except `approve`;
- a cashier has none of them;
- `can("MANAGER", "catalog.create") === true` and `can("MANAGER", "catalog.archive") === false`;
- every new key appears in `PERMISSIONS` exactly once (guards a duplicate literal).

### 2. Approval vocabulary (`packages/shared/src/approvals.ts`)

```ts
export const APPROVAL_TYPES = [
  'PURCHASE_ORDER',          // Phase 11
  'PRODUCT_CREATE',          // Phase 11
  'TRANSFER_REQUEST',        // Phase 12
  'STOCK_WRITE_OFF',         // Phase 12
  'PRICE_CHANGE',            // Phase 12
  'CREDIT_LIMIT_CHANGE',     // Phase 12
  'SHIFT_VARIANCE_REVIEW',   // Phase 12
  'REFUND',                  // Phase 13
] as const

export type ApprovalType = (typeof APPROVAL_TYPES)[number]
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

export const APPROVAL_REASON_CODES = [
  'OVER_THRESHOLD', 'PRICE_TOO_HIGH', 'OUT_OF_POLICY',
  'INCOMPLETE', 'DUPLICATE', 'OTHER',
] as const
export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number]

/** Every type is decided by an ADMIN in v1; Phase 12 may add a branch-manager type. */
export const APPROVAL_DECIDER_ROLE: Record<ApprovalType, 'ADMIN'> = { … }

/** Statuses that can no longer change. */
export function isDecided(status: ApprovalStatus): boolean
```

`purchaseOrderStatusLabel`-style display strings stay in the client — the API returns machine
values, the console owns words (the Phase 10 lesson).

Tests: every type has a decider role; `isDecided('PENDING')` is false and the other three true.

### 3. Order arithmetic (`packages/shared/src/procurement.ts`)

```ts
/** Σ quantity × unit cost, in minor units. Throws on a non-positive quantity or a
 *  negative/non-integer cost, and on a non-safe-integer result. */
export function goodsValueMinor(
  lines: readonly { quantity: number; unitCostMinor: number }[],
): number

/** PROC-02: at or above the threshold needs a human. Equal to it counts as above. */
export function requiresApproval(goodsValueMinor: number, thresholdMinor: number): boolean

export type PurchaseOrderAction = 'submit' | 'send' | 'receive' | 'close' | 'cancel'
export type PurchaseOrderStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED'

/** The one transition table. Returns false rather than throwing. */
export function canApplyOrderAction(
  status: PurchaseOrderStatus,
  action: PurchaseOrderAction,
): boolean

/** Receipt outcome from ordered/received pairs. `received` includes the lines being posted. */
export function orderFulfilment(
  lines: readonly { ordered: number; received: number }[],
): { anyReceived: boolean; allReceived: boolean; overReceived: boolean }
```

Transition table (the matrix the service and the screen both read):

| From | submit | send | receive | close | cancel |
|---|---|---|---|---|---|
| DRAFT | ✅ | — | — | — | ✅ |
| PENDING_APPROVAL | — | — | — | — | ✅ |
| APPROVED | — | ✅ | ✅ | ✅ | ✅ |
| SENT | — | — | ✅ | ✅ | ✅ (`SENT` only before any receipt) |
| PARTIALLY_RECEIVED | — | — | ✅ | ✅ | — |
| RECEIVED | — | — | — | ✅ | — |
| REJECTED / CLOSED / CANCELLED | — | — | — | — | — |

Cancel-before-any-receipt is enforced by the service (it needs the receipt count), not by this
pure function; the table admits `cancel` on `SENT` for that service to decide.

Tests: `requiresApproval(999_999, 1_000_000) === false`, `=== true` at exactly `1_000_000` and
above; `goodsValueMinor` rejects `0` quantity, negative cost, non-integers, and an overflow beyond
`Number.MAX_SAFE_INTEGER`; the full transition matrix row by row; `orderFulfilment` for
none/some/all/over.

### 4. Replenishment arithmetic (`packages/shared/src/replenishment.ts`)

```ts
/** The trailing window the suggestion is computed over. Fixed, not a setting. */
export const VELOCITY_DAYS = 90

/** Ceiling division on non-negative safe integers. Divides once, at the end. */
export function ceilDiv(numerator: number, denominator: number): number

export interface ReplenishmentInputs {
  /** Units sold at this branch in the trailing VELOCITY_DAYS. */
  unitsSold: number
  /** stock_level.quantity_on_hand, 0 when the branch has never stocked it. */
  onHand: number
  /** Σ(max(ordered − received, 0)) over open order lines (D9). */
  onOrder: number
  /** stock_threshold.threshold — the minimum that triggers a reorder. */
  minLevel: number
  /** stock_threshold.max_quantity — null when unset. */
  maxLevel: number | null
  /** stock_threshold.min_order_quantity (P11-D3). */
  minOrderQuantity: number
  /** supplier_product.lead_time_days, already resolved by the caller to a number. */
  leadTimeDays: number
  /** True when leadTimeDays came from procurement.defaultLeadDays. */
  leadTimeAssumed: boolean
  safetyDays: number
}

export interface ReplenishmentSuggestion {
  /** max(stored max, coverage). What the row is topped up to. */
  targetLevel: number
  /** ceilDiv(unitsSold × (leadTimeDays + safetyDays), VELOCITY_DAYS). */
  coverageLevel: number
  /** onHand + onOrder — the inventory position the suggestion is derived from. */
  position: number
  /** The answer, always ≥ 0 and always a whole number of units. */
  suggested: number
  /** Why the suggestion is what it is; the screen prints this. */
  basis: 'COVERAGE' | 'STORED_MAX' | 'NO_HISTORY' | 'NO_LEVEL' | 'AT_TARGET' | 'MIN_ORDER'
}

export function suggestReplenishment(input: ReplenishmentInputs): ReplenishmentSuggestion
```

Rules, exactly:

```
coverage = ceilDiv(unitsSold * (leadTimeDays + safetyDays), VELOCITY_DAYS)
target   = max(maxLevel ?? 0, coverage)
position = onHand + onOrder
suggested= max(clamp(target - position, 0, max(target, 0)), minOrderQuantity)
```

- Every argument must be a non-negative safe integer; `leadTimeDays`/`safetyDays` may be 0;
  `maxLevel` may be null. Anything else throws `TypeError` (house style: `percent.ts`,
  `inventory.ts`).
- `suggested === 0` when `position >= target` **and** `minOrderQuantity === 0`; a MOQ of 10
  yields 10 even at target, because that is what a MOQ means. `basis` says `AT_TARGET`.
- `unitsSold === 0` → `coverage = 0`, `basis = 'NO_HISTORY'`, and the target is the stored max
  alone. This is the "do not invent demand" rule from the research.
- `maxLevel === null && coverage === 0` → `basis = 'NO_LEVEL'`, `suggested = minOrderQuantity`.
- A never-stocked product (`onHand = 0`, no `stock_level` row) behaves identically — that is the
  PROC-06 "parts the branch has never stocked" requirement, proven by a test case.

Tests (`replenishment.test.ts`):

| Case | Expectation |
|---|---|
| 900 sold / 90 d, lead 7, safety 7, max 40, on hand 10, on order 0 | coverage 140 → target 140 → suggested 130 |
| same, on order 130 | suggested 0 (`AT_TARGET`) |
| 0 sold, max 40, on hand 10, MOQ 0 | suggested 30 (`NO_HISTORY`) |
| 0 sold, max 40, on hand 10, MOQ 50 | suggested 50 (`MIN_ORDER` — the floor is what set it) |
| 0 sold, max null, MOQ 0 | suggested 0 (`NO_LEVEL`) |
| on hand 500 > target 140 | suggested 0, never negative |
| a non-integer or negative argument | throws `TypeError` |
| `ceilDiv(1, 90) === 1`, `ceilDiv(0, 90) === 0`, `ceilDiv(900, 90) === 10` |

Also assert **no float escapes**: `Number.isSafeInteger` on every field of the result.

### 5. Exports and types

`packages/shared/src/index.ts` gains `approvals.ts` and `replenishment.ts` in alphabetical order,
and `procurement.ts` between `pricing.ts` and `replenishment.ts`. Nothing else moves.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run --filter @sceptre/shared check-types
bun run --filter api test
bun run lint
```

Expected:

- shared tests grow by roughly 30, all new; every existing test passes **unedited**;
- the API suite is unchanged and green — this plan adds no API import of the new files, so the
  only way it can break the API is a type error;
- `grep -rn "procurement\." packages/shared/src/permissions.ts` shows exactly five keys.

## Commits

1. `feat(shared): procurement permissions and approval vocabulary`
2. `feat(shared): order value, transitions, and receipt outcome`
3. `feat(shared): integer replenishment arithmetic with explicit inputs`

## Done when

- Five `procurement.*` permissions exist; the manager holds four and not `approve`.
- `goodsValueMinor`, `requiresApproval`, `canApplyOrderAction`, `orderFulfilment`,
  `suggestReplenishment` and `ceilDiv` are exported from `@sceptre/shared` and covered by tests.
- The threshold boundary is tested at exactly the limit.
- No API, client, migration, or config file changed.
