# Phase 12 — Verification

**Phase:** Branch Operations & Approval Workflow
**Verified:** 2026-10-26
**Plans:** 13/13 complete
**Gates:** `evidence/suites.txt` — **ALL SUITES PASSED**

| Gate | Result |
|---|---|
| `bun run lint` | exit 0, 19 pre-existing warnings |
| `bun run check-types` | 6/6 workspaces, exit 0 |
| `@sceptre/shared` | 16 files, **239** tests |
| `api` | 45 files, **596** tests |
| `desktop` | 51 files, **427** tests — unchanged by this phase |
| `modules:check` | 19/19 admin |
| `modules:check:strict` | 19/19 admin, 14/14 POS |
| `brand:check` | OK over **1 035** tracked files |
| `tokens:check` | OK |
| API walkthrough | **93 assertions**, 0 failures, 32/32 legs with a driven check |
| Console walkthrough | **239/239** checks, exit 0 — was 159 before this phase |
| Mutation proofs | **8/8 caught** |

---

## 1. Roadmap success criteria

Each of the nine criteria from `ROADMAP.md` is proved by a numbered leg of
`evidence/walkthrough-branch-ops.mjs` (transcript in `walkthrough-branch-ops.txt`), by a
committed test, or by a screenshot. Leg numbers refer to that script.

| # | Criterion | Proof |
|---|---|---|
| 1 | A manager requests a transfer; the source branch manager approves branch-to-branch and the admin approves warehouse-to-branch; a rejected request moves no stock | Legs 2–7: `REQUESTED` with `deciderRole = MANAGER`, dispatch refused before approval (409, source level unchanged), approve → dispatch → receive with Σ movements = on-hand, reject leaves **zero** movements for that transfer, withdraw ends `WITHDRAWN`. Leg 7 proves a manager gets 403 on a warehouse-sourced request while the admin decides it. |
| 2 | One inbox lists every pending item with type, value, branch, requester, age; detail; approve/reject with reason; both decisions audited with before/after | Legs 29 and 31; console `/approvals`; `approvals.test.ts`, `approvals.api.test.ts`. Leg 31 asserts an `approval.decided` row per decision naming actor, reason and before/after. |
| 3 | Nobody approves their own request; a manager who raises from their own branch has it decided by the admin | Leg 30 (the A01 matrix runs per type) and mutation 2. `SELF_APPROVAL` is blocked in `canDecideApproval`, which is the one place both the decide endpoint and the detail's `canDecide` read. |
| 4 | A write-off needs a reason code and an approval; on approval a negative movement posts, on rejection nothing changes | Legs 8–11; mutations 5 and 7. Leg 8 re-derives the value from SQL (`stock_write_off.value_minor` = Σ lines = Σ `WRITE_OFF` movement values = `approval.amount_minor` = 150 000). Leg 9 asserts zero movements and an unchanged level after a rejection. |
| 5 | A manager may move a price ±10% of the effective branch price; beyond it a request showing old and new applies exactly once | Legs 12–16; mutations 1 and 6. Leg 12 is exactly 10% → `APPLIED`; leg 13 is one pesewa past the computed bound → `PENDING_APPROVAL` with the row unchanged; leg 14 approves once and the second decision is a 409; leg 15 proves a stale request is refused with the row unchanged and the approval still `PENDING`; leg 16 proves removing an out-of-band override is a request, not a delete. |
| 6 | A manager may propose a credit limit change; the limit changes only after approval | Legs 17–19; `credit.test.ts`. Leg 19 asserts the limit changes only after approval, the ledger row count is unchanged and the balance is unchanged. |
| 7 | A shift closed beyond tolerance is marked for review; a manager or admin records an outcome; the figures stay immutable | Legs 21–23; mutation 8. Leg 21 is exactly at tolerance → `NONE` and zero approvals; leg 22 is one pesewa over → `REQUIRED` with one approval; leg 23 proves the closing cashier cannot decide it, another manager can, and the three money columns are byte-identical before and after. |
| 8 | The manager's console shows the branch queues at a glance | Leg 29 (summary counts equal the lists' totals) and the console `/operations` page: six cards plus the accuracy figure, each linking to its filtered list. |
| 9 | Counts can be scheduled by category, brand or value class; tasks get a due date and an assignee; a trigger count is raised on variance or repeated oversell; accuracy is reported per branch | Legs 24–28. Leg 24 runs the schedule worker twice and gets **one** count with `next_due_at` advanced once, including a never-stocked product at snapshot 0. Legs 25–26 prove one trigger per drift and none from a re-scan. Leg 27 is ABC by hand-computed shares. Leg 28 re-derives accuracy from SQL (2/4 → **5000 bp**) and proves `null`, never 0, with no counts. |

---

## 2. Requirements

| Requirement | Proof |
|---|---|
| **APR-01** one approval entity, one inbox across all types | `approval` table with `type`, `decider_role`, `decider_branch_id`; `GET /api/approvals`; seven types registered at boot (`assertDecisionHandlersRegistered`). Refunds are the eighth and stay out until Phase 13 registers a handler — the registry asserts the exact set, so a type that can be created but not decided fails boot. |
| **APR-02** request/detail/decide record requester, decider, reason, before/after | `approvals.api.test.ts`; leg 31. Schema carries `requested_by`, `decided_by`, `decision_reason_code`, `payload`, and every handler audits before/after. |
| **APR-03** authority from type and branch, self-approval blocked | `canDecideApproval` in `packages/shared/src/approvals.ts` (one rule, pure, unit-tested), leg 30, mutations 2 and 3. |
| **APR-04** decisions immutable and audited; a rejection has no side effects | Legs 5, 9, 15, 23; mutation 5. A rejection writes the status and nothing else; every handler runs inside `decideApproval`'s transaction so a refusal rolls the decision back. |
| **APR-05** badge and queue with type, value, branch, requester, age | `GET /api/approvals/summary` behind `approval.read`; sidebar badge with `staleTime: 60s` and no polling; console `/approvals` table. |
| **APR-06** a decision is never required to complete a sale | No `desktop/**`, `powersync/**` or local-schema change in the phase; `ShiftApplyResult` unchanged (asserted with `toEqual` against the Phase 11 object plus a `JSON.stringify` check for `approval|review`); desktop suite still 427. |
| **BRN-01** transfer lifecycle with authority from the source branch type | Legs 2–7. Warehouse-sourced → `deciderRole = ADMIN`; retail-sourced → `MANAGER` at the source. |
| **BRN-02** write-off with reason code, approval, append-only negative movement | Legs 8–11, 31; `WRITE_OFF` added to both movement enums in its own migration. |
| **BRN-03** manager price band; outside becomes a request | `withinPriceBand`/`priceBandBounds` are integer-only shared functions with an inclusive edge; legs 12–16 and mutations 1, 6. |
| **BRN-04** shift variance review above tolerance, immutable figures | Legs 21–23, mutation 8. `updateShiftReview`'s patch type cannot represent a money column, and a runtime guard refuses one reached by a cast. |
| **BRN-05** manager operations view of the six queues | `GET /api/operations/summary`; leg 29 asserts every count equals the underlying list's `total`; console `/operations`. |
| **CC-01** schedules by category, brand or value class with frequency and next due | `count_schedule` with a server-derived `scope_key` (`category:<uuid>`/`brand:<uuid>`/`ABC:A`/`ROTATION`), unique per branch; leg 24. |
| **CC-02** scheduled counts become tasks with due date and assignee, reusing the snapshot and posting path | `createScheduledCount`; `selectProductsWithLevels` replaces `selectSnapshotRows`; posting still goes through `postMovements`. Leg 24. |
| **CC-03** trigger counts from variance or repeated oversell | Legs 25–26. Variance trigger runs inside `postCount`; oversell runs in a nightly job, never in `applySale`, so a failure cannot reject a sale the till already completed. |
| **CC-04** accuracy per branch, on-time counts, variance value | Leg 28; `countAccuracyBp` returns `null` with no counted lines; variance value is read from the `COUNT_VARIANCE` movements, not a second arithmetic. |
| **CC-05** ABC from value and movement, admin-editable | Leg 27; `score = on-hand × avg cost + 90-day ex-tax sold`; the job skips `is_manual` and counts them `skipped`; manual edits require an admin, because managers hold `inventory.threshold` too. |

---

## 3. OWASP Top 10:2025

| Risk | How this phase answers it |
|---|---|
| **A01 Broken access control** | Every new route carries a permission (`approval.read`/`approval.decide`, `inventory.count`, `credit.profile.manage`, `price.override`, `inventory.threshold`), and the service re-checks: `resolveBranchFilter` for scope, `assertBranchAccess` for a named branch. Leg 30 runs the matrix per approval type: the requester cannot decide their own request, every new `/:id` route 403s a foreign branch, and a smuggled `branchId` in a body is refused or ignored — never honoured. `canDecide`/`canWithdraw` are **server-computed**; the console renders controls only when the server says so. |
| **A02 Security misconfiguration** | No new env var, no new secret, no permissive CORS or CSP change. The three new pg-boss schedules run with `tz` and `missed: 'once'`; `createQueue` before `work`. |
| **A04 Cryptographic failures** | No new crypto, no new hash, no new token. Money is integer minor units throughout; the band is integer-only arithmetic (`|proposed − current| × 100 ≤ current × percent`) so no float touches a price. |
| **A05 Injection** | Every body and query is Zod with `.strict()` (a smuggled field is a 400); all SQL goes through Drizzle, and the two hand-written expressions (`details->>'productId'` grouping and the accuracy aggregate) are parameterised fragments. |
| **A09 Logging and monitoring** | Every decision writes `approval.decided` with actor, reason and before/after; every effect has its own action row (`credit.profile_updated`, `product.price.override_set`, `pos.shift.reviewed`, `stock_write_off.approved`, `count.posted`). No PII, token or PIN is logged: `state` refuses the customer's name in a 409 message for exactly this reason. |
| **A10 Mishandling exceptional conditions** | Fail-closed by construction: a stale price or limit is a **409 that rolls back** and leaves the approval `PENDING`, never a silent apply. The oversell trigger is a job, not a sale-path call, so an unexpected failure cannot reject a completed sale. `app.onError` maps `AppError` to a status and never returns a stack trace. |

---

## 4. Defects found and fixed

| # | Defect | Where it came from | Fix |
|---|---|---|---|
| 1 | `net_minor` was described as the ex-tax base in Plan 09; it is tax-inclusive after discounts | Plan 09 §1/§7 | Used `sale_line.base_minor`, the field analytics already sums; otherwise every ABC score would carry the 20% tax — `3a00c41` |
| 2 | Plan 07's decision pseudocode parses the payload before handling `REJECTED`, making an unreadable request impossible to reject | Plan 07 §3 | Rejection checked first — `1418052` |
| 3 | `inventory.threshold` is held by managers as well as admins, so route permission alone let a manager edit ABC classes | Plan 09 §7 premise | `roleOf(user) === 'ADMIN'` in the ABC manual and recompute paths, with a test — `3a00c41` |
| 4 | "Return null on the partial unique" needs a savepoint; a bare catch cannot survive an aborted transaction, and `postCount` is one | Plan 09 §5 | Nested transaction with constraint-name matching — `3a00c41` |
| 5 | `resolveScopeProducts` could not pass the frequency `rotationBatchSize` needs | Plan 09 §3 signature | Optional fifth argument; the published four keep their order — `3a00c41` |
| 6 | A manager could not list branches, so the transfer source picker had no choices and BRN-01 was half usable | Plan 12 premise; found by the console lane | `GET /api/branches/directory` behind `branch.read`, active only, exact key set asserted — `5c4b6a1` |
| 7 | `staff.test.ts` asserted it was the only active admin in a shared database | Exposed when two new suites began creating admins | Parks and restores other active admins instead of weakening the assertion — `4c39604` |
| 8 | An admin with no branch got no low-stock figure in the operations summary | Plan 10 acceptance | `inventory.listLowStock` answers an unscoped admin read with one row per branch; `/stock` keeps requiring a branch — `4c39604` |
| 9 | A concurrent in-band price write surfaced as a 500 | Plan 06 race the lane flagged | `product_price_product_branch_unique` maps to a retryable 409 — `4c39604` |
| 10 | Subject payloads could only be read by casting or by reaching into `approval.payload` | Plans 06–08 working around a narrow union | `ApprovalSubject` arms widened to what the loaders already returned; module-local types collapse to `Extract<…>` — `4c39604` |
| 11 | The demo seed carried no count history, so accuracy rendered `null` and the rotation figure was a best case | Plan 09 evidence | Three posted counts per branch with ledger-reconciled variances; `accuracyBp` **6667**; rotation re-measured 0.698 ms — `d31d2f0` |
| 12 | The console lane ran `biome lint`, which does not enforce formatting, while the root gate runs `biome check` | Phase 12 console work | 27 files formatted; lint back to exit 0 — `0ede794` |
| 13 | Plan 11 derived `canDispatch` on the client | Plan 12 correction | Uses the server's `transfer.canDispatch` — `8d81ac8` |
| 14 | `StatusNote` was referenced by the plan but did not exist in the console | Plan 11/12 | Added `components/common/status-note.tsx` — `8d81ac8` |
| 15 | **The stock detail page crashed** (`Cannot read properties of undefined (reading 'tone')`) for any product with a `WRITE_OFF` or `SUPPLIER_RETURN` movement — i.e. every write-off this phase creates and every supplier return Phase 11 creates | Phase 11/12 movement enums widened; the console union was not | `StockMovementType` gained both values and `MOVEMENT_META` both labels, so the `Record` type is the guard; reproduced before, rendered 25 rows after — the fix commit |

### Mutation proofs — 8/8 caught (`evidence/mutations.txt`)

| # | Mutation | Caught by |
|---|---|---|
| 1 | `withinPriceBand` `<=` → `<` | `packages/shared/src/pricing.test.ts` |
| 2 | self-approval check removed | `packages/shared/src/approvals.test.ts` |
| 3 | `deciderBranchId` comparison dropped | `packages/shared/src/approvals.test.ts` |
| 4 | dispatch accepts `REQUESTED` | `api/src/modules/transfers` |
| 5 | rejected write-off posts its movements | `api/src/modules/writeoffs` |
| 6 | stale-price guard removed | `pricing-band.test.ts` |
| 7 | manager shrinkage guard removed | `api/src/modules/inventory` |
| 8 | shift tolerance `>` → `>=` | `shift-review.test.ts` |

No mutation was missed, so no test gap had to be repaired in this pass.

---

## 5. Numbers

| | Before Phase 12 | After |
|---|---|---|
| shared tests | 239 | **239** |
| API tests | 479 | **596** (+117) |
| desktop tests | 427 | **427** (unchanged) |
| admin modules | 17 | **19** |
| brand-gated files | 964 | **1 035** |

The desktop figure is **427**, not the 421 written into the phase plans and README: that
number was already stale when the phase was planned. The proof that matters is the empty diff
(`git diff --name-only 2b3f551..HEAD` is `api/**` and `admin/**` only) and the suite passing
unchanged.

---

## 6. What is not proven, named

- **`SHIFT_VARIANCE_REVIEW` is proved end to end, including through the browser.** The API
  walkthrough drives the real `POST /api/pos/sync/upload` (device enrol → JWT → open → close one
  pesewa over tolerance) and decides the review; the console walkthrough does the same and asserts
  the row offers exactly one action (*Record outcome*), that the outcome dialog says it cannot be
  rejected, and that the badge falls afterwards.
- **The shift-review requester is the shift's cashier, not whoever pressed close.** The
  `SHIFT_CLOSE` payload carries no staff identity, so a manager who physically counted a
  cashier's drawer could review it; the cashier themselves is blocked, and that case is tested.
  Closing it needs an upload-payload change, which P12-D27 forbids this phase — **carried to
  Phase 13**, which already owns the till.
- **The admin has no all-branch low-stock page.** The summary's `lowStock` figure is present for an
  admin (the API answers an unscoped count), but the console links it to a branch-filtered stock
  list because the list is one row per product per branch and no all-branch stock page exists.
- **Approval expiry is not implemented.** Age is displayed; nothing expires. Unscheduled.
- **No shift list in the console.** Phase 14's oversight screens own it.
- **`REFUND` is a type without a handler** until Phase 13 registers one; the registry asserts
  the exact set, so this is visible at boot rather than discovered at 4pm.
- **A manager can still post a negative `CORRECTION` adjustment directly.** Documented in Plan
  05 as a deliberate hole with an audit row rather than a silent one.
- **Performance is demonstration-scale, not production-scale.** Rotation 0.698 ms and the
  over-limit predicate 0.027 ms on the demo dataset; both fit in a handful of buffers and a
  forced index was slower, so no index was added. `stock_count_line` has no `product_id`-leading
  index, which needs a fresh measurement at ~10⁵ rows.
- **`TransferApproval` carries no `deciderRole`**, so the detail card names the branch and says
  "Awaiting a decision" rather than printing "manager" or "administrator". The request form does
  state the role from the branch directory.

---

## 7. Evidence index

| File | What it is |
|---|---|
| `evidence/suites.txt` | The whole gate matrix in one transcript — **ALL SUITES PASSED** |
| `evidence/run-suites.sh` | The script that produced it |
| `evidence/walkthrough-branch-ops.mjs` | 32 legs, fixtures through the API, three figures re-derived from SQL |
| `evidence/walkthrough-branch-ops.txt` | `PASS 93 / FAIL 0` |
| `evidence/walkthrough-console.txt` | The console walkthrough, extended with the four new sections and the manager/admin legs |
| `evidence/mutations.sh` | The eight mutations, apply → run → revert |
| `evidence/mutations.txt` | **8/8 caught** |
| `evidence/shots/` | Every new screen at 1440 px, the inbox and both forms at 1024 × 768 |
