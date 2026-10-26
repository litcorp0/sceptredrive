---
phase: 12-branch-ops-approvals
plan: 01
title: Shared vocabulary — approval permissions, authority, band and count arithmetic
lane: shared
depends_on: []
requirements: [APR-01, APR-03, BRN-03, BRN-04, CC-01, CC-04, CC-05]
---

# Plan 01 — The vocabulary every later plan compiles against

## Goal

`packages/shared` owns every rule that both the API and the console must agree on: who may decide
an approval, whether a price is inside the manager's band, when a count is next due, which ABC
class a share earns, and how accuracy is expressed. Nothing in this plan reads a database, and
nothing in it imports a client.

This plan is alone and first because it **renames a permission** and **replaces the decider-role
table**. Every plan after it compiles against the new names.

## Read first

- `00-DECISIONS.md` P12-D1, P12-D2, P12-D18, P12-D28, P12-D29, P12-D33.
- `packages/shared/src/permissions.ts` — the vocabulary and the three role lists.
- `packages/shared/src/approvals.ts` — `APPROVAL_TYPES`, `APPROVAL_DECIDER_ROLE`, `isDecided`.
- `packages/shared/src/pricing.ts` — `resolveEffectivePrice`, `isValidPriceMinor`.
- `packages/shared/src/percent.ts` — `BASIS_POINT_SCALE`, `ratioBp` (do not duplicate).
- `packages/shared/src/dates.ts:158-256` — `accraDay`, `accraIsoDay`, `accraDayBounds`. The lesson
  from Phase 10: a bare `YYYY-MM-DD` string parses as **local** midnight, so date arithmetic is
  done on calendar parts, never on `Date` arithmetic across a zone.

## Tasks

### 1. Permissions (`permissions.ts`)

- **Remove** `'procurement.approve'` from `PERMISSIONS` (D1: one name for one action).
- **Add** `'approval.read'` and `'approval.decide'` (place them before the `procurement.*` group).
- Grant both to `MANAGER_PERMISSIONS`; `ADMIN_PERMISSIONS = PERMISSIONS` already has them.
- `CASHIER_PERMISSIONS` stays `[]`.
- Update `permissions.test.ts`: the manager list contains `approval.read` / `approval.decide` and
  does **not** contain `procurement.approve`; the admin list is exactly `PERMISSIONS`.

Removing the string breaks the one API call site that names it
(`approvals.routes.ts:32`, the decide route). **Plan 02 bridges that single line** to
`approval.decide` so every commit in the phase compiles; Plan 03 then rewrites the routes file.
Do not leave the old string in the vocabulary to keep the tree green — a dead permission is how
a route ends up checking the one nobody grants.

No other permission changes. `inventory.adjust` remains the permission that may *raise* a
write-off (P12-D13); `approval.decide` is what may *decide* one.

### 2. Authority (`approvals.ts`)

Replace `APPROVAL_DECIDER_ROLE` / `approvalDeciderRole` with:

```ts
/** The role and branch a request type defaults to when nothing more specific is known. */
export interface ApprovalAuthority {
  role: Role
  /** null = any branch (an admin); a uuid = that branch only (a manager). */
  branchId: string | null
}

/**
 * Defaults. A requesting service overrides them when the subject decides the
 * authority (a transfer's source branch type; a shift's branch) — P12-D2.
 */
export const APPROVAL_DECIDER_ROLE: Record<ApprovalType, Role> = {
  PURCHASE_ORDER: 'ADMIN',
  PRODUCT_CREATE: 'ADMIN',
  TRANSFER_REQUEST: 'MANAGER',   // overridden to ADMIN when the source is a warehouse
  STOCK_WRITE_OFF: 'ADMIN',
  PRICE_CHANGE: 'ADMIN',
  CREDIT_LIMIT_CHANGE: 'ADMIN',
  SHIFT_VARIANCE_REVIEW: 'MANAGER',
  REFUND: 'ADMIN',
}

export function defaultApprovalAuthority(type: ApprovalType, branchId: string | null): ApprovalAuthority

/** The one rule both the service and the console use to render a decision button. */
export function canDecideApproval(args: {
  approval: {
    status: ApprovalStatus
    deciderRole: Role
    deciderBranchId: string | null
    requestedBy: string
  }
  user: {
    role: Role
    branchId: string | null
    label: string
    hasDecidePermission: boolean
  }
}): boolean
```

`canDecideApproval` returns `true` only when **all** hold:

1. `status === 'PENDING'`;
2. `hasDecidePermission`;
3. `user.label !== approval.requestedBy` (no self-approval, any role);
4. `user.role === 'ADMIN'`, **or** (`approval.deciderRole === 'MANAGER'` **and**
   `approval.deciderBranchId !== null` **and** `user.branchId === approval.deciderBranchId`).

A manager may never decide an `ADMIN`-authority row, even in their own branch. An admin may decide
a `MANAGER`-authority row in any branch — that is the fallback P12-D3 depends on.

Keep `isDecided`, `isApprovalType`, `isApprovalReasonCode`, `APPROVAL_TYPES`, `APPROVAL_STATUSES`,
`APPROVAL_REASON_CODES` unchanged.

### 3. Price band (`pricing.ts`)

```ts
/**
 * True when `proposed` is within `percent` of `current`, inclusive at the edge.
 * Integer-only: |proposed − current| × 100 ≤ current × percent.
 * A zero `current` admits only a zero proposal.
 */
export function withinPriceBand(currentMinor: number, proposedMinor: number, percent: number): boolean

/** Display bounds derived from the same rule: current ± floor(current × percent / 100). */
export function priceBandBounds(currentMinor: number, percent: number): { minMinor: number; maxMinor: number }
```

Both throw `TypeError` on a non-integer, negative price or a percent outside 0…100. No float
appears in either function; `percent` is a whole number (10, not 0.1).

### 4. Counting (`counting.ts`, new)

```ts
export const COUNT_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL'] as const
export type CountFrequency = (typeof COUNT_FREQUENCIES)[number]

/** `YYYY-MM-DD` → the next due day for a frequency, Accra calendar, month-end clamped. */
export function advanceDueDate(isoDay: string, frequency: CountFrequency): string

/** True when a posted count met its due date (a count without one is never late). */
export function isCountOnTime(postedAt: Date | string | null, dueAt: string | null): boolean

/** A ≤ aBp → 'A'; ≤ bBp → 'B'; else 'C'. Shares are basis points of the branch total. */
export function abcClassFromShare(shareBp: number, aThresholdBp: number, bThresholdBp: number): 'A' | 'B' | 'C'

/** matched / counted in basis points; null when nothing was counted. */
export function countAccuracyBp(matchedLines: number, countedLines: number): number | null

/**
 * How many parts a ROTATION count must include so the whole catalogue is covered
 * once per period: ceil(activeCount / periodsPerPeriod), minimum 1.
 * WEEKLY 52, MONTHLY 12, QUARTERLY 4, BIANNUAL 2.
 */
export function rotationBatchSize(activeCount: number, frequency: CountFrequency): number
```

`advanceDueDate` parses the day into `{ y, m, d }`, adds 7 / 1 / 3 / 6 months, clamps the day to
the target month's length, and formats back — no `new Date('YYYY-MM-DD')`, no `+86_400_000`.
Examples that must be in the test: `2026-01-31` + MONTHLY = `2026-02-28`; `2028-01-31` + MONTHLY =
`2028-02-29`; `2026-11-15` + QUARTERLY = `2027-02-15`; `2026-12-31` + BIANNUAL = `2027-06-30`;
`2026-12-28` + WEEKLY = `2027-01-04`.

### 5. Exports and tests

- `index.ts` gains `export * from './counting.ts'`.
- New tests: `packages/shared/src/counting.test.ts` (~18 cases).
- Extended tests: `approvals.test.ts` (authority matrix), `pricing.test.ts` (band edges),
  `permissions.test.ts` (the rename).

The authority matrix must include: admin decides an admin row in another branch → true; admin
decides their own request → false; manager decides a manager row in their branch → true; manager
decides a manager row in another branch → false; manager decides an admin row in their branch →
false; manager without `approval.decide` → false; decided row → false.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run check-types
bun run lint
```

Expected: shared grows from **191** to ~**225**; no existing assertion is edited except the two
that named `procurement.approve` and `APPROVAL_DECIDER_ROLE`, and both edits are named in the
commit body. `grep -rn "procurement.approve" packages/` returns nothing after this plan. The API
still names the old string in one place until Plan 02's one-line bridge, which is why the two plans
are executed back to back.

## Commits

1. `feat(shared): approval.read and approval.decide replace procurement.approve`
2. `feat(shared): per-row approval authority with a no-self-approval rule`
3. `feat(shared): integer price band arithmetic`
4. `feat(shared): count schedules, ABC classes and accuracy arithmetic`

## Done when

- One function answers "may this person decide this row", and the API and console both call it.
- The band is exact at the edge and contains no float.
- `advanceDueDate` clamps month ends and is proven on five hand-written dates.
- Accuracy returns `null`, never `0`, when nothing was counted.
