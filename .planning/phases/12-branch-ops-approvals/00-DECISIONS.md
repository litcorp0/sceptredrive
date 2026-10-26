# Phase 12 — Decisions

`00-CONTEXT.md` is the locked context. This file refines it, and **wins where the two
disagree**. Every decision names where it is exercised, so a later reader can check the code
rather than the prose.

Five decisions were put to the operator on 2026-10-26 and answered; they are marked
**[operator]**. The rest were taken while planning because they are mechanical, fail-closed, or
forced by a fact in the repository.

---

## A. The approval entity (APR-01…06)

### P12-D1 — `approval.read` / `approval.decide` replace `procurement.*` on approval routes **[operator]**

`PERMISSIONS` gains `approval.read` and `approval.decide`; `procurement.approve` is **removed**
from the vocabulary (one name for one action). Both new permissions are granted to ADMIN and
MANAGER. `procurement.read` / `procurement.create` / `procurement.receive` / `procurement.return`
keep their current meaning for procurement's own screens.

Exercised in: Plan 01 (`packages/shared/src/permissions.ts`), Plan 03 (`approvals.routes.ts`),
Plan 13 (walkthrough matrix).

**Why remove rather than alias:** two permission strings for one action is how a route ends up
checking the one nobody grants. Phase 11's tests that assert `procurement.approve` are updated
deliberately, and the diff names them.

### P12-D2 — Authority is stored on the row, not derived from the type alone

`approval_decider_role` in `packages/shared/src/approvals.ts:63-72` maps **every** type to
`ADMIN`, so context D4's "the source branch manager approves branch-to-branch" is unimplementable
as written. The entity gains:

| Column | Type | Meaning |
|---|---|---|
| `decider_role` | `role` enum, not null, default `'ADMIN'` | The lowest role that may decide this row |
| `decider_branch_id` | uuid, nullable, FK `branch` restrict | The branch the decider must belong to; null means any (admin) |

`requestApproval` takes both, defaulting from a shared `APPROVAL_DECIDER_AUTHORITY` table, and a
requesting service **overrides** them when the subject decides the authority (a transfer's source
branch type; a shift's branch).

`canDecideApproval(approval, user)` is a pure shared function:

```
ADMIN                                    → eligible (any branch, any type)
MANAGER + deciderRole = 'MANAGER'
        + deciderBranchId = user.branchId → eligible
anything else                             → not eligible
```

`decideApproval` uses it instead of `roleOf(user) === approvalDeciderRole(type)`. The
`approval.decide` permission is still required at the route and re-checked in the service
(OWASP A01: deny by default, twice).

Exercised in: Plan 01 (pure function + tests), Plan 02 (columns + defaults), Plan 03 (service),
Plans 04–08 (each request sets its own authority).

### P12-D3 — An admin never raises a request for work an admin can do directly

Every type's request endpoint refuses an ADMIN with a **400** naming the direct screen, the same
shape Phase 11 used for product submission (`products.service.ts:574-580`). The direct paths are:

| Type | Admin's direct path |
|---|---|
| `PURCHASE_ORDER` | submit auto-approves (existing) |
| `TRANSFER_REQUEST` | create a `DRAFT` transfer |
| `STOCK_WRITE_OFF` | a negative `ADJUSTMENT` with a reason code |
| `PRICE_CHANGE` | `PUT /api/products/:id/prices` |
| `CREDIT_LIMIT_CHANGE` | `PUT /api/credit/profiles/:customerId` |
| `SHIFT_VARIANCE_REVIEW` | raised by the close, decided by the admin |

This is what closes "an admin has nobody to approve them" without weakening D3's self-approval
ban for anyone else.

### P12-D4 — Subjects are a registry, mirroring decision handlers

`ApprovalSubject` is currently `purchase_order | product | other`
(`approvals.types.ts:28-31`), which would make the inbox a list of ids. Add:

```ts
type SubjectLoader = (approval: ApprovalRow) => Promise<ApprovalSubject>
export function registerSubjectLoader(type: ApprovalType, loader: SubjectLoader): void
export function assertSubjectLoadersRegistered(required: readonly ApprovalType[]): void
```

Each owning service registers its own loader at module load, so the import direction stays
`owner → approvals` and the generic module never imports a domain. `getApproval` and the inbox
list call the loader; a missing loader is a **500 at boot**, not at first view.

The loader is read-only and takes no transaction: a detail read must not open one.

Exercised in: Plan 03 (registry), Plans 04–08 (one loader each).

### P12-D5 — The inbox is a queue, not a log

`GET /api/approvals` gains `entityId` (uuid, optional) and `sort` (`oldest` | `newest`, default
`oldest`). The current `requestedAt DESC` default is a log; context D11 asks for a queue ordered
oldest first with age. The only existing consumer
(`admin/src/modules/procurement/components/pending-product-submissions.tsx:57`) lists pending
product proposals where order carries no meaning.

New `GET /api/approvals/summary` → `{ pending: number, byType: Record<ApprovalType, number>,
branchId: string | null }`, branch-scoped by `resolveBranchFilter`. It exists so the nav badge
and the manager's view do not each fetch 200 rows to count them.

Age is **derived** from `requestedAt` on the client; storing it would be a second clock.

### P12-D6 — `amountMinor` means one thing per type, and the meaning is documented

| Type | `amountMinor` | `entityId` | Payload |
|---|---|---|---|
| `PURCHASE_ORDER` | ex-tax goods value | order id | order note |
| `PRODUCT_CREATE` | proposed base price | null until approved | the submission |
| `TRANSFER_REQUEST` | Σ qty × source avg cost | transfer id | `{ fromBranchId, toBranchId, fromBranchType, lineCount }` |
| `STOCK_WRITE_OFF` | Σ qty × branch avg cost | write-off id | `{ number, lineCount, reasons[] }` |
| `PRICE_CHANGE` | proposed price | product id | `{ productId, branchId, currentPriceMinor, proposedPriceMinor, bandPercent, kind }` |
| `CREDIT_LIMIT_CHANGE` | proposed limit | credit profile id | `{ customerId, branchId, currentLimitMinor, proposedLimitMinor, balanceMinor }` |
| `SHIFT_VARIANCE_REVIEW` | absolute variance | shift id | `{ shiftId, terminalName, expectedMinor, countedMinor, varianceMinor }` |
| `REFUND` | refund amount | sale id | Phase 13 |

`amountMinor` is nullable and is a **value for sorting and display**, never an authorisation
input. The threshold check for purchase orders keeps using `goodsValueMinor` (P11-D2).

### P12-D7 — Decided is decided; withdrawal unwinds the subject

No re-decision, no edit, no delete. `PENDING → APPROVED | REJECTED` by decision;
`PENDING → WITHDRAWN` by the requester only. A withdrawal must **unwind the subject in the same
transaction** — a withdrawn transfer request becomes `CANCELLED`, a withdrawn write-off becomes
`CANCELLED` — or the queue and the documents disagree. A decided request is never withdrawn.

No expiry (carried from Phase 11). The queue shows age so a stale request is visible, which is
the honest version of expiry.

### P12-D8 — One decision handler per type, asserted at boot

`app.ts:41` grows to assert every type Phase 12 can create:

```
['PRODUCT_CREATE', 'PURCHASE_ORDER', 'TRANSFER_REQUEST', 'STOCK_WRITE_OFF',
 'PRICE_CHANGE', 'CREDIT_LIMIT_CHANGE', 'SHIFT_VARIANCE_REVIEW']
```

`REFUND` stays out until Phase 13 registers it. A type that can be requested but not decided is a
boot failure, and `registeredDecisionTypes()` is asserted in a test.

---

## B. Transfer requests (BRN-01)

### P12-D9 — `transfer_status` gains three values, in their own migration

`REQUESTED`, `APPROVED`, `REJECTED`. PostgreSQL 17: "If `ALTER TYPE ... ADD VALUE` is executed
inside a transaction block, the new value cannot be used until after the transaction has been
committed" ([ALTER TYPE](https://www.postgresql.org/docs/17/sql-altertype.html)). `drizzle-kit
migrate` wraps each file in a transaction (verified in Phase 11, P11-D16), so the enum additions
are one file and every use is the next file.

`DRAFT`, `DISPATCHED`, `RECEIVED`, `SHORT_CLOSED`, `CANCELLED` are unchanged.

### P12-D10 — The destination raises the request; only an admin drafts directly

- **Manager** (`inventory.transfer`) → `POST /api/transfers` creates a **`REQUESTED`** transfer
  whose `toBranchId` must be the manager's own branch, plus its `TRANSFER_REQUEST` approval, in
  one transaction.
- **Admin** → creates a **`DRAFT`** as today (D4: "DRAFT stays for admin-initiated direct
  transfers"). A manager may not create a `DRAFT`; an admin may not create a `REQUESTED` (D3).

The current hole — a manager creating an outgoing transfer and dispatching it themselves — is
closed by the status, not by hiding a button.

### P12-D11 — Authority follows the **source** branch type

| Source branch | `deciderRole` | `deciderBranchId` |
|---|---|---|
| `RETAIL` | `MANAGER` | the source branch |
| `WAREHOUSE` | `ADMIN` | null |

An admin is eligible for both (D2). The requester can never decide (D7's self-approval ban), and
because the requester is at the destination, the ordinary branch→branch case has a different
person by construction — but the check is still enforced, because "by construction" is a comment.

### P12-D12 — Dispatch requires `APPROVED`; every other transition is unchanged

| Transition | From | Guard |
|---|---|---|
| request | — | destination = requester's branch; active branches; active products; qty > 0 |
| approve / reject | `REQUESTED` | via the generic decision endpoint |
| dispatch | `APPROVED` or `DRAFT` | source branch only; no negative stock (unchanged) |
| receive / short-close | `DISPATCHED` | destination branch only (unchanged) |
| cancel / withdraw | `DRAFT` or `REQUESTED` | access check; a `REQUESTED` cancel also withdraws the approval |
| edit lines | `DRAFT` only | unchanged |

`REJECTED` is terminal and posts no movement. `updateTransfer` / `replaceTransferLines` refuse a
`REQUESTED` transfer — the admin decides what was asked, not what it became.

---

## C. Stock write-offs (BRN-02, MGR-04)

### P12-D13 — Shrinkage cannot bypass the workflow **[operator]**

A **non-admin** negative adjustment whose reason is `DAMAGE`, `LOSS`, `EXPIRED` or `OTHER` is
refused by `POST /api/inventory/adjustments` with a 400 that names the write-off form.
`FOUND` and `CORRECTION` stay direct, and positive adjustments are unaffected. An admin keeps the
direct path (D3).

A negative `CORRECTION` is the one remaining hole, and it is deliberate: it is a data fix rather
than a loss, it requires the manager to call it a correction, and the audit row records it. Closing
it too would mean no way to fix a mistyped count without a second person, which is how a queue
becomes a rubber stamp.

Without this, `createAdjustment` (`inventory.service.ts:438`) is an unapproved write-off and the
new workflow is advisory.

### P12-D14 — A write-off is a document with lines, not an adjustment

`stock_write_off` + `stock_write_off_line`, statuses `PENDING_APPROVAL → APPROVED | REJECTED`, plus
`CANCELLED` for a withdrawn request. **`APPROVED` means posted**: the decision handler posts the
movements in the same transaction and writes `posted_at`. There is no separate `POSTED` state to
drift out of sync, and no `DRAFT`: a write-off is raised complete, because a half-written
shrinkage report is a number nobody can approve.

Numbered through `document_sequence` with kind `stock_write_off` and prefix setting
`inventory.writeOffPrefix` (default `WO`), so `WO-<branch>-<YYYYMM>-<0001>` matches the purchase
order shape.

### P12-D15 — A new `WRITE_OFF` movement type, in its own enum migration

`stock_movement_type` and `stock_movement_reference` each gain `WRITE_OFF`. Shrinkage is then a
ledger filter rather than a note, and the reconciliation queries keep working. This is additive:
`stock_movement` is **not** synced to the POS (`powersync/sync-config.yaml` streams only products,
barcodes, prices, stock levels, customers, credit and loyalty), so no client changes.

The movement is posted through the one writer, `inventory.service.postMovements`, with
`referenceType: 'WRITE_OFF'`, `referenceId` = write-off id, `reasonCode` copied from the line.

### P12-D16 — Reasons are per line, and two of them need words

`stock_write_off_reason`: `DAMAGE`, `EXPIRY`, `OBSOLESCENCE`, `THEFT`, `SUPPLIER_FAULT`, `OTHER`.
`THEFT` and `OTHER` require a line note (400 otherwise). Per line, because a pallet can be half
water-damaged and half stolen; the header carries an optional note.

### P12-D17 — Value is frozen at request time and the ledger matches it exactly

Each line stores `unit_cost_minor` = the branch's `stock_level.avg_cost_minor` when the request is
raised; the header stores `value_minor` = Σ qty × that cost. The posted movement carries the
**stored** line cost, so the ledger value equals the approved value to the pesewa even if a
receipt changes the average between request and decision.

Approval is refused with a 409 if a line would drive stock negative (the same rule
`postCount` applies at `counts.service.ts:209-221`). The request is cancelled and re-raised; a
partial approval is not a thing.

---

## D. Price band (BRN-03, MGR-05)

### P12-D18 — The band is integer-only and inclusive at the edge

`pricing.managerBandPercent`, integer 0…100, default **10**, global, admin-only. Shared pure
function:

```ts
withinPriceBand(currentMinor, proposedMinor, percent): boolean
// |proposed - current| * 100 <= current * percent
```

No floats touch money. Exactly 10% is inside; one pesewa beyond is outside. `currentMinor` is the
**effective branch price** (`override ?? base`, via `resolveEffectivePrice`), which is what D7
says and what the manager sees.

A zero current price: any positive proposal is outside the band (a free-to-paid change is not a
10% change), and the request path is used.

### P12-D19 — One endpoint, two outcomes

`PUT /api/products/:id/prices` and `DELETE /api/products/:id/prices/:branchId` keep their paths
and permission (`price.override`) and return a discriminated result:

```ts
{ status: 'APPLIED',  priceMinor }            // inside the band, or actor is ADMIN
{ status: 'PENDING_APPROVAL', approvalId }    // outside the band, manager
```

Removing an override is a change **to** the base price and is band-checked identically — otherwise
a manager can escape the band by deleting the override.

Inside the band the change applies immediately and the existing audit actions
(`product.price.override_set` / `_removed`) are unchanged, with `after.via: 'BAND'`. A request
audits `product.price.change_requested`.

### P12-D20 — A stale request is refused, not applied

On approval the handler re-reads the current effective price. If it no longer equals the
`currentPriceMinor` stored on the request, the decision fails with a **409** and rolls back; the
admin rejects with a reason and the manager raises a new request. Applying a stale `before` is how
a price nobody approved goes live.

This is the "applies exactly once" rule in context D7, made checkable.

---

## E. Credit limits (CC-01…05 are counts; credit is BRN scope)

### P12-D21 — Managers lower directly, request any increase **[operator]**

| Change | Manager | Admin |
|---|---|---|
| `limitMinor` decrease | direct, audited | direct |
| `limitMinor` increase | `CREDIT_LIMIT_CHANGE` request | direct |
| `hold`, `paymentTermDays`, `notes` | direct | direct |

A decrease reduces exposure; requiring approval for it would queue the only action that makes the
branch safer. The direct path refuses a manager's increase with a **403** that names the request
endpoint, so the rule has exactly one implementation.

Approval is allowed even when the new limit leaves the customer over their balance — the subject
shows the resulting position, and an over-limit profile already blocks further credit
(`credit.service.ts:275-285`). Refusing it would leave a bad limit in place.

### P12-D22 — The request is a payload, and the same stale check applies

`entityId` = the **credit profile id** (one row per customer per branch), `amountMinor` = proposed
limit, payload `{ customerId, branchId, currentLimitMinor, proposedLimitMinor, balanceMinor }`,
reason required at request (it is money). The profile id rather than the customer id is what makes
the partial unique index mean "one pending limit change per customer per branch" — a customer's
limits at two branches are two different decisions. On approval, re-read the limit; if it changed since the request → 409
and roll back, exactly as P12-D20. The handler writes `limitMinor` and audits
`credit.profile_updated` with `{ via: 'approval', approvalId }`, so the ledger of who changed a
limit stays one action.

### P12-D23 — The over-limit list is a credit read, not an analytics count

Analytics exposes only `overLimitCreditCount` (`analytics.repository.ts:410-418`). The manager's
view needs the rows. `credit.service.listOverLimit(user, query)` returns
`{ customerId, customerName, phone, branchId, limitMinor, balanceMinor, overByMinor }`, branch-
scoped and paginated. Analytics keeps its count (a dashboard tile); the two definitions are the
same predicate, and a test asserts they agree.

---

## F. Shift variance review (BRN-04)

### P12-D24 — Review state is its own column; `shift_status` is untouched **[operator]**

`shift` gains `review_status` (`NONE` | `REQUIRED` | `REVIEWED`, default `NONE`),
`reviewed_by`, `reviewed_at`, `review_note`. Context D9's "the shift becomes REVIEW_REQUIRED" is
**not** implemented as a status value: `pos.reconciliation.ts:291-299` filters `status =
'CLOSED'`, so a review status would silently drop those shifts out of reconciliation, and
`shift_one_open_per_terminal` is a partial index on `OPEN`.

A close with `|variance| > tolerance` sets `review_status = 'REQUIRED'` and creates a
`SHIFT_VARIANCE_REVIEW` approval in the **same transaction** as the close. Exactly at tolerance is
not "beyond tolerance" (BRN-04's wording); one pesewa beyond is.

### P12-D25 — Tolerance is a setting, and the figures are frozen

`pos.shiftVarianceToleranceMinor`, integer ≥ 0, default **2_000** (GHS 20), branch-scoped,
`writableBy: 'admin'` — a branch that sets its own tolerance has none.

The decision writes only `review_status`, `reviewed_by`, `reviewed_at`, `review_note` and an audit
row. `counted_cash_minor`, `server_expected_cash_minor` and `variance_minor` are never updated
after close; the reconciliation check keeps proving it.

A decision on this type is **`APPROVED` only**, and the note is the outcome ("drawer recounted with
the cashier; GH₵15 was in the wrong slot"). `REJECTED` is refused with a 400: a variance is not a
proposal that can be declined, and "rejected" would read as "the money is fine now", which is a
statement the reviewer cannot make. The console renders one button, *Record outcome*, for this
type.

### P12-D26 — Authority is the shift's branch; a closing manager needs the admin

`deciderRole: 'MANAGER'`, `deciderBranchId` = the shift's branch. Self-approval is blocked, so a
manager who closed the shift themselves is decided by an admin. That is the correct outcome: the
person who counted the drawer does not sign off their own count.

### P12-D27 — The POS is untouched and the close is still atomic

No `desktop/**`, no `powersync/sync-config.yaml`, no local schema, no outbox change — the `shift`
table is not synced. The approval row is created inside the existing upload transaction, so a
failure rolls the close back and the outbox retries; the close is idempotent by shift id, so the
retry is safe. A pending review never blocks a sale (APR-06).

---

## G. Cycle counts (CC-01…05)

### P12-D28 — A schedule is a scope plus a frequency, identified by a scope key

`count_schedule`: `branch_id`, `scope` (`CATEGORY` | `BRAND` | `ABC_CLASS` | `ROTATION`),
`scope_key` (text: `category:<uuid>`, `brand:<uuid>`, `ABC:A`, `ROTATION`), `frequency`
(`WEEKLY` | `MONTHLY` | `QUARTERLY` | `BIANNUAL`), `next_due_at` (date), `assigned_to` (staff id,
nullable), `is_active`, plus the usual audit columns. Unique `(branch_id, scope_key)`.

One text key instead of four nullable FK columns: the unique index is trivial, the resolver is one
`switch`, and a schedule cannot be half-configured (a `CATEGORY` scope with a brand id).

### P12-D29 — ABC classes are per branch, derived nightly, and manually overridable **[operator]**

`stock_abc_class` per `(product_id, branch_id)`: `class` (`A` | `B` | `C`), `value_minor`
(on-hand × avg cost), `sold_minor` (90-day ex-tax base), `score`, `computed_at`, `is_manual`,
`updated_by`. Unique `(product_id, branch_id)`.

Ranking: order by `score` desc, accumulate share of total score, ≤
`inventory.abcAThresholdBp` (default 8_000 = 80%) → `A`, ≤ `inventory.abcBThresholdBp`
(default 9_500) → `B`, else `C`. Both settings are global and admin-writable. `score` is
`value_minor + sold_minor` — stock at risk plus what moves — and the subject screen prints both
inputs so a class is explainable.

The nightly job skips `is_manual = true` rows. An admin edit sets `is_manual = true`; the admin
can clear it to return the product to the derived class.

### P12-D30 — Counts carry their type, scope and due date

`stock_count` gains `count_type` (`MANUAL` | `SCHEDULED` | `TRIGGER`, default `MANUAL`),
`scope`, `scope_key`, `due_at`, `assigned_to`, `schedule_id` (FK, `set null`), `trigger_reason`
(`VARIANCE` | `OVERSELL`, nullable), `trigger_product_id` (FK, nullable), `trigger_source_id`
(uuid, nullable). `category_id` stays and is set when `scope = 'CATEGORY'`.

De-duplication is an index, not a query: partial unique
`(branch_id, trigger_product_id) WHERE status = 'OPEN' AND trigger_product_id IS NOT NULL`, and
partial unique `(schedule_id) WHERE status = 'OPEN' AND schedule_id IS NOT NULL`.

### P12-D31 — The snapshot resolver includes never-stocked parts

`selectSnapshotRows` currently joins `stock_level` only, so a part with no level row cannot be
counted. The Phase 10 carry-forward is closed here: the resolver returns every active product in
scope, `LEFT JOIN stock_level`, with `snapshot_qty = 0` when there is no row. A count that cannot
see a phantom product cannot find it.

### P12-D32 — Triggers are evaluated by a job, never inside a sale

Context D17 says a posted count or "two oversell conflicts in 30 days" raises a count. The count
side runs inside `postCount` (already a transaction, no sale involved). The **oversell side runs
in a nightly `inventory-trigger-scan` job**, not inside `applySale`: `applySale` is the sync
upload path, and a failure there would reject a sale that has already happened at the till
(`AGENTS.md`: never block a sale). The job reads `sync_conflict` where
`type = 'STOCK_OVERSELL' AND created_at > now() - interval '30 days'`, groups by
`details->>'productId'`, and raises one open trigger count at the second conflict.

Variance value is `|variance units| × stock_level.avg_cost_minor`, compared with
`inventory.countVarianceToleranceMinor` (default **1_000**, branch-scoped, admin-writable).
Strictly greater, matching "exceeds".

### P12-D33 — Accuracy is measured from the ledger, not from a new column

`inventory accuracy = matched counted lines / counted lines` over `POSTED` counts in a period,
where matched means `counted_qty = snapshot_qty`. On-time = `posted_at <= due_at` for counts that
have a due date. Variance value is read from the `COUNT_VARIANCE` movements the count posted
(`reference_type = 'COUNT'`, `reference_id = count.id`), so it reconciles to the ledger by
construction rather than by a parallel arithmetic that can drift.

`GET /api/counts/accuracy?branchId&from&to` returns `{ accuracyBp: number | null, countedLines,
matchedLines, countsPosted, countsOnTime, varianceValueMinor }`; `null` (not `0`) when no line was
counted. The manager's view shows it; the analytics inventory tab gains the same figure.

### P12-D34 — Two pg-boss schedules, both idempotent, both Africa/Accra

| Queue | Cron | Work |
|---|---|---|
| `inventory-count-schedule` | `0 2 * * *` | For each active schedule with `next_due_at <= today`: create the count, advance `next_due_at`, one transaction |
| `inventory-abc-recompute` | `0 3 * * *` | Recompute every branch's ABC classes, skipping manual rows |

Both use `missed: 'once'`, matching the loyalty expiry job (`api/src/jobs/queues.ts:22-25`).
`advanceDueDate` is a pure shared function with month-end clamping (31 Jan + 1 month = 28/29 Feb)
and a test, because a date arithmetic bug here silently stops counting a category forever.

---

## H. Console and verification

### P12-D35 — Two new admin modules, listed in the gate before they exist

`admin/src/modules/approvals/` (inbox, subject rendering, decision dialog) and
`admin/src/modules/operations/` (the manager's branch view). `scripts/check-modules.mjs:39-51`
lists both in the same commit that creates the directory — a required-but-absent directory is a
hard failure, so the list never runs ahead of the tree.

The approval fetchers currently live in `procurement/api/approvals.ts`; they move to the
`approvals` module (one owner) and procurement imports the barrel. The procurement screens keep
working through the same endpoints.

### P12-D36 — One badge, one query, no polling

`SidebarMenuBadge` (already generated, zero callers) is fed by
`GET /api/approvals/summary` behind `approval.read`, with a 60-second `staleTime` and no
`refetchInterval`. A count that polls every five seconds is a database read per user per five
seconds for a number that changes when a manager submits a form.

### P12-D37 — The manager's view is one endpoint, branch-scoped twice

`GET /api/operations/summary` in a new `operations` api module returns the six queues context D10
names — pending approvals (by type), transfer requests, write-offs awaiting decision, shift
variances awaiting review, low stock, over-limit credit — each as a count plus the first page.
Branch scoping is enforced by the route permission and again by `resolveBranchFilter` in the
service (P11-D17's shape). Low stock is `inventory.service.listLowStock`; over-limit credit is
P12-D23; the rest are counts over tables this phase already owns.

### P12-D38 — Verification proves the effects, not the endpoints

Every decision type gets a **request → approve → effect** leg and a **request → reject → no
effect** leg, with the effect read back from the ledger, the price row, the credit profile, the
transfer status or the shift's review columns. Reconciliation legs: Σ `stock_movement` = on-hand
after write-offs and transfer requests; the supplier/credit/price numbers unchanged; the POS
suite count unchanged and `git diff --stat` over `desktop/` and `powersync/` empty.

The OWASP table maps each A01/A04/A05/A09 concern to a leg: self-approval, IDOR on every new
`/:id` route, smuggled `branchId`, and audit rows naming the actor.

Eight mutations must fail the gates (Plan 13 lists them), including the band boundary, the
self-approval check and the tolerance edge.

---

## Amendments to the locked context

| Context | Says | This phase does | Why |
|---|---|---|---|
| D2 | `SHIFT_VARIANCE` | `SHIFT_VARIANCE_REVIEW` | The enum value and the shared array already say `SHIFT_VARIANCE_REVIEW`; renaming a deployed enum value to match a document is the wrong direction |
| D4 | source branch manager approves branch→branch | same rule, implemented by `decider_role` + `decider_branch_id` on the row | `APPROVAL_DECIDER_ROLE` maps every type to ADMIN and `procurement.approve` is admin-only |
| D8 | "increases beyond the requester's own authority" | managers lower directly, request any increase | "own authority" was undefined; a decrease only reduces exposure |
| D9 | shift becomes `REVIEW_REQUIRED` | `review_status` column; `shift_status` untouched | the reconciliation query filters `status = 'CLOSED'` |
| D15 | scope `scopeId` | `scope` + `scope_key` text | one unique index, no half-configured schedule |
| D17 | "raises a trigger count" | the oversell half runs nightly | a failure inside `applySale` would reject a sale that already happened |
| D18 | accuracy "per branch and period" | plus the read comes from the posted movements | reconciles to the ledger by construction |

## Open, deliberately not decided here

- **Approval expiry / escalation** — out of scope (P11 carry-forward). Age is displayed.
- **A full shift list in the console** — Phase 14's "POS oversight screens". Phase 12 reviews a
  variance through the inbox subject, which carries every figure the reviewer needs.
- **Refund approvals** — Phase 13 registers the `REFUND` handler and subject loader; the type
  exists and is not decidable until then.
- **Email or SMS notification** — D11 stands: in-app only.
