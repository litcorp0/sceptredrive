# STATE — Sceptre Drive v1

> **Renamed 2026-10-24:** Sceptre Drive → **Sceptre Drive**. Historic sections below keep the
> old name; the code and document sweep is Phase 7, Plan 01.

**Milestone:** v1
**Updated:** 2026-10-27
**Status:** **Phase 13 (POS Payments, Returns & Shifts) is planned — 13 plans written and ready to
execute.** Phase 12 is complete and verified (13/13). Phase 11 is complete and verified (11/11
plans); Phase 10 is complete and verified (10/10 plans). The roadmap was re-sequenced on 2026-10-24:
four interface phases (7 Identity/Design System, 8 Admin Modules & Shell, 9 Analytics & Dashboard, 10
Desktop Modules & Shift Home) were inserted ahead of the former Phases 7–9, and a later audit the
same day added Phase 11 (Procurement & Replenishment) and Phase 12 (Branch Operations & Approvals).
The former 7/8/9 became Phases 13/14/15.
**Next action:** execute **Phase 13, Plan 01 — Shared vocabulary: tender, refund and hold
arithmetic**. The planning set is `phases/13-pos-payments-returns/`: `README.md` (index, lanes,
execution shape), `00-DECISIONS.md` (P13-D1…D40), `01-RESEARCH.md` (official sources + 38 verified
repository facts) and `01…13-PLAN.md`. Phase 12's verification is
`phases/12-branch-ops-approvals/12-VERIFICATION.md`.

---

## Progress

| Phase | Name | Status |
|---|---|---|
| 0 | Planning & decisions | ✅ Complete |
| 1 | Foundation & Platform | ✅ Complete (4/4 plans, verified) |
| 2 | Catalog & Pricing | ✅ Complete (6/6 plans, verified) |
| 3 | Inventory & Transfers | ✅ Complete (8/8 plans, verified) |
| 4 | Customers, Credit & Loyalty | ✅ Complete (8/8 plans, verified) |
| 5 | Suppliers & Payables | ✅ Complete (7/7 plans, verified) |
| 6 | POS Offline Core | ✅ Complete (9/9 plans, verified) |
| 7 | Identity, Design System & Brand Foundation | ✅ Complete (7/7 plans, verified) |
| 8 | Admin Module Architecture & Shell | ✅ Complete (13/13 plans, verified) |
| 9 | Analytics, Dashboard & Reporting Read Models | ✅ Complete (8/8 plans, verified) |
| 10 | Desktop POS Modules, Chrome & Shift Home | ✅ Complete (10/10 plans, verified) |
| 11 | Procurement, Replenishment & Supplier Returns | ✅ Complete (11/11 plans, verified) |
| 12 | Branch Operations & Approval Workflow | ✅ Complete (13/13 plans, verified) |
| 13 | POS Payments, Returns & Shifts | 🔷 Plans written (13 plans, ready to execute) |
| 14 | Admin Operations & E-VAT | 🔷 Context locked (8 plans) |
| 15 | Production Hardening & Launch | ⏸ Context deferred — blocked on deployment inputs |

### Phase 13 planning notes (2026-10-27)

- Thirteen plans written to `phases/13-pos-payments-returns/`: `README.md` (index, lanes, execution
  shape), `00-DECISIONS.md` (P13-D1…D41), `01-RESEARCH.md` (12 official sources + 38 verified
  repository facts), and `01…13-PLAN.md`. The locked context sketched ten; the count grew because the
  payments module, the Z-report, the admin detail and the desktop's four screens each needed their own
  prompt.
- **Five decisions were put to the operator and answered**: held carts stay terminal-local and
  `REQUIREMENTS.md` POS-15 is corrected (D29); card goes through Paystack Checkout in a locked-down
  Electron window (D13); refunds are allocated per tender with the cashier choosing (D19); a
  credit-sale refund reduces the ledger and pays no cash (D20); the refund cap is the gross amount on
  one document with no accumulation (D21).
- **Six defects in the locked context were found and resolved rather than implemented**:
  - D2 wanted `sale_tender.status` *and* "the sale is written once at completion" — the status moved to
    `payment` (D2);
  - D5's "card refunds work offline" contradicts D12 — electronic refunds are online-only, and the PIN
    is what makes an offline **cash** refund possible (D24);
  - D5's "and the terminal is online" was a condition on something the server always does — the
    approval always raises on upload (D23);
  - D6's `DAMAGED` line "posts the stock write-off path" would double-decrement, because the sale
    already removed the unit — `DAMAGED` posts **no** movement (D22);
  - D17's recall "recomputes … loyalty" would re-promise a redemption against a moved balance — the
    redemption is preserved or reduced with an explicit notice (D35);
  - D19 is written as if holds were shift-scoped while D16 makes them terminal-scoped — the close dialog
    is where the two meet (D30).
- **The two Phase 12 carry-forwards are retired.** `REFUND` is registered with a handler, a subject arm
  and a boot-list entry in Plan 05, so the registry test's "honest unregistered type" case is rewritten
  around a deliberately wrong registration map. The shift-review requester identity is fixed by adding
  `closedBy` to the `SHIFT_CLOSE` payload (D41), which closes the self-review hole for any till running
  this build and falls back to Phase 12's behaviour for one that is not.
- **The phase starts from zero on payments.** `grep -rni paystack` over `api/ admin/ desktop/
  packages/` returns nothing; `.env.example` declares three `PAYSTACK_*` keys that no code reads; there
  is no payment, refund, webhook or provider file anywhere. Plan 03 is therefore a greenfield module,
  not a refactor.
- **Schema additions**: `payment`, `payment_event` (a new `payments` module), `refund`, `refund_line`,
  `refund_tender`, `cart_void`, `shift_report`; extensions to `sale_tender` (`sequence`, `payment_id`,
  the partial unique on `payment_id`, and `(sale_id, sequence)` replacing `(sale_id, method)`). New
  enums: `payment_method`, `payment_provider`, `payment_status`, `refund_reason`, `refund_restock`,
  `refund_tender_status`, `cart_void_reason`. Added values: `sale_tender_method` (`MOMO`, `CARD`,
  `BANK_TRANSFER`), `pos_transaction_type` (`REFUND`, `CREDIT_REPAYMENT`, `CART_VOID`),
  `stock_movement_type` (`RETURN`), `stock_movement_reference` (`REFUND`), `sync_conflict_type`
  (`PAYMENT_LATE_SETTLEMENT`, `PAYMENT_AMOUNT_MISMATCH`) — all in **their own migration file**, because
  PG 17 cannot use an added enum value in the transaction that added it.
- **One new permission**, `pos.refund` (ADMIN, MANAGER); `CASHIER` stays empty, because a cashier
  reaches the till through a device-bound PIN and never through the admin API. **One new setting**,
  `pos.refundApprovalThresholdMinor` (20 000, branch-overridable, admin-writable). There is deliberately
  no refund numbering setting: the till numbers refunds offline from its local `document_sequence`.
- **The till gains five local-only tables** (`cart_tender`, `held_cart`, `held_cart_line`, `cart_void`,
  `shift_report`) and three mirror tables for offline refund caps (`refund`, `refund_line`,
  `refund_tender`). `powersync/sync-config.yaml` is unchanged and no table becomes synced, so Plan 13
  proves an empty diff over `powersync/`.
- **Known limits recorded at planning time**: refunds are scoped to sales this terminal recorded
  (D25); a refund approval is retrospective by design; an orphaned payment needs a person, never an
  automatic refund (D9); `DAMAGED` refunds are recorded on the refund line but not inventoried as
  shrinkage until Phase 14 reports them; approval expiry is still unimplemented; the console has no
  refund list until Phase 14.

### Phase 12 execution notes (2026-10-26)

- **Plans 01–05 are complete.** Commits: `0037096`, `4ee2403`, `cc639eb`, `2941bdf` (shared);
  `7311772`, `045daa9`, `cc85348`, `a98634f`, `9c90552`, `4a76575` (schema);
  `0a81657`, `6e9a9d2`, `d6446b5`, `505bd87`, `c757144` (approvals core); `cd32d75`, `a500027`,
  `5df1f49`, `cbc2ac9` (transfer requests); `ed583ba`, `7aa6e1b`, `33e0460`, `69bed53`
  (write-offs). Numbers: shared **191 → 239**, API **479 → 521**, desktop **421 → 427** (the
  enrolment fix's six tests), `check-types` 6/6 green, `api lint` green.
- **The permission rename stayed green across every commit.** Plan 01 removed
  `procurement.approve`; Plan 02 bridged the decide route literal and the service's decider-role
  lookup, and the controller moved the two console call sites (`approval-panel.tsx`,
  `products-page.tsx`) in `ccbb02f` because `admin/**` is not the api lane's to edit. Plan 03 then
  replaced the bridge with the real per-row authority.
- **`approval.decider_role` / `decider_branch_id` exist and are written by `requestApproval`.**
  The service checks branch access against `deciderBranchId ?? branchId` — Phase 11's check would
  have 403'd the source manager on a transfer request whose `branchId` is the destination.
- **The inbox is two-sided.** A manager's list and summary match `branch_id = X OR
  decider_branch_id = X`, because a transfer request is raised at the destination and decided by
  the source. A badge that undercounted the queue it badges was the alternative.
- **Plan 02's enum-only migration is `0011_enum_branch_ops.sql`; the DDL is `0012`.**
  `stock_adjustment_reason` gained `THEFT`, `OBSOLESCENCE`, `SUPPLIER_FAULT` so a posted
  `WRITE_OFF` movement can carry the form's reason (`EXPIRY` maps to `EXPIRED`); the write-off
  table keeps its own enum.
- **ABC ranking lives in `counts.repository.ts`** (the seed wrapper resolves the settings), because
  `counts.service.ts` is frozen to Plan 09. A branch with zero total score classes every product
  `C` rather than scheduling counts of nothing.
- **`postMovements` now honours an explicit outbound `unitCostMinor`.** Without it the ledger could
  not carry the approved write-off value, and P12-D17 would be false once a receipt moved the
  average. `SUPPLIER_RETURN` movements now carry the returned line's cost instead of the branch
  average; no test asserted the old value, but review should see that line.
- **Boot assertions grow one type at a time.** `app.ts` and the registry test's `BOOT_LIST` are at
  `['PRODUCT_CREATE','PURCHASE_ORDER','TRANSFER_REQUEST','STOCK_WRITE_OFF']`; Plans 06–08 append
  their own type in the commit that registers the handler and loader. `REFUND` stays out until
  Phase 13.
- **The enrolment bug fixed during this session (`06071bd`).** The keychain token was persisted
  correctly; `ensureSession` mapped every non-network failure to `missing`, so a token the server
  no longer knew (the database was reset during Phase 11 verification) rendered the first-install
  enrolment screen, and a 5xx would have done the same. There is now a `rejected` state, a single
  classifier, a credential-problem screen that names the likely cause and offers an explicit
  re-enrol, and no automatic token deletion. Six tests; desktop **421 → 427**.
- **Pre-existing, left alone:** `admin/src/modules/settings/pages/settings-page.tsx` and
  `admin/src/modules/branches/pages/branch-detail-page.tsx` remain locally modified (a stray
  formatter run). With them stashed, `bun run lint` exits 0 with 19 warnings; with them present,
  the formatter is the only error. `packages/brand/src/tokens.css` gained four `biome-ignore`
  comments with the reason the reduced-motion block needs `!important` (`a3a001c`), because that
  rule would otherwise fail the phase's lint gate on a file the phase never touched.
- **Flakiness observed, not caused:** `sync.test.ts > rate limits PIN attempts per device` failed
  once in a full API run and passed alone and on the next full run; `pin.test.ts` Argon2 tests
  timed out once under load and pass in 2 s alone. Both are timing-sensitive, and neither file was
  touched by this phase.

### Phase 12 execution notes — plans 06–10 (2026-10-26)

- **Plans 06–10 are complete.** Commits: `6a8297d` (price band), `1418052` (credit limits),
  `40dfbab` (shift variance review), `3a00c41` (cycle counts), `2d35f1c` (operations summary).
  Numbers: API **521 → 583** (+62: 14 price band, 10 credit, 11 shift review, 17 counting,
  10 operations). Shared **239**, desktop **427**, admin unchanged. `check-types` 6/6, API suite
  45 files green, brand gate over **990** tracked files, lint exit 0 with the same 19 warnings.
- **The three wave-1 plans ran in parallel, which is a deviation the operator chose.** The README
  says plans 04–09 are serial because they are one lane; the operator asked for maximum safe
  parallelism instead. The shape that made it safe: three `api-lane` subagents in **one working
  tree** with **disjoint directories** (`products/**`, `credit/**`, `pos/**`) and no shared file
  available to any of them. Worktrees were rejected because a fresh worktree has no
  `node_modules`, so no lane could run its tests.
- **The controller owned the two shared files, and that is why every commit is green.**
  `api/src/app.ts` and `approvals.registry.test.ts` are the only files all three plans must touch,
  and three concurrent edits to one array is a lost update. Each lane was told to leave them alone;
  the controller then landed one plan per commit, appending that plan's type to both boot lists in
  its own commit. That is what the README's "in the same commit as their handler and loader" asks
  for, and it is why the three commits are independently bisectable rather than one merged blob.
- **The registry test is an exact-match assertion in both directions**, so a plan cannot commit its
  handler before its boot entry: the four-type `BOOT_LIST` failed the moment one lane registered
  five. That is the intended tripwire working, not an obstacle.
- **Lanes wrote no git history.** Three agents sharing one index would have mixed each other's
  files into the wrong commit (`git add` is not scoped to a process). The controller staged and
  committed. The cost is that a plan's four or seven planned commits became one commit each, with
  the plan's commit list enumerated in the body; this is the Phase 11 precedent.
- **Plan 06.** `writeOrRequestPriceChange` is one decision shared by set and remove, so deleting an
  override cannot escape the band — at 9 000 against a 10 000 base, removal is an **11.1%**
  increase, and the pre-existing `products.test.ts` removal case had to be updated because it now
  correctly becomes a request. The request path writes nothing to `product_price`; the decision
  handler refuses a stale request with 409 and leaves the approval `PENDING`.
- **Plan 07.** The authority table lives in `updateProfile`, not the route: a manager's increase is
  a 403 that names the request endpoint even if the client sends the field anyway (OWASP A01). The
  decision handler writes **no** ledger row — a limit is an entitlement, not money owed — and the
  test asserts the ledger count and balance are untouched. The over-limit list shares analytics'
  predicate and a parity test holds the two definitions together.
- **Plan 08.** The review is raised inside the existing upload transaction with **strictly greater**
  than tolerance, and `updateShiftReview` cannot represent a money column: the patch type has no
  such key and a runtime guard refuses one reached by a cast. The three money columns are asserted
  column by column before and after the decision. `ShiftApplyResult` is unchanged, so the till
  never learns an approval exists (APR-06).
- **Plan 09 is the largest of the phase** and the one place a plan's premise was wrong. §1 and §7
  call `net_minor` "the ex-tax base"; it is not. `sale_line.base_minor` is, and it is what the
  analytics revenue read model already sums. Using `net_minor` would have inflated every ABC score
  by the 20% tax and disagreed with the seed. Corrected to `base_minor`.
- **Three more plan defects were found and fixed rather than implemented as written.** (a) The
  credit handler's §3 pseudocode parses the payload before handling `REJECTED`, which would make a
  malformed request impossible to reject; rejection is now checked first. (b) `inventory.threshold`
  is held by managers too, contrary to §7's "managers do not", so the ABC manual and recompute
  paths also require `roleOf(user) === 'ADMIN'`. (c) "Return null on the partial unique" needs a
  **savepoint**, not a bare catch: a unique violation aborts the caller's transaction and
  `postCount` is one. `resolveScopeProducts` also gained an optional `frequency` argument, because
  the published signature cannot pass what `rotationBatchSize(activeCount, frequency)` needs.
- **Plan 10 composes, it does not query.** Every figure is another service's `total` with
  `limit: 1`, so parity with the list endpoints is structural and there is no second predicate to
  drift. A forbidden section is **absent, not zero** — zero is a statement about the branch,
  absence about the caller.
- **Indexes: none added, and the measurement is why.** `EXPLAIN (ANALYZE, BUFFERS)` on the dev
  database gave rotation 0.963 ms and the oversell scan 1.865 ms, both under the plan's 50 ms bar.
  `sync_conflict_type_created_idx` now has a real reader — the nightly trigger scan — so it stays.
  The rotation figure is a **best case**: the demo seed carries no `stock_count_line` rows yet, so
  the Phase 11 rule ("the index must have a reader") is satisfied but the volume claim is not
  proven. A `stock_count_line(product_id)` index is worth revisiting once the seed carries count
  history; no migration was written.
- **Known limits recorded now, not discovered later.** (a) The `SHIFT_CLOSE` upload carries no
  staff identity, so a variance review's requester is the shift's cashier: a manager signing off a
  *cashier's* drawer would be allowed to review it, though the cashier themselves is blocked. That
  case is tested. Closing it needs an upload-payload change, which P12-D27 forbids this phase.
  (b) An admin who has chosen no branch receives **no** `lowStock` figure, because
  `inventory.listLowStock` requires a branch by contract and an all-branch count would count a part
  once per branch; the global question belongs in `inventory/**`. A manager always has a branch.
  (c) `price_change` and `shift_variance` carry their extra detail in the approval **payload**, and
  each module publishes a widened local type, because the shared `ApprovalSubject` arms are fixed
  at the plan's five fields and `approvals.types.ts` belongs to Plan 03.
- **Two new test suites each create an admin**, which surfaced a pre-existing fragility rather than
  a defect: `identity/staff.test.ts` asserts it is the *only* active admin in the shared test
  database, and a row left behind by an interrupted lane run made it fail. Removing the stale row
  restored it. The suite is clean-database-dependent; `db:test:prepare` on a fresh database is the
  supported state, and this is recorded rather than papered over with a weakened assertion.
- **The POS is untouched.** `git diff --name-only 2b3f551..HEAD` lists only `api/**`; `desktop/`,
  `powersync/`, `packages/` and `admin/` are all empty. Plan 13 still owes the desktop suite run
  and the `git diff --stat` proof over `desktop/` and `powersync/` with the phase's own tag.
- **Pre-existing, left alone:** `admin/src/modules/settings/pages/settings-page.tsx` and
  `admin/src/modules/branches/pages/branch-detail-page.tsx` remain locally modified (a stray
  formatter run). With them present, the formatter is the only `bun run lint` error; stashed, lint
  exits 0 with the same 19 warnings. The phase did not author, fix or commit them.

### Phase 12 execution notes — plans 11–13 (2026-10-26)

- **Phase 12 is complete and verified.** `12-VERIFICATION.md` maps all nine roadmap criteria, the
  sixteen requirements and the OWASP table to a numbered leg, a committed test or a screenshot.
  Commits for the back half: `393342d` (inbox and operations view), `5c4b6a1` (branch directory),
  `8d81ac8` (request screens), `0ede794` (console formatting), plus the verification commit.
- **Numbers.** API **479 → 596** across the phase (+117), shared **239** unchanged, desktop
  **427** unchanged, admin modules **17 → 19**, brand gate over **1 035** files.
  `evidence/suites.txt` is the whole matrix in one transcript and ends **ALL SUITES PASSED**.
- **The external API walkthrough is `evidence/walkthrough-branch-ops.mjs`:** 32 legs, **93
  assertions**, 0 failures. Fixtures are created through the API, and three figures are
  re-derived from SQL rather than read back — the approved write-off value (150 000 from
  `stock_write_off.value_minor` = Σ lines = Σ `WRITE_OFF` movements = `approval.amount_minor`),
  the transfer source level (20 → 18 after dispatching 2), and accuracy (2 matched of 4 counted
  → **5000 bp**). Legs 21–26 drive the real `POST /api/pos/sync/upload` with a device JWT and
  the real pg-boss jobs, so the shift and count paths are proven over HTTP rather than assumed.
- **Eight mutations, eight caught** (`evidence/mutations.sh`, `mutations.txt`): the inclusive
  price band, the self-approval check, the `deciderBranchId` comparison, the dispatch guard, the
  write-off rejection branch, the stale-price guard, the manager shrinkage guard, and the
  shift tolerance boundary. Nothing was missed, so no test gap needed repair this round.
- **The console shipped with one scope addition and one correction.** The operations cards had to
  link somewhere real, so `/inventory/write-offs` and `/customers/over-limit` were created as
  minimal lists in Plan 11 and completed in Plan 12; and Plan 11 derived `canDispatch` on the
  client, which Plan 12 replaced with the server's field.
- **A real API gap was found by the console and fixed, not worked around.** `GET /api/branches` is
  branch-scoped for managers by design, so the transfer source picker had nothing to offer and
  BRN-01 was half usable. `GET /api/branches/directory` now returns `{ id, code, name, type }` for
  active branches behind `branch.read`, with the exact key set asserted so a later widening cannot
  silently leak address, staff or financials. `/api/branches` is unchanged and re-proven.
- **The demo seed gained count history** (`d31d2f0`) because Plan 09's rotation figure was a best
  case with an empty `stock_count_line`, and the accuracy tile would have rendered `null` on the
  very screens this phase is about. Three posted counts per branch, variances posted through
  `postMovements`, ledger reconciled: `accuracyBp` **6667**, rotation re-measured at 0.698 ms.
- **Limits closed after the plans landed** (`4c39604`): subject payloads are now typed in
  `ApprovalSubject` instead of being cast; an admin's operations summary has its low-stock figure;
  a concurrent in-band price write is a 409 rather than a 500; and `staff.test.ts` no longer
  depends on an otherwise empty database.
- **Two gates were red for reasons the phase inherited and both are now green.** The root
  `bun run lint` runs `biome check` while the console lanes had run `biome lint`, so 27 files were
  unformatted (`0ede794`). And the two admin files that had been locally modified with a stray
  formatter run since Phase 11 are no longer modified.
- **What is still not proven.** `SHIFT_VARIANCE_REVIEW` has not been decided through the browser —
  shifts come from the PowerSync upload, so the click-through needs a device fixture. The
  shift-review requester is still the shift's cashier (Phase 13). The admin has no all-branch
  low-stock **page** even though the API now answers the count. Approval expiry is unscheduled, the
  shift list is Phase 14's, `REFUND` waits for Phase 13, and a negative `CORRECTION` adjustment
  stays a documented hole. All of it is named in `12-VERIFICATION.md` §6.

### Phase 12 planning notes (2026-10-26)

- Thirteen plans written to `phases/12-branch-ops-approvals/`: `README.md` (index, lanes, execution
  shape), `00-DECISIONS.md` (P12-D1…D38), `01-RESEARCH.md` (official sources + 38 verified
  repository facts), and `01…13-PLAN.md`. Research is folded into `01-RESEARCH.md` so the next
  session does not repeat it. The context's nine-plan sketch became thirteen because the authority
  layer, the operations read model and the two console plans each needed their own prompt.
- **Five decisions were put to the operator and answered**: `approval.read`/`approval.decide`
  replace `procurement.approve`, with per-row decider role and branch (D1/D2); managers lower a
  credit limit directly and request any increase (D21); managers must route shrinkage through a
  write-off request (D13); shift review is a separate `review_status` column plus an approval row,
  not a new `shift_status` value (D24); ABC classes are per branch (D29).
- **Seven defects in the locked context were found and resolved rather than worked around**:
  `APPROVAL_DECIDER_ROLE` maps every type to ADMIN, so D4's source-branch manager cannot exist
  (D2); `procurement.approve` is admin-only, so managers could decide nothing (D1); D9's
  `REVIEW_REQUIRED` shift status would drop shifts out of the reconciliation query, which filters
  `status = 'CLOSED'` (D24); "increases beyond the requester's own authority" was undefined (D21);
  `scopeId` in D15 could not express a half-configured schedule (D28); D17's oversell trigger inside
  `applySale` could reject a sale that already happened at the till (D32); `selectSnapshotRows`
  cannot see a never-stocked part, which Phase 10 carried forward (D31).
- **Two unapproved paths already existed and are closed**: a manager's direct price override
  (`products.service.ts:416`) and direct shrinkage adjustment (`inventory.service.ts:438`). Without
  D13 and D18 the workflows would be advisory.
- **Schema additions**: `stock_write_off`, `stock_write_off_line`, `count_schedule`,
  `stock_abc_class`; extensions to `approval` (`decider_role`, `decider_branch_id`), `stock_count`
  (`count_type`, `scope`, `scope_key`, `due_at`, `assigned_to`, `schedule_id`, `trigger_*`), `shift`
  (`review_status`, `reviewed_by`, `reviewed_at`, `review_note`), plus indexes on
  `sync_conflict(type, created_at)`. New enum values: `transfer_status` (`REQUESTED`, `APPROVED`,
  `REJECTED`), both movement enums (`WRITE_OFF`), `stock_adjustment_reason` (`THEFT`,
  `OBSOLESCENCE`, `SUPPLIER_FAULT`), in **their own migration file** because PG 17 cannot use an
  added enum value in the transaction that added it (verified in the official docs).
- **Six new settings**: `pricing.managerBandPercent` (10), `pos.shiftVarianceToleranceMinor`
  (2 000), `inventory.countVarianceToleranceMinor` (1 000), `inventory.writeOffPrefix` (`WO`),
  `inventory.abcAThresholdBp` (8 000) and `inventory.abcBThresholdBp` (9 500).
- **Three pg-boss schedules**, all Africa/Accra with `missed: 'once'`: count schedules at 02:00, ABC
  recompute at 03:00, oversell trigger scan at 03:30. The oversell scan is a job rather than inline
  in `applySale` on purpose: a failure there would reject a sale the till has already completed.
- **Execution shape**: `packages/**` alone first; `api/**` is one lane for plans 02–10, so they are
  serial; `admin/**` for 11–12; verification last. The only parallelism considered is 06 ∥ 07
  (`products/**` versus `credit/**`) and it is optional.
- **The phase touches no client that sells.** No `desktop/**` file, no `sync-config.yaml`, no local
  schema, no outbox change — the `shift` table is not synced, so even the review columns are
  server-only. Plan 13 proves it with an empty `git diff --stat` and the desktop suite still at 421.
- **Known limits recorded now**: approval expiry is still not implemented (age is displayed);
  there is no shift list in the console (Phase 14's oversight screens own it); the `REFUND` type
  exists and stays undecidable until Phase 13 registers its handler; and a manager can still post a
  negative `CORRECTION` adjustment directly, which is a documented hole with an audit row rather
  than a silent one.

### Phase 12 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared vocabulary: approval permissions, authority, band and count arithmetic | ✅ Complete |
| 02 | Schema, enum migrations, settings, document kind, seeds | ✅ Complete |
| 03 | Approvals core: per-row authority, subject registry, inbox and summary | ✅ Complete |
| 04 | Transfer requests: request, decide, dispatch guard, withdraw | ✅ Complete |
| 05 | Stock write-offs: document, approval, posted `WRITE_OFF` movement | ✅ Complete |
| 06 | Price band and price-change requests | ✅ Complete |
| 07 | Credit limit change requests and the over-limit list | ✅ Complete |
| 08 | Shift variance review | ✅ Complete |
| 09 | Cycle counts: schedules, ABC, trigger counts, accuracy | ✅ Complete |
| 10 | The operations summary read model | ✅ Complete |
| 11 | Console: unified approval inbox and the manager's operations view | ✅ Complete |
| 12 | Console: request screens for transfers, write-offs, price and credit | ✅ Complete |
| 13 | Verification, evidence, state update | ✅ Complete |

### Phase 11 planning notes (2026-10-25)

- Eleven plans written to `phases/11-procurement-replenishment/`: `README.md` (index, lanes,
  execution shape), `00-DECISIONS.md` (P11-D1…D20), `01-RESEARCH.md` (sources + 30 verified
  repository facts), `01…11-PLAN.md`. Research is folded into `01-RESEARCH.md` so the next session
  does not repeat it.
- **Five decisions were put to the operator and answered**: the credit note is posted with the
  return in one transaction (D1); the approval threshold compares the ex-tax goods value (D2);
  D7's `reorder_quantity` is replaced by a minimum order quantity (D3); `SENT` records a send and
  unlocks a printable PO, with no email integration (D4); Phase 11 ships a PO-filtered queue, not
  the unified inbox (D5).
- **Four defects in the locked context were found and resolved rather than worked around**:
  D7 and D8 define the same quantity two ways; D11's "existing settings sequence machinery" cannot
  express per-branch-per-month numbers, so `document_sequence` is a new table (D15);
  `drizzle-kit migrate` wraps each file in a transaction, so `ALTER TYPE … ADD VALUE` must be its
  own migration (D16, verified in `node_modules/drizzle-kit/bin.cjs`); and D5's header-only PO link
  cannot support the line-level variance it requires.
- **The phase touches no client that sells.** No `desktop/**` file, no `sync-config.yaml`, no local
  schema, no outbox change — Plan 11 proves it with an empty `git diff --stat` and the desktop
  suite still at 413.
- **Schema additions**: `purchase_order`, `purchase_order_line`, `supplier_return`,
  `supplier_return_line`, `supplier_credit_note`, `approval`, `document_sequence`; extensions to
  `stock_threshold` (`max_quantity`, `min_order_quantity`), `stock_receipt` (PO link, idempotency),
  `stock_receipt_line` (PO line, over-receipt reason), `supplier_invoice` (PO link) and
  `supplier_invoice_line` (PO line, `match_status`).
- **`product.cost_price_minor` becomes derived and read-only** (D13): written only by an inbound
  `RECEIPT` movement through `inventory.repository.updateDerivedCost`, which is documented as the
  one deliberate cross-module write because `products.service` already imports `inventory.service`.
- **Execution shape**: `packages/**` alone first; `api/**` is one lane for plans 02–08, so they are
  serial; `admin/**` for 09–10; verification last. The only parallelism considered was 06 ∥ 07
  and it was rejected — they both edit `payables.service.ts`.
- **Known limits recorded now, not discovered later**: lead time and preferred supplier are global
  because `supplier_product` has no branch column (D10); credit notes reduce the balance but are
  not aged (D9, following Phase 5's on-account rule); write-off requests stay in Phase 12 (D8);
  approval expiry is not implemented.

### Phase 11 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared vocabulary: permissions, approval types, replenishment arithmetic | ✅ Complete |
| 02 | Schema, migration, threshold settings, document numbering, seeds | ✅ Complete |
| 03 | Approvals core, threshold resolution, product submission | ✅ Complete |
| 04 | Purchase order lifecycle | ✅ Complete |
| 05 | Receiving, supplier-product link, derived catalogue cost | ✅ Complete |
| 06 | Invoice matching against a purchase order | ✅ Complete |
| 07 | Purchase returns and supplier credit notes | ✅ Complete |
| 08 | Replenishment suggestions and supplier performance | ✅ Complete |
| 09 | Console: procurement module | ✅ Complete |
| 10 | Console: replenishment and supplier performance | ✅ Complete |
| 11 | Verification, evidence, state update | ✅ Complete |

### Phase 11 execution notes (2026-10-25)

- **Plans 01–07 were executed in an earlier session and this file was never updated.** Their
  commits are `a132bc0` (shared vocabulary), `949b097` (schema, numbering, settings), `1b638c9`
  (approvals), `9b5b438` (order lifecycle), `5ac263d` (receiving), `f2916f9` (invoice matching) and
  `dac33ff` (returns and credit notes), plus two fixes (`a04fe12` CORS, `780268d`/`3e33492` desktop
  CSP). The whole API suite was green before Plan 08 began: **36 files, 451 tests**.
- **Plan 08 complete** (commits `a408d0e`, `c077484`, `378e327`). API **451 → 477** (18 new in
  `replenishment.test.ts`, 7 in `procurement.test.ts`, 1 in `inventory.api.test.ts`); shared
  **191** and desktop unchanged; `check-types` 6/6.
- **Three commits instead of the plan's five, and the reason is structural.** The plan split the  two read models into separate commits, but both live in the same six module files, so the split
  would have committed the same files twice; they land together. The plan's fifth commit was to be
  "suggestion arithmetic against hand-computed fixtures", and those tests were written with the
  code they test instead of after it. Both deviations are bookkeeping, not scope.
- **No index was added, and the measurement is the reason.** `EXPLAIN (ANALYZE, BUFFERS)` on the
  seeded demo month shows a hash join with a seq scan on `sale_line`; adding
  `sale_line_product_sale_idx` inside a rolled-back transaction did **not** change the plan
  (4.04 ms → 2.60 ms with noise in that range), because the query joins on `sale_id`, not
  `product_id`. Plan 08 said "if it seq-scans `sale_line`, add the index and record why"; the
  honest record is that the index has no reader, so the migration was not written. Evidence in
  `phases/11-procurement-replenishment/evidence/08-velocity-and-suggestion.md`.
- **One query, not two per supplier.** Cost drift reads the two newest receipt lines per
  `(supplier, product)` through a window function, so a screen with sixty suppliers runs one
  statement instead of a hundred and twenty; the two rows are re-sorted in the service so the
  figure cannot depend on the database's row order.
- **Two definitions were tightened against the plan's prose, and the tests say which.**  (a) The promised lead time averages over **delivered** lines only, the same set as the actual
  lead time, so "we promised 7, they took 9" compares like with like; averaging undelivered lines
  in produced 48 tenths where the fixture's delivered lines promise exactly 40.
  (b) The fill rate is gated on the order's **status** (`RECEIVED`, `CLOSED`,
  `PARTIALLY_RECEIVED`), which is what P11-D11 says, rather than on "has any receipt" — a
  cancelled order must not depress a supplier's fill rate.
- **A zero cost is refused, not silently replaced.** When a suggestion order carries
  `unitCostMinor: 0`, the order is rejected with the product named rather than falling back to the
  supplier's last cost: substituting a number the manager typed is how a wrong price is agreed, and
  a zero-value line would pass any approval threshold. An omitted cost does take the link's last
  cost (P11-D12).
- **Defect found and removed:** `POST /api/procurement/returns/:id/post` was registered twice —
  same handler, same middleware — left behind by Plan 07. Harmless at runtime, removed in
  `c077484`.
- **Numbers proved by hand, not by shape.** The suggestions tests assert the exact arithmetic on
  every branch of `suggestReplenishment` (coverage 900 sold / lead 7 / safety 7 / max 40 / on hand
  10 → 130; the same row with 130 on order → 0; no history → 30 and `NO_HISTORY`; MOQ 50 →
  `MIN_ORDER`; no level → 0 and `NO_LEVEL`; never stocked → 20). Performance asserts 2/3 on time →
  **6667 bp**, 200 of 270 fillable → **7407 bp**, lead time 43 tenths against a promise of 40,
  drift 500 minor → **1000 bp**, and `null` rather than `0` for a rate with no denominator.
- **Branch scoping is enforced twice, as P11-D17 requires:** routes check `procurement.read`, the
  service resolves the branch from the session, and a manager asking for another branch gets
  **403** while an admin without a branch gets **400** rather than every branch's rows.
- **Not proven here, by design:** the console has no screens yet (Plans 09–10), so nothing has been
  driven in a browser; the idempotency replay, threshold and ordering paths are proven at the API.
  Plan 11's walkthrough owns the IDOR legs and the reconciliation against the ledgers.
- **Pre-existing, left alone:** `admin/src/modules/settings/pages/settings-page.tsx` and
  `admin/src/modules/branches/pages/branch-detail-page.tsx` were already modified in the working
  tree (a stray formatter run adding semicolons, and one removed `max-w-xl`). The formatter change
  is the only `bun run lint` error in the repository and is **not** from Phase 11; it was left
  untouched rather than reverted, and the Plan 08 gates were read with that failure named.

- **Plan 09 complete** (commits `da472f8`, `aaac249`, `bade691`, `c0703d2`, `8b7aef2`,
  `29132bd`, `8e0afee`, `2161083`, `0f13f07`, `2782cf3`). The console section is
  `admin/src/modules/procurement/` with six thin routes, a nav entry and breadcrumbs; every
  action button comes from the server's `canApply`, never a client guess. Gates: `check-types`,
  `admin lint`, `admin build`, `modules:check:strict` **17/17** admin, and the browser walkthrough
  at **159/159**.
- **Two plan defects were resolved rather than worked around.** (a) The plan asked for a
  `matchStatus` filter on the invoice list, but the API's list row carries `hasVariance`; the list
  gets a `variance=true` filter and a variance badge, and the line-level status stays on the detail
  where the payload has it. (b) Product submission had **no admin decision screen** anywhere in
  the plan, so a submitted product could never become one; the products page gained a pending
  submissions panel behind `procurement.approve`.
- **Two API reads the plan assumed but did not exist** were added, because a screen cannot be
  honest without them: `purchaseOrderId` on the receipt list (and as a filter), so an order can
  show its deliveries, and `GET /api/procurement/receipts/:id/returnable`, so the return dialog
  caps at `received − returned` instead of discovering the cap from a 400 (`a0df343`, `2782cf3`).
- **Plan 10 complete** (commits `8f04a38`, `aec5505`). `admin/src/modules/replenishment/` holds
  the suggestions table with a `Why?` breakdown that prints every input the API returned, the
  raise-order dialog (DRAFT at the supplier's last cost, never submitted from the screen), the
  Unassigned group with its "Choose supplier" action, and the supplier performance screen with its
  stated definitions and exclusions. The threshold dialog is **one component with two doors**:
  the stock page and the replenishment row both open it, and it now carries Maximum and Minimum
  order quantity.
- **Plan 11 complete.** `11-VERIFICATION.md` maps all ten roadmap criteria, the fifteen
  requirements, the OWASP table and every defect to a command, a leg number or a screenshot.
  Evidence: `suites.txt` (`ALL SUITES PASSED`), `walkthrough-procurement.txt` (**85 assertions**,
  fixtures created through the API, three suggestion facts re-derived from SQL),
  `walkthrough-console.txt` (**159/159**), `08-velocity-and-suggestion.md` and nine screenshots.
- **Numbers.** shared **149 → 191**, API **394 → 479**, desktop **413 → 421** (the +8 are the two
  local-API/CSP fixes committed during the phase's setup, before Plan 01 — no plan in this phase
  touched `desktop/**`), `modules:check:strict` **17/17** admin and **14/14** POS, brand gate over
  **964** tracked files, `tokens:check` OK, lint exit 0 with 25 pre-existing warnings.
- **A fresh database cycle ran end to end**: `docker compose down -v`, `up -d`, `db:migrate` (all
  files from zero, including the split enum migration), `db:test:prepare`, `db:seed --demo`,
  `sync:init`, `seed:demo-sales` (168 shifts, 2 433 sales).
- **Six mutations proved the gates can fail**, each applied, failed and reverted: the threshold
  boundary (`>=` → `>`), `assertBranchAccess` removed from `getOrder` (IDOR leg 26a), the
  over-receipt reason guard removed, the self-approval check removed, credit notes not subtracted
  in `sumSupplierOwed`, and `.strict()` dropped from the order body.
- **Mutation 5 found a gap rather than confirming one.** P11-D9 claims the archive rule is "a
  tested invariant, not a comment", and no test exercised it; the first attempt at the mutation
  failed nothing. `suppliers.test.ts` now proves a credit note offsets an invoice so a fully
  returned supplier can be archived (`65e0136`).
- **The POS is untouched in the way that matters.** `git diff --stat 8a0804a..HEAD --
  powersync/` and the local schema, powersync client and outbox paths are all empty; the only
  desktop changes are the two setup commits above, neither of which touches the selling path.
- **Deviations, all deliberate.** Plan 09's eight commits became ten (the lane's six plus two
  controller follow-ups after the API reads landed); Plan 10's six became two because the splits
  would have committed the same generated files twice. The console screenshots are one viewport
  (1440 px) rather than 1024 × 768 + 1440 × 900. Supplier performance does not name "the product
  that drifted most": the row does not carry one, and the screen shows what the API returns.
  The empty state's "last computed" time is the client's last successful fetch.
- **Carry-forwards.** The top-drift product and a server compute timestamp are one-field API
  additions; a supplier lead-time *spread* (not just the mean) is the next useful performance
  figure; a 1024 × 768 console pass for the procurement screens; and the plan set's out-of-scope
  items stay out (emailing a PO is Phase 15, approval expiry and the unified inbox are Phase 12,
  PO-side E-VAT is Phase 14).
- **Pre-existing, left alone:** `admin/src/modules/settings/pages/settings-page.tsx` and
  `admin/src/modules/branches/pages/branch-detail-page.tsx` remain locally modified (a stray
  formatter run and one removed class). They were stashed for the gate transcript and restored
  afterwards; the phase did not author, fix or commit them.

### Phase 10 execution notes (2026-10-25)

- **Phase 10 verified** — 10/10 plans. `01-VERIFICATION.md` maps every roadmap criterion to a
  command or a recorded step; `evidence/suites.txt` is the whole gate matrix in one transcript
  (`evidence/run-suites.sh`), and `desktop/test/e2e/counter-audit.mjs` is the phase's new gate.
- **Numbers.** shared **127 → 149**, API **394** (unchanged; the one edit is `analytics.service.ts`
  adopting the shared average-basket helper), desktop **339 → 413**, packaged shell E2E
  **38 → 40**, packaged print **21/21**, counter audit **150/150** (new), `modules:check:strict`
  **14/14 POS** and **15/15 admin**, brand gate over **880** tracked files. Renderer bundle
  **1,242,949 → 1,271,754** bytes, +28,805 — D11's 250 KB budget was never in play. Nine
  screenshots at 1024 × 768 in `evidence/shots/`.
- **Decisions.** P10-D1…P10-D15 are indexed in `00-DECISIONS.md` and folded into
  `00-CONTEXT.md` under "Amendments (2026-10-25)", with footnotes on D5, D6, and D13 where a
  refinement contradicted the locked table.
- **Deviations, all deliberate.** The E2E landing assertions were updated for `#home` (Plan 05)
  and for `#diagnostics` (Plan 08) — pointed at the route that owns them, never loosened. Phase 7's
  `verify-charts-desktop.mjs` is left as history and superseded by the counter audit. D13's
  "both themes" became light-only (P10-D8). The counter audit drives the **unpackaged** build
  because a packaged app cannot enrol against localhost by design. Four commits instead of the
  plan's seven in Plan 07, and four instead of five in Plan 09, because in both cases the split
  would have committed the same file repeatedly.
- **Defects found and fixed: 11.** A first install opening the diagnostics shell; product tiles
  truncating names; two `(minor / 100).toFixed(2)` money inputs; ~100 raw palette classes; the
  pointer-only tender keypad; the tender screen inventing a credit answer; the number row dying
  after a failed PIN; autofocus swallowing the staff code; no visible focus indicator on four
  screens; a pending receipt's badge satisfying `/Printed/i`; and today's sales counting other
  days' unprinted receipts into "today". The table is in `01-VERIFICATION.md`.
- **Carry-forwards.** `stock_threshold` sync and never-stocked parts → **Phase 11**. Held carts,
  split tender, refunds, and the `averageBasketMinor`-on-a-negative-take question → **Phase 13**.
  Phase 6's 51-check `e2e-pos.mjs` (device revocation, duplicate upload, last-unit race) was **not
  re-run** because it assumes it owns `:4000`; those legs belong to **Phase 15**'s offline drill
  suite and the gap is named in the verification rather than papered over. A dark till, if ever
  wanted, is unscheduled. Two cosmetic items are recorded and unfixed: the sell screen's credit
  panel flashes "No account here" for one frame, and `components/ui/sidebar.tsx` is a generated
  registry file the POS never renders.

- **Plan 09 complete** (commits `815baa2`, `88d828c`, `71e4d5c`, `4682947`). The counter audit
  is a gate, not a transcript: `bun run --filter desktop test:counter` reports **150/150** from
  the repository root, drives nine screens across three viewports, and leaves a screenshot per
  screen at 1024 × 768 in `phases/10-desktop-pos-redesign/evidence/shots/`.
- **The audit found two real defects, and both are fixed rather than asserted around.**
  (a) *The tender keypad was the last pointer-only step in a sale.* To enter cash the cashier
  had to Tab to the on-screen keys and press Enter ten times. The digit model moved into
  `appendPesewaDigit`/`removePesewaDigit` and the number row drives it. (b) *The tender screen
  invented a credit answer.* `hasProfile: false` meant both "no account here" and "not looked
  yet", so for one frame a customer with GH₵5,000 of headroom read as `NO_PROFILE` — and
  `creditNeedsApproval` treats that as a reason to ask a manager. A cashier pressing F9 in that
  window would have been sent to an override dialog for a sale that needed none. `CustomerContext`
  now carries `creditLoading`.
- **The gate was proved able to fail, by mutation.** Adding one pesewa to the expected take and
  one `text-emerald-600` to a module produced three failures and exit 1; both were reverted. The
  mutation run is also what reproduced the credit defect deterministically: the assertion had been
  passing or failing with the sync timing until the fixture was examined.
- **The first draft of the audit could not fail.** `check()` had `(label, condition)` while every
  call site passed `(condition, label)`, so each assertion evaluated the label string and printed
  `PASS true`. It reported 150/150 on the first run, which is what gave it away. The signature now
  matches the call sites, and the ten `check(true, …)` cases that follow a `waitFor` are documented
  as deliberate: reaching the line is the proof, because `waitFor` throws.
- **Two flaky reads were test bugs, not product bugs.** The credit decision was read before the
  element rendered, and the average basket was parsed with `digits()` over the whole sub-line
  ("3 sales · 4 items · GH₵171.67"), which concatenated the counts into the amount. Both are
  fixed; three consecutive runs are green.
- **The audit drives the unpackaged production build**, not the packaged binary: a packaged app
  sets `allowLocalOrigins: false` by design, so it cannot enrol against a localhost API. Same
  bundle, `app://` origin, preload bridge, and CSP; `security-smoke.mjs` still proves the
  packaged binary at 40/40.
- **Fixtures are created per run, never borrowed.** A terminal and a customer with a real credit
  limit come from the admin API. The seeded ACC-SPX customer is already over its limit from the
  Phase 9 demo month, so using it would have tested the override path instead of the sale.
- **Bundle recorded for Plan 10:** main chunk **1,271,754 bytes**, +28,805 on Plan 06's
  1,242,949 and +5,024 on Plan 07's 1,266,730. D11's 250 KB budget was never in play. Written to
  `evidence/bundle.json` with a trailing newline, because the first version broke `bun run lint`
  on every run.
- **One carry-forward the audit cannot close:** the sell screen's credit panel has the same
  "no account here" flash as the tender screen had. It is cosmetic there — nothing acts on it —
  and it is recorded rather than folded into a verification plan's fix.
- **Gates.** Desktop **413/413** (50 files), shared **149**, API **394**, `check-types` 6/6, lint
  exit 0 (24 pre-existing warnings), `brand:check` over 880 tracked files, `tokens:check`,
  `modules:check:strict` 14/14 both clients, counter audit **150/150**, packaged shell E2E
  **40/40**.

- **Plan 08 complete** (commits `9f4ba3d`, `697a116`, `2abeb6a`, `2443876`, `7194351`,
  `e498bae`, `36b6043`, `def55ab`). Seven task commits as the plan listed them, plus one fix
  commit for what review found. Desktop **387 → 406** (four new test files: routing, lockout
  copy, variance, amount validation); no existing assertion edited. API 394, shared 149
  unchanged.
- **A first install now opens enrolment, and it was proven on a real fresh install.** The outer
  switch moved into `topLevelScreen(parseHash(hash))` so it is testable without a database or an
  Electron window: empty, `#`, `#/`, and an unknown hash all resolve to sign-in. A one-off
  Playwright run against the built app with a brand-new `userData` directory reported **9/9** —
  the enrolment field is visible, the heading says what it is for, no keychain or version text
  reaches a cashier, `#diagnostics` still opens the shell (which now says it is not the till),
  `#spike` still renders, and `#typo` returns to enrolment rather than to the shell. The script
  lives outside the repo because it needs a packaged build; Plan 09's audit owns that matrix.
- **The landed fix cost two E2E edits, and both are deliberate.** `security-smoke.mjs` (two
  legs) and `sync-smoke.mjs` waited for `shell-ready`, which is now a named route. They enter
  `#diagnostics` explicitly, after `waitForLoadState('domcontentloaded')`. Review pointed out
  that left no committed test booting the app the way a terminal does, so both legs now also
  wait for `#enrollment-code` on their fresh `userData` directory and assert the enrolment form
  is what a shop sees. The packaged shell smoke is **40/40** (was 38) — including "no CSP
  violations in the console", which proves booting into the sign-in screen does not break the
  policy.
- **`sync-smoke` remains broken for its own pre-existing reason** (`pos-shell`, recorded in Phase
  6/Plan 05). This plan did not make it worse and did not fix it — fixing it needs a signed-in
  fixture, which is the audit's job. It also means `sync-smoke` was **not** run to green here.
- **The desktop vitest had no `@` alias, so the first module `utils/` file with a value import
  could not be tested at all.** `desktop/vitest.config.mts` gained the alias. Every existing test
  passed only because they are relative-only by accident.
- **Three plan premises were wrong and are recorded rather than implemented.** (a) "the temp-PIN
  banner stays" — there is no banner, anywhere; the only trace is a comment claiming one exists.
  The comment now says what actually happens: `pinMustChange` stays set, so the next sign-in asks
  again. (b) "Two `Card` sections: terminal and printer" — taking it literally would have deleted
  the discount caps, loyalty rates, and lockout policy a manager reads on the till, so they are
  labelled groups *inside* the identity card; two cards, nothing lost. (c) "An unprinted older
  receipt is still listed" needed no code: `listSalesBetween` already carries
  `OR print_status IN ('PENDING','FAILED','PRINTING')`, so the behaviour existed and only the
  copy understated it.
- **The variance tile is honest while the shift is open.** Variance cannot exist before the
  drawer is counted, so the third figure reads "—" with the caption *Known when you count the
  drawer* rather than a zero that would say the drawer balanced. The real figure appears in the
  close summary and in the close dialog, both in words.
- **Words beat colour in three places this plan.** `varianceWords` ("Over GH₵12.00" / "Short
  GH₵4.00" / "Exact") is a pure `utils/` function with four cases; a conflict is only styled as a
  problem at `HIGH`, and it says "High — needs review"; the settings self-test says "Test print
  sent" or "The test print did not go through. <reason>". The previous versions encoded all three
  in a hue.
- **The PIN pad gained a hidden field, not a second control.** The number row types, Backspace
  edits, Enter submits, and every keypad button hands focus back. The field is
  `type="password"` so the value never reaches the accessibility tree, and a live region announces
  "3 of 6 digits entered". `lockoutMessage` names the remaining minutes, including "1 minute" and
  a partly elapsed one rounded up.
- **The sweep is empty and the grep is a trap.** `grep -E "amber-|emerald-|sky-|red-|zinc-"` over
  `modules/**`, `components/{layout,common}/**`, and the two route files returns nothing;
  `#dev/sync`, `#dev/print`, `#spike`, and `#diagnostics` keep raw classes as the plan allows.
  **The pattern also matches `'stored-token'`** in `desktop-api.test.ts` (`red-` inside
  `stored-`), so a future gate must use a class-shaped pattern rather than a substring.
- **Review found four real defects in the first pass, all fixed in `def55ab`.** (a) The number
  row stopped working after every failed PIN: `busy` disabled the hidden field, a disabled
  control drops focus to `<body>`, and the refocus effect keyed on `disabled`, which never
  changed. It is `readOnly` now. (b) Autofocus was unconditional, so on the activation screen
  the digit field swallowed the staff code (`GA-0004` became `0004` in the PIN with the code box
  empty); autofocus is opt-in. (c) There was **no visible focus indicator at all**, because the
  only focusable control is `sr-only`; the dot display draws the ring now, and it had to be an
  arbitrary property — `outline-2` reads `--tw-outline-style`, which is `none` in this
  stylesheet, so it compiles to nothing. (d) The sales caption's total summed other days'
  unprinted sales into "today", on the screen a manager cross-checks a Z-report against.
- **Gates.** Desktop **406/406** (49 files), shared **149**, API **394**, `check-types` 6/6, lint
  exit 0 (24 pre-existing warnings), `brand:check` over 877 tracked files, `tokens:check`,
  `modules:check:strict` 14/14 both clients, packaged shell E2E **40/40** after a real
  `electron-forge package` (the Forge package-manager probe still needs
  `npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64"`).
- **Not proven here:** the PIN pad's number-row/Enter path *after a rejected PIN* and the lockout
  sentence against a real lock, because both need an enrolled terminal with a staff binding. The
  code path is now correct by construction (`readOnly` keeps focus; the effect restores it when
  it has gone nowhere), but it has not been driven. Nor have the six screens' 1024 × 768 layout
  or the reduced-motion pass. All of it is Plan 09's counter audit.

- **Plan 07 complete** (commits `c93457e`, `8baf7f0`, `ee0cbd8`). The tender screen now reads
  change at counter distance and the receipt is the paper. Desktop **387** (was 384; three new
  tests, none edited).
- **Three commits, not the plan's four, and the reason is structural.** The plan's fourth
  commit ("semantic colour tokens replace the raw palette") has no independent diff: every raw
  class in these two modules sat on a control the first three commits were already restyling,
  so it is folded in rather than staged as a fourth pass over files it had just rewritten. The
  third commit is the review fix below.
- **The plan's `Exact` claim was stale**, exactly like Plan 06's "24–28 px" one: `Exact` was
  already `h-11` (44 px) from Plan 03, not `h-10`. The keypad keys were already 48 px. What
  actually changed is the method pair (12 px taller and now a segmented control) and the
  credit panel.
- **The total did not move into the money block.** The plan's structure diagram puts Total,
  Received, and Change in one stack; the keypad's `Total due` row would have been the second
  copy of a figure the totals rail already shows. Total stays in the screen header as muted
  context (`text-lg`, `text-muted-foreground`) and the keypad holds the two figures a cashier
  touches. Reading order is unchanged: Total → Received → Change.
- **`data-testid="tender-total"` stays outside the cash branch on purpose.** Plan 06's perf
  evidence waits on that id before clicking `exact-cash`; moving it into the keypad would have
  made it absent in the credit and zero-total branches.
- **Radix `ToggleGroup type="single"` reports `''` when the pressed item is pressed again** —
  documented under "Ensuring there is always a value". Unhandled, clicking the already-selected
  *Cash* would clear the method, `ready` would read as if no method were chosen, and `F9` would
  complete with a `TenderMethod` that is not in the union. `nextTenderMethod` now owns that
  decision (see below).
- **The selected state is non-colour on purpose.** A check icon in a reserved 16 px box, a 2 px
  border, and a `font-bold` label: three signals that survive colour blindness (WCAG 2.2
  SC 1.4.1). The icon's box is reserved in both states so the label does not jump when the icon
  appears; the border grows inward and the centred label widens symmetrically, so neither
  moves it sideways.
- **The receipt's surface moved from `bg-white text-black` to `--card`/`--card-foreground`.**
  The surface is equivalent — `--card` is `#FFFFFF` in the POS's light-only theme (P10-D8) — and
  it removes the last raw palette from the module; the body text shifts from pure `#000` to
  `--ink #1b1f23`, which is the difference the design system exists to make. `role="article"`
  on the `Card` keeps the accessible name the `<article>` element carried; `Card` alone renders
  a `div`, where `aria-label` would be inert.
- **The print badge's words are load-bearing in both directions.** Labels are `Pending`,
  `Printing…`, `Printed`, `Did not print`; `data-status` still carries the machine value. The
  Phase 6 evidence selects that chip with `hasText: /Printed/i`, so `PRINTED` must say
  "Printed" **and `PENDING` must not contain the word.** The first draft labelled PENDING
  "Not printed yet", which satisfied that wait before anything had printed — a FAILED or stuck
  PRINTING receipt would have passed, and `perf-pos` would have measured ~0 ms. Review caught
  it; it is the same cannot-fail class as `196209c`.
- **Review also caught two things worth keeping:** the change figure's live region wrapped only
  the amount, so a screen-reader cashier heard a bare number with no way to tell a shortfall
  from change owed (the label is inside the region now, with `aria-atomic`); and the Radix `''`
  guard was an unchecked `as TenderMethod` cast with no test. It is now `nextTenderMethod`,
  a pure function in `modules/tender/utils/` with three cases, which also rejects values that
  are not tender methods instead of casting them into the union.
- **No DOM test harness was added.** The desktop suite is node-only (`environment: 'node'`, no
  jsdom, no testing-library), so component behaviour is proven by `utils/` unit tests plus
  Plan 09's counter audit rather than by rendering. Adding jsdom would have touched
  `bun.lock`, which is a controller file.
- **The 44/48/56 px claim was checked in the compiled stylesheet, not assumed.** The renderer
  builds (`bunx vite build --config vite.renderer.config.mts`, **1,266.73 kB** — well under
  D11's 250 KB growth budget against Plan 06's 1,242,949) and the emitted
  CSS carries `h-11`→2.75rem, `h-12`→3rem, `h-14`→3.5rem, plus every new semantic utility
  (`data-[state=on]:border-2`, `border-foreground`, `bg-ok/10`, `bg-warn/10`, `bg-info/10`,
  `size-1.5`, `font-display`). A misspelt class would have compiled to nothing.
- **Gates.** Desktop **387/387** (46 files, no existing assertion edited), shared **149**, API
  **394**, `check-types` 6/6, lint exit 0 (24 pre-existing warnings), `brand:check` over 871
  tracked files, `tokens:check`, `modules:check:strict` 14/14 both clients.
  `grep -E "amber-|emerald-|sky-|red-|zinc-|neutral-|bg-white|text-black"` over both modules
  returns nothing.
- **`bun run --filter desktop test:print` was not run.** It drives `#dev/print`, which renders
  the ESC/POS text through `toEscPosLines`, and this plan changed neither `lib/receipt/render.ts`
  nor `lib/printing/**` — the paper is untouched by definition. Running it needs a packaged
  build and the fake-printer harness; Plan 10's gate matrix is where it gets run.
- **Not proven here, by design:** the live 1024 × 768 pass with a real printer and a cash drawer.
  It needs an enrolled terminal, and it is Plan 09's counter audit — which also owns the width,
  keyboard, reduced-motion, and offline-copy matrix. No figure was checked against a hand count
  or a paper receipt yet. Two known gaps review named and this plan did not close: the disabled
  *Credit* control's reason is visible but not `aria-describedby`-linked (a disabled button is
  out of the tab order, so a screen-reader user meets the sentence in reading order instead),
  and the FAILED→primary promotion has no unit test because it is a two-branch class decision.

- **Plan 06 complete** (commits `fd289f9`, `196209c`). The product card is content-sized with a
  three-line name, its height owned by `--product-card-height` in `index.css` and read by the
  virtualiser through a `ResizeObserver`, so the row estimate cannot drift from the painted card.
  Notice and error bars became a shared `StatusNote` (`role="status"`/`role="alert"`, tint plus dot,
  label always foreground), which removed the last raw palette classes from `sell`, `cart`,
  `catalog`, `customers`, `credit`, and `loyalty`. Desktop **384** unchanged, no test edited.
- **Two planning claims were wrong and are now corrected in the plans.** The card-controls premise
  ("24–28 px today") was stale — Plan 03 had already taken them to 44 px. And the audit assertion I
  wrote for the truncation fix (`scrollHeight <= clientHeight + 1`) **cannot fail** on a
  `-webkit-line-clamp` element, because the clamp sets both to the clamped height; Plan 09 now
  measures an unclamped clone instead, and checks hit areas with `elementFromPoint` rather than
  trusting a bounding box.
- **The truncation claim is proven against the real compiled stylesheet** in headless Chromium: all
  twelve demo product names fit in ≤2 lines at 1024×768 with the price inside the card, and a
  58-character synthetic name takes exactly 3 and still keeps the price inside. The live sale stays
  with Plan 09.
- **Observed, not fixed:** at 1024 px the cart track resolves to 440 px, leaving the catalog column
  ~304 px wide and cards 132 px. That is the pre-existing three-column skeleton, not a regression,
  and every demo name still fits — but it is worth a screenshot in the audit.
- **Plan 05 complete** (commits `7a125b7`, `08f53f3`). `#home` is the landing after sign-in and
  after opening a shift; the five route gates are unchanged. Desktop **371 → 384**. All fourteen
  modules are migrated, `modules:check:strict` now covers both clients (which is what `ci.yml`
  already invokes), and Phase 8's mutation proof still rejects **20/20**.
- **The bundle went down, not up.** 1,266,835 → **1,242,949** bytes (349,210 → 359,460 gzip against
  the *planning* baseline), because retiring `dev-charts` more than paid for the home chart. D11's
  250 KB budget was never in danger.
- **Opening a shift lands on home.** The plan only named the button's hash line; the lane flagged
  that `handleOpen` left the cashier on `#shift` until they pressed it, which contradicts the
  roadmap's "opens on a shift dashboard". The controller added the redirect — the one place this
  phase changed behaviour the plan had not specified.
- **The plan's assumption about E2E landing assertions was wrong.** `desktop/test/e2e/**` never
  asserted a landing screen; it asserts the `app://` origin, CSP, bridge, and diagnostics. Nothing
  was replaced, deleted, or loosened. The historical landing checks live in Phase 6's evidence
  files, which stay as written.
- **Pre-existing defect, found and left:** `desktop/test/e2e/sync-smoke.mjs:213` navigates to `#pos`
  and waits for a `pos-shell` test id that no longer exists in the source. Fixing it needs a
  signed-in fixture, so it trades one broken wait for another; recorded for the audit.
- **Not proven yet, by design:** the figures against a hand count, the drawer-vs-day windows,
  offline correctness, relaunch, the 1024×768 layout, chart keyboard access, and F2's focus handoff
  in Electron. All of it is Plan 09's counter audit — named there rather than assumed here.
- **Plan 04 complete** (commits `b50dbde`, `d83bd69`). `modules/home` holds every day-bounded
  query, the pure arithmetic, and the midnight rollover; no screen yet. Desktop **345 → 371**.
- **`dayWindow` anchors the day to UTC before building the bounds.** A bare date string parses as
  *local* midnight, so on a laptop whose clock sits in another zone the window slid by the offset —
  a till would report a different day than the receipt numbers it printed. The helper the plan did
  not call for is the one that makes the timezone claim true.
- **Expected cash is re-read through `db.onChange`, not watched.** It is a service call, not one
  statement, so `useQuery` cannot express it; the SDK's documented path for "several queries that
  must run together" is `onChange` with the same 250 ms throttle and an explicit table list.
- **The conflict-count SQL moved into `modules/sync`** as `useOpenConflictCounts()`. The plan's
  "nothing outside `modules/home` changes" could not survive its own no-duplication rule.
- **The SQL itself is not proven yet, deliberately.** The vitest suite mocks the SDK and the
  migration harness writes `shift.status = 'open'` where the runtime writes `'OPEN'`, so asserting
  the seven statements there would have proved a fixture. Plan 09's counter audit drives real sales
  through the real app and checks the figures; that is where this gets proven.
- **Plan 03 complete** (commits `765fce3`, `28e4fa8`, `732de9c`). Registry `empty` and `spinner`
  added with the Phase 7 ritual — every existing primitive moved aside and restored byte-identical
  — and this CLI run injected no palette variables at all. The hand-written `Modal` is gone: eight
  dialogs (not seven) use `Dialog`, which brings a real focus trap the old shell never had.
- **Radix does not restore focus when a dialog has no `DialogTrigger`,** and every POS dialog opens
  from state, so focus landed on `<body>` on all nine instances. `useDialogFocusReturn` captures the
  opener and restores it through `onCloseAutoFocus`; the lane drove all nine at 1024×768 and checked
  Escape, backdrop tap, focus return, the 90vh clamp and the wide/narrow widths (**76/76 + 4/4**).
- **Two gate hazards found here.** `tokens:check` and `brand:check` read every `git ls-files` path,
  so a deleted-but-unstaged file makes them throw `ENOENT` — stage before gating, or the verify pass
  reports a false failure. And `bun run --filter desktop build` aborts in Forge's package-manager
  probe under Bun (`npm version "undefined"`) before it compiles anything; Forge's documented
  `~/.skip-forge-system-check` is the escape hatch, and the existing `npm_config_user_agent`
  override is the supported one for CI.
- **Two money inputs seeded their value with `(minor / 100).toFixed(2)`** (discount and cash-count
  dialogs). Both now use `formatMinorPlain`; `grep toFixed` over the renderer is empty.
- **The unprinted-receipt SQL moved into `modules/sales`** as `useUnprintedCount()`, consumed by the
  header today and the home strip in Plan 04. `SyncBadge` deliberately keeps its own conflicts query:
  it must stay byte-identical in state machine and labels, so extracting it was not this plan's job.
- **Plan 02 complete** (commits `e6ceed0`, `8f50757`). Thirteen domains hold the POS screens with
  the admin's seven folders and a barrel each; every route file now routes. `components/pos/`,
  `components/auth/`, and `components/shift/` are gone; `lib/**` did not move.
- **The move is proven by the suite, not by the diff.** Desktop **345/345** with **no test file
  edited**, `check-types` and lint clean, and the gate reports **13/14** with `home` pending.
- **Three adjustments the move forced, all recorded in the commit:** `pin-pad` went to
  `components/common` (the manager-override dialog renders it, so keeping it in `auth` would have
  made a global import a module barrel — the Phase 8 cycle); the customer and loyalty dialogs are
  `createPortal`'d from their owning panels, because the panels sit inside the
  `hidden … lg:block` aside and F4/F6 would otherwise open an invisible dialog at the 1024 px
  minimum; and `CatalogBrowser` composes search, grid, and scan listener so the sell page imports
  one barrel per domain.
- **Plan 01 complete** (commits `b9aeb87`, `574b32b`, `b255615`, `e004b55`, `20d4bf8`,
  `97a51e1`, `1cdf192`). `@sceptre/shared` owns the day window (`accraDayBounds`, `to` from
  calendar parts, never `+86_400_000`), the rollover duration (`msUntilNextAccraDay`, always in
  `(0, 86_400_000]`, derived from the same boundary so the timer and the query cannot disagree),
  and the one money division (`averageBasketMinor`). `sale` is indexed on
  `(terminal_id, occurred_at)` and the database opens with a 64-statement cache.
- **Numbers.** shared **127 → 149**, desktop **339 → 345**, API **394** unchanged. Admin module
  gate mutation proof **20/20** after the engine extraction, and the admin gate's output is
  byte-identical in both modes. The new desktop gate reports **0/14** modules and eight
  unmigrated routes; `--strict` exits 1, so CI takes it from Plan 05.
- **The migration is proven, not assumed.** `desktop/test/e2e/schema-migration.mjs` **15/15** in
  Electron against real WASM SQLite: a database written with the previous schema, holding an open
  shift, two sales with lines and tenders, a cash movement and three pending outbox rows, reopens
  with the new schema intact, and the home day-window query plans through
  `ps_data_local__sale__sale_terminal_occurred`.
- **Three findings the plan could not have known.** A vitest case cannot run the migration — the
  desktop suite mocks `@powersync/web` and an in-memory VFS cannot survive a close/reopen, so the
  proof lives in the Electron harness and vitest keeps the fast schema assertions.
  `Schema.props` cannot rebuild the previous schema (it stores `ResolvedTable`s), so the proof
  uses `Schema.tables`. And PowerSync names a local index `ps_data_local__<table>__<declared>`,
  so any future note that says the index is literally called `sale_terminal_occurred` in SQLite
  is wrong.
- **Carry-forward to Phase 13:** `averageBasketMinor` throws on a negative take, where the inline
  expression it replaced returned a negative figure. Nothing reaches it today, but a refund-heavy
  day could make a day's take negative; that phase must decide clamp-vs-separate-figure.

### Phase 10 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared counter maths, local schema indexes, and the desktop module gate | ✅ Complete |
| 02 | `modules/` scaffolding and the route → page split | ✅ Complete |
| 03 | Primitives, chrome, and counter ergonomics | ✅ Complete |
| 04 | Home data layer — reactive queries and pure aggregation | ✅ Complete |
| 05 | Home screen, `#home`, and `dev-charts` retirement | ✅ Complete |
| 06 | Sell module — catalog, cart, and the counter panels | ✅ Complete |
| 07 | Tender and receipt modules | ✅ Complete |
| 08 | Shift, login, settings, sales, and sync modules | ✅ Complete |
| 09 | Counter audit — widths, keyboard, reduced motion, offline copy | ✅ Complete |
| 10 | Verification, evidence, and state update | ✅ Complete |

### Phase 10 planning notes (2026-10-25)

- Ten plans, written to `phases/10-desktop-pos-redesign/`: `README.md` (index and lane order),
  `00-DECISIONS.md` (P10-D1…D15), `01-RESEARCH.md` (sources and repository verifications), and
  `01-PLAN.md`…`10-PLAN.md`. The plan-mode research pass is folded into `01-RESEARCH.md` so the
  next session does not repeat it.
- **Four decisions change what the home screen shows** and refine `00-CONTEXT.md` D5/D6:
  the figures are **this terminal's day** and say so (sales are deliberately not synced, so a
  branch number would be a lie offline); **out of stock now** replaces D5's low-stock item
  (`stock_threshold` is not synced and is not going to be widened here — that is Phase 11);
  the counter shows **no tender mix** (P9-D2: a CASH tender row contains the change handed back);
  and **average basket moves into `@sceptre/shared`** so the till and the dashboard cannot round
  differently.
- **D13's "both themes" is not achievable** and is amended to light-only: the desktop renderer
  never applies `.dark` and has no theme toggle (P10-D8).
- **Two carried-forward defects are scheduled**: a first install opening the diagnostics shell
  instead of enrolment (Plan 08) and POS product tiles truncating names (Plan 06). Two more were
  found while planning: `(minor / 100).toFixed(2)` in two money inputs, and ~100 raw Tailwind
  palette classes across 24 renderer files — both get a gate-able zero in the counter audit.
- **`#home` is a new top-level route**, not a redefinition of `#pos`: nine call sites already
  mean "selling" by `pos`, and the Electron E2E encodes that meaning.
- **Execution shape is in the README, not left to chance.** Seven of ten plans write
  `desktop/**`, so the phase is serial by the one-writer-per-lane rule. The only parallelism that
  is safe is wave 1 (01's three disjoint parts) and wave 4 (04 beside 06/07/08 under a
  directory split with a frozen file set). Two plan defects were found and fixed while working
  that out: Plan 05 edited the route files instead of the module pages Plan 02 creates, and
  Plans 03/04 both claimed `components/layout/app-header.tsx` — the unprinted-count extraction
  now lives in Plan 03 so Plan 04 writes only `modules/home/**`.

### Phase 9 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared contract: basis points, CSV, Accra day, `analytics.read`, seven-step ramp | ✅ Complete |
| 02 | Analytics module core and `GET /api/analytics/overview` | ✅ Complete |
| 03 | `sales`, `products`, `tax` read models + CSV export | ✅ Complete |
| 04 | `inventory`, `credit`, `loyalty`, `payables` read models + exports | ✅ Complete |
| 05 | `seed:demo-sales` — a month through `applySale` | ✅ Complete |
| 06 | Admin `analytics` module: `/analytics`, seven tabs, URL state | ✅ Complete |
| 07 | Dashboard rebuild and `dev-charts` retirement | ✅ Complete |
| 08 | Verification, evidence, and state update | ✅ Complete |

### Phase 9 execution notes (2026-10-25)

- **Goal met:** every dashboard and analytics figure is a server aggregate in one read-only
  snapshot; a manager cannot obtain another branch's numbers by any parameter; the period,
  branch, granularity, tab, and sort all live in the URL; every chart carries a summary
  sentence and a data-table alternative; and all seven views export CSV.
- **Numbers.** API **394** (was 360), shared **127** (was 96), desktop **339** unchanged,
  walkthrough **138/138**, `modules:check:strict` 15/15, `tokens:check` with seven ramp steps
  and 14 chart/surface contrast pairs. Performance on 2,424 seeded sales: every endpoint
  p95 ≤ **56 ms** against the 300 ms budget. Demo seed: **168 shifts, 2,422 sales** across
  three terminals in two retail branches.
- **Decisions taken in planning** (`phases/09-…/00-DECISIONS.md`): gross profit is the
  **ex-tax base minus frozen cost** (using `net_minor` would overstate margin by the 20% tax
  in inclusive mode); the **tender mix is derived** (`take − electronic − credit`) because a
  CASH tender row contains the change handed back; the chart ramp is **seven steps** with
  measured surface contrast; and **URL branch wins on `/` and `/analytics`** with the header
  switcher writing it there.
- **The read-model boundary is a documented exception (P9-D10).** `analytics.repository.ts`
  imports sibling **schemas** to aggregate; it never imports a sibling repository and
  delegates every existing rule (payables ageing buckets, loyalty valuation, low-stock
  semantics) to the owning service.
- **Defect found by the demo month:** `stock_movement` gained `SALE` in Phase 6 but the
  console's `StockMovementType`/`MOVEMENT_META` never did, so any stock detail page with a
  sale in its history threw. Invisible in Phase 8 because no sale movement was on the product
  it opened. Fixed, with the walkthrough now opening that page.
- **Accessibility corrections:** chart panels are named `<figure>` elements (`role="img"`
  would mute the Recharts accessibility layer), and the period fields wrap at 320 px after an
  implicit grid track pushed the page to 953 px.
- **Evidence lives in the walkthrough** (`admin/test/walkthrough-sections.mjs`): it signs in
  once, then runs the 4-width × 2-theme × 2-motion matrix, measures the first series against
  its panel, proves keyboard arrow navigation with the pointer parked off-chart
  (recharts#7905), downloads a real CSV, and leaves its cookie for
  `evidence/verify-analytics-perf.mjs`.
- **The perf script calls each endpoint six times, not eleven**, because eleven would breach
  the endpoint's own 120/min limit (20/min for exports). Measuring must not require disabling
  a rate limiter.
- **Dev database rebuilt** on 2026-10-25 (`drop/create`, migrate, `db:seed --demo`,
  `sync:init`) because an aborted seed left partial demo rows and an open shift. Local
  generated data only; PowerSync was restarted and its publication recreated.
- **Carry-forwards:** refunds stay reserved at `refundsMinor: 0` until Phase 13; electronic
  tender methods group automatically when Phase 13 adds them; `stock_movement` has no business
  date so inventory flow buckets on `created_at`; RPT-04/RPT-05 screens stay in Phase 14; the
  in-memory rate limiter needs a shared store if the API is ever scaled out (Phase 15).

### Phase 8 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Module scaffolding, import convention, modules gate | ✅ Complete |
| 02 | Shared pickers, auth, audit, settings | ✅ Complete |
| 03 | Staff module (the 742-line route), dashboard pulled forward | ✅ Complete |
| 04 | Branches and terminals | ✅ Complete |
| 05 | Catalog module | ✅ Complete |
| 06 | Inventory module | ✅ Complete |
| 07 | Credit module | ✅ Complete |
| 08 | Loyalty module | ✅ Complete |
| 09 | Customers module (composition root) | ✅ Complete |
| 10 | Suppliers module | ✅ Complete |
| 11 | Payables module, last component folder retired | ✅ Complete |
| 12 | Dashboard module and the UIX-07 shell audit | ✅ Complete |
| 13 | Section walkthrough, verification, state update | ✅ Complete |

### Phase 7 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Workspace and package-scope rename | ✅ Complete |
| 02 | Desktop identity, protocol host, CSP, and copy | ✅ Complete |
| 03 | `packages/brand`: tokens, fonts, chart ramp | ✅ Complete |
| 04 | shadcn primitives and chart layer in both clients | ✅ Complete |
| 05 | `date-fns` in shared, admin, and desktop | ✅ Complete |
| 06 | Shell chrome on the new design system | ✅ Complete |
| 07 | Phase verification, evidence, and state update | ✅ Complete |

### Phase 7 planning notes (2026-10-24)

- Roadmap re-sequenced with operator approval: four interface phases inserted as 7–10;
  former 7/8/9 renumbered to 13/14/15. Requirement IDs added: UIX-01…09 (interface
  foundation) and ANL-01…03 (analytics). ADM-02, RPT-01…03 moved to Phase 9; RPT-04…06,
  ADM-07, ADM-08, PAY-04…06, EVAT-01…03 stay in Phase 14.
- Brand palette is fixed by the operator: **#1B1F23** (ink) and **#F26A1B** (brand). Primary
  buttons use **charcoal on orange** (~5.2:1), never white on orange (~3.2:1), which would
  fail WCAG AA for normal text.
- Typography is fixed: Space Grotesk (display), Inter (UI), JetBrains Mono (figures),
  self-hosted via `@fontsource-variable/*` because the desktop CSP is `font-src 'self'`.
- Module architecture is fixed for both clients: `api/ components/ hooks/ pages/ types/
  ui/ utils/` per module; admin routes become `createFileRoute` + one page import; desktop
  keeps PowerSync/outbox/printing/domain services in `lib/`.
- Analytics is a server-owned read model (`api/src/modules/analytics/`), never client-side
  aggregation over paged list endpoints. Branch scope uses the existing
  `assertBranchAccess` / `branchScope` / `resolveBranchFilter` helpers.
- Domain hosts are deferred: the production API/PowerSync origins stay on the current
  placeholder until the real domain is bought, centralised behind one `SCEPTRE_DOMAIN`
  constant in Plan 02 so the swap is a one-line change.
- Renaming `productName` moves Electron's `userData` directory, so existing development
  terminals must re-enrol. Nothing is in production; no migration is written.

### Phase 7 execution notes

- **Plan 01 complete** (commits `4742a71`, `0c6d1b4`, `22a0021`, `ae54542`). Scope
  the old package scope → `@sceptre/*`, root package `sceptre-drive`; the lockfile kept its
  resolution (only the nine workspace entries changed, no transitive version drift); Docker
  project `sceptre-drive-dev` with `sceptre_drive` / `sceptre_drive_powersync`; device JWT
  audience `sceptre-pos`; logger `sceptre-drive-api`; seed emails `@sceptre.local`; demo
  supplier "Sceptre Drive Imports"; API 360/360 after the rename.
- **Dev database decision (operator, 2026-10-24):** the local Postgres on `:5432` is owned by
  a role without `CREATEDB` and no passwordless superuser exists, so the dev/test databases
  now live on the **Docker stack** (`:5434`): `sceptre_drive` + `sceptre_drive_test`,
  recreated with `docker compose down -v`, migrated, seeded (admin + demo), and
  `sceptre_drive_test` prepared. `.env` (gitignored) points at `:5434` and now sets
  `TEST_DATABASE_URL`. PowerSync replicated all synced tables against the new source.
- **Deviations, all deliberate:** `api/test/setup.ts` loads the repo-root `.env` itself
  (`bun run --filter api test` runs with cwd `api/`, so Bun never saw it and the integration
  suites silently skipped); `db:test:prepare` derives the host port from
  `docker compose port postgres 5432` instead of shell-expanded `${POSTGRES_PORT}`;
  `scripts/check-brand.mjs` scans **tracked** files (`git ls-files`) rather than walking the
  tree, so build output, `node_modules`, `api/.mail`, and `.env` cannot produce false
  failures; the allowlist covers `.planning/phases/**` (Phase 7's own plans quote the old
  name) as well as `api/migrations/**` and the one `SCEPTRE_DOMAIN` line. Admin UI copy was
  swept here too (the plan only named documents plus the desktop).
- **Method note:** the ordered sweep must replace the hyphenated DB/container/audience tokens before
  the bare slug, and the protocol host uses a **hyphen** (`sceptre-drive`) while SQL
  identifiers use an **underscore** (`sceptre_drive`). Both traps were hit and corrected
  during the sweep.
- A stray logo/palette prompt had been pasted into `api/test/setup.ts`; it was preserved
  outside the repository (`/tmp/opencode/logo-brief-sceptre-drive.md`) before the file was
  committed clean.
- **Plan 02 complete** (commits `98d1822`, `b312692`, `a85e244`, `d247f5d`). App protocol host
  `app://sceptre-drive` (a hyphen is valid in a registered standard-scheme host; traversal,
  foreign-host, and null-byte rejections unchanged); CSP placeholder `%SCEPTRE_CSP%`; Vite
  plugin `sceptre-csp`; `productName` "Sceptre Drive POS" and Squirrel `sceptre_drive_pos`
  (packaged app verified: the asar carries `productName`, so `userData` ends in
  "Sceptre Drive POS"); one `SCEPTRE_DOMAIN` constant now derives the API/PowerSync origins
  and `isAllowedConnectOrigin`, with the CSP string byte-identical apart from its source.
- **Beyond the plan text:** the preload bridge the preload bridge `window.<old brand>` became
  `window.sceptreDrive` (the old name is not a brand string but cannot survive the gate),
  and `desktop/test/e2e/**` was updated (packaged path, `app://` origin, bridge name) with
  the CSP assertion now reading `SCEPTRE_DOMAIN` from `config.ts` instead of repeating the
  domain. Receipt fallback seller, printer test header, and the local POS database
  (`sceptre-drive-pos.db`) follow the rename.
- **Verification:** desktop **339/339** (none edited to pass), `check-types` clean, lint clean,
  `bun run brand:check` OK over 597 tracked files, `bun run package:pos` produces
  `out/Sceptre Drive POS-linux-x64`, packaged/unpackaged shell E2E **38/38**. Re-enrolment
  consequences documented in `desktop/README.md` ("Renamed to Sceptre Drive").
- **Plan 03 complete** (commits `19115b7`, `602217a`, `ea84203`). `packages/brand` owns
  `src/tokens.css` (palette, shadcn surface map, chart ramp, radius/shadows, layout tokens)
  and `src/fonts.css` (`@fontsource-variable/{inter,space-grotesk,jetbrains-mono}@5.3.0`,
  `wght.css` entries confirmed to exist; families are "Inter Variable", "Space Grotesk
  Variable", "JetBrains Mono Variable"). Both apps now import the package and their 120-line
  duplicate token blocks are gone. Admin build emits one token source and 15 bundled woff2
  files; desktop packages the same. `grep` for the two brand hexes outside `packages/brand`
  finds nothing.
- **Deviations, all deliberate:** three commits instead of four (the workspace, tokens, and
  fonts land together because the package `exports` would otherwise point at files that do
  not exist yet); `packages/brand` also gets a `tsconfig.json`, a `src/css.d.ts`, and
  `lint`/`check-types` scripts so the root filters cover it; `biome.json` gained
  `css.parser.tailwindDirectives` (Biome 2 rejects `@theme`/`@custom-variant` otherwise);
  the auth-shell monogram was changed alongside `SidebarBrand` (the plan named only the
  sidebar and header, but the login card carried the same `GA` mark).
- **Evidence:** `evidence/verify-brand-runtime.mjs` starts a real Chromium against the admin
  dev server and asserts computed typography, the `--brand`/`--canvas`/`--topbar` values,
  light and dark token flips, and that **no request leaves localhost** — **12/12**.
  `evidence/verify-brand-desktop.mjs` does the same inside the real POS renderer (Electron,
  `app://`, production bundle): typography, `--brand`/`--topbar`/`--canvas`/`--surface`,
  chart ramp, radius, and no off-machine request — **10/10**. Screens:
  `evidence/shots/plan03-admin-login-{light,dark}.png`, `evidence/shots/plan03-pos-shell.png`.
  Both scripts normalise minified CSS (`#fff`, `.625rem`) before comparing.
- **Accessibility fix (operator decision 2026-10-24):** `--line #E4E3DF` measures **1.28:1**
  on white (1.19:1 on canvas) and `#333A41` is **1.31:1** on the dark surface. That is fine
  for a decorative rule but fails WCAG 2.2 **1.4.11** (3:1) for an input boundary, which is
  exactly what shadcn maps from the border token. Added **`--line-strong`**: `#7C8794` light
  (3.65:1 on white, 3.38:1 on canvas) and `#6B7280` dark (3.11:1 on `#22272C`), wired to
  `--input` while `--border` keeps `--line`. Same graphite family; no hue introduced, and
  D7's palette is unchanged. Verified in the built CSS and at runtime (resting field border
  `rgb(124,135,148)`; the focused field still carries the brand ring). `MASTER.md` records
  the rule: a decorative rule is not a boundary.
- **Plan 04 complete** (commits `07594b9`, `be54e77`, `3603774`, `66a9a78`). Admin gained
  `chart`, `sidebar`, `tooltip`, `toggle-group`, `toggle`, `popover`, `calendar`, `command`,
  `avatar`, `scroll-area`, `breadcrumb`, `collapsible`, and `empty` from the registry; the
  desktop gained its first `components/ui` set (19 primitives). `recharts` is pinned to
  **^3.10.1** in both apps (the registry writes 3.8.0; 3.10.1 is the React 19-supported
  release). `cn` is the only class helper in both apps and `desktop/src/renderer/lib/utils.ts`
  is deleted.
- **shadcn CLI finding (carry into future phases):** CLI 4.22.1 (a) plans to overwrite every
  existing registry dependency even without `--overwrite`, and (b) appends **16 default
  oklch/hsl variables** (`--sidebar*`, `--primary`, …) to the app stylesheet, which would
  have silently overridden the brand tokens. Both were neutralised: the seven existing
  primitives were moved aside, generated, and restored byte-identical, and the CSS injection
  was reverted. **Never run `shadcn add` over a live token file without checking the CSS
  diff.**
- **Biome findings:** nested configs are inert until they declare `"root": false` (otherwise
  Biome aborts with "Found a nested root configuration"). The generated primitives violate
  five recommended rules (`useFocusableInteractive`, `useSemanticElements`,
  `noDangerouslySetInnerHtml`, `noArrayIndexKey`, `noDocumentCookie`,
  `useExhaustiveDependencies`), so a scoped `overrides` block turns them off **only** for
  `components/ui/**`; nothing else is exempted.
- **Chart proof:** a dev-only gallery renders a two-series revenue area chart, a stacked
  tender-mix bar chart, a horizontal top-products bar chart, and a sparkline KPI. Admin route
  is `/dev-charts` (public but `notFound()` outside `import.meta.env.DEV`; the production
  build answers **404**, verified against `vite preview`). Desktop route is `#dev/charts`,
  dispatched from `main.tsx` (the plan pointed at `_pos/app.tsx`, which only switches POS
  sub-routes). Both galleries carry TODO comments for Phases 9/10.
- **Bugs found by the proof and fixed:** `window.matchMedia` in a `useState` initialiser broke
  admin SSR ("window is not defined" on every render) — now guarded and SSR-safe; the chart
  cards lacked `min-w-0`, so the 320 px layout scrolled horizontally (a grid `min-width:auto`
  overflow); a 48 px Y-axis clipped `100,000`.
- **Verification:** `evidence/verify-charts-admin.mjs` **61/61** and
  `evidence/verify-charts-desktop.mjs` **60/60** — four widths (320/768/1024/1440) × light ×
  dark × reduced-motion: four containers present, no horizontal scroll, no zero-height chart,
  no animation under `prefers-reduced-motion`, first series `rgb(242,106,27)`, tooltip on
  hover **and** on keyboard focus, no off-machine request. 48 screenshots under
  `evidence/shots/plan04-{admin,pos}-*`. Desktop suite still **339/339**; admin production
  build OK; the import-boundary probe fails with the intended message and the barrel import
  passes.

- **Plan 05 complete** (commits `e88815e`, `625e94c`, `ef0330c`, `bcc480e`). `date-fns` 4.4.0
  is in the root catalog and resolves exactly once; `packages/shared/src/dates.ts` is now the
  only place a date format is chosen. Twelve helpers: `formatDay`, `formatDayShort`,
  `formatDateTime`, `formatTime`, `formatMonth`, `formatRange` (three shapes), `formatRelative`,
  `formatBucket` (day/ISO week/month), `formatCount`, `toDateInputValue`,
  `toDateTimeInputValue`, `accraDay`, plus `formatAccraDateTime` for paper. Invalid input
  renders `—`; nothing returns a number; no helper divides money.
- **Admin adoption:** 16 files stopped formatting dates themselves (ledger, statement,
  loyalty history, liability, audit, terminals, devices, transfers, counts, receipts,
  customers, suppliers, dashboard). `admin/src/lib/format.ts` no longer owns `formatDay`;
  its importers now take it from `@sceptre/shared`. Five `new Date().toISOString().slice(0,10)`
  defaults became `toDateInputValue`, the `datetime-local` helper became
  `toDateTimeInputValue`, and number grouping (points, counts, invoice totals) goes through
  `formatCount`. `daysUntil` uses `differenceInCalendarDays` and `isExpiringSoon` requires a
  strictly future expiry, so a partial day or clock change cannot flip a badge.
- **Desktop adoption:** `lib/time.ts` is deleted (`accraDay` lives in shared), the receipt
  prints `23 Oct 2026 10:15`, the sales table and shift screen use `formatTime`/
  `formatDateTime`, the sync badge no longer slices ISO strings, the outbox shows
  `formatRelative` for the next retry (absolute in `title`), and the conflict list shows an
  absolute timestamp.
- **Deviation (deliberate, receipt correctness):** the plan said to build the printed date
  from `formatDay`/`formatTime`, but those format in the host zone. A till laptop set to
  another timezone would then print a different day from the one its receipt number was
  allocated from. Added `formatAccraDateTime` to shared: explicit UTC (= Africa/Accra) via
  `Intl`, the project's one sanctioned `Intl.DateTimeFormat` for dates, and the receipt test
  now asserts the `Date` line is exactly 42 columns and reads `23 Oct 2026 10:15`.
- **Registry exception:** `components/ui/chart.tsx` and `calendar.tsx` keep their internal
  `toLocaleString`/`toLocaleDateString` calls. They are generated shadcn sources; editing them
  would be drift, and the DoD greps are scoped to app code.
- **Verification:** shared **96/96** (73 + 23 date tests), desktop **339/339** (existing
  receipt assertions strengthened, no test deleted), `bun run check-types` 6/6, lint clean,
  brand gate OK, `bun run --filter admin build` and `bun run --filter desktop build` pass,
  packaged print smoke **21/21**. `grep` for `toLocaleDateString|dateStyle` in either app now
  returns nothing outside the registry files. The admin visual pass over ledger, statement,
  aging, and audit is folded into Plan 07's logged-in verification.
- **Housekeeping:** `test:print` regenerates the Phase 6 receipt artefacts under
  `phases/06-pos-offline-core/evidence/`; they were restored to HEAD after the run.

- **Plan 06 complete** (commits `42e375e`, `2cfe00f`, `dee787d`, `493a0e3`, `51d751d`,
  `49a6b46`, `bfcb6bb`, `66060ed`, `713a619`, `913eb57`, `013ab53`). Both clients now open
  onto Sceptre Drive chrome built from `@sceptre/brand` and the registry primitives.
  - **Admin:** the hand-rolled `<aside>` and mobile Sheet are gone; the shadcn
    `SidebarProvider`/`Sidebar collapsible="icon"` carries four groups (Overview, Operations,
    Organisation, System), the permission filter is unchanged, and the active item is the only
    brand orange (a 2 px `--brand` rail drawn with `::before`). Width comes from
    `--layout-sidebar-width`; `use-mobile.ts` moved to a 1024 px breakpoint so the sheet still
    opens below `lg`. The charcoal `bg-topbar` fascia carries breadcrumb, branch switcher,
    theme toggle, and user menu; a skip link precedes the shell and `main#main` takes focus.
  - **Theme:** the official shadcn TanStack Start pattern — `ScriptOnce` from
    `@tanstack/react-router` writes `light`/`dark` from `localStorage['sceptre:theme']`,
    resolving `system` through `prefers-color-scheme`, before hydration. Proven: after a
    reload the `<html>` class is already `dark` at `domcontentloaded`.
  - **POS:** the counter header is the same fascia at `--layout-topbar-height` with ≥44 px
    targets; the sync badge is a pill with a semantic dot + icon + word, its state machine and
    every label byte-identical; boot screens use the `SD` monogram in Space Grotesk; the grand
    total is `font-display tabular-nums` and the pay button stays 56 px charcoal-on-orange.
  - **Accessibility deviations, deliberate:** the plan's `2px --brand` focus ring measures
    **2.83:1** on the canvas, under SC 1.4.11's 3:1, so the global ring uses `--brand-ink`
    (**4.22:1** light, **7.24:1** dark); the plan's `border-radius` on `:focus-visible` is
    omitted because it reshapes pills and avatars while focused. The registry primitives'
    `outline-none` + `ring-ring/50` (**1.76:1**) is overridden by one unlayered rule in both
    app stylesheets that neutralises only `--tw-ring-shadow`, without editing `components/ui`.
  - **Contrast fix carried by review:** semantic badge and stock chips no longer colour the
    label (`text-warn` on `bg-warn/10` was **4.39:1**); the dot or tint carries the colour and
    the label is `text-foreground` (≥14:1).
  - **Verification:** admin build + `check-types` green, desktop **339/339**, packaged-shell
    smoke **38/38**, lint (22 pre-existing/`!important` warnings, exit 0), `brand:check` OK,
    `bun test` shared + API **360/360** + desktop 339/339. `evidence/capture-shell.mjs`
    **16/16** against the real console (groups, single active rail, fascia height/colour,
    skip-link first Tab, 2 px focus outline, print hides chrome, dark persistence with no
    flash, 375 px drawer opens and Escape closes) with
    `shots/plan06-admin-{light,dark}.png` and `plan06-admin-mobile-drawer.png`.
  - **Host note:** `bun run --filter desktop build` fails in Electron Forge's package-manager
    check because Bun 1.3.14 exports `npm_config_user_agent` as `npm/undefined`. Prefixing
    `npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64"` packages cleanly; this is
    environmental and predates the plan.
  - **Deferred to Plan 07:** the enrolled-terminal POS header screenshot (needs enrolment and
    a shift), the full ten-step walkthrough, `scripts/check-tokens.mjs`, and the ROADMAP
    update.

- **Plan 07 complete** (commits `ef5e827`, `b4d429f`, `6581786`, `4b3c160`, `0d39c58`).
  Phase 7 is verified: `phases/07-identity-design-system/01-VERIFICATION.md` maps every
  roadmap success criterion to a command or a recorded step, and `evidence/suites.txt` is the
  whole gate matrix in one transcript.
  - **New gate.** `scripts/check-tokens.mjs` (`bun run tokens:check`, wired into `ci.yml`) is
    the machine version of the phase goal. It fails when either client stops importing
    `@sceptre/brand/tokens.css`, when a brand hex reappears under `admin/src` or
    `desktop/src/renderer` (317 tracked files scanned), when a required custom property is
    missing or a literal colour is not redefined in `.dark`, when a contrast pair misses its
    bound, or when `date-fns` resolves twice. Contrast is computed from the **token file** with
    the WCAG 2.2 relative-luminance formula — the first draft compared literals copied into the
    script and could not fail when a token drifted; `evidence/verify-token-gate.mjs` proves the
    gate can fail, with eleven mutations each asserted to break it and each restored
    byte-for-byte (**22/22**).
  - **Suite numbers.** API **360**, shared **96**, desktop **339**, packaged shell E2E
    **38/38**, chart galleries **61/61** (admin) and **60/60** (POS), admin walkthrough
    **38/38**, POS walkthrough **16/16**. Baseline in the plan was API 354 / shared ≥ 90 /
    desktop 339; every suite meets or exceeds it.
  - **`bun test` is not `bun run test`.** Bun resolves `bun test` to its own builtin runner,
    which ignores the workspace `test` scripts and runs every test file with the wrong setup
    (576 tests, 31 failures here). `AGENTS.md` says `bun test`; it should say `bun run test`.
  - **Three product defects found and fixed.** (a) A `@fontsource` unicode-range subset
    (JetBrains Mono cyrillic) is under Vite's 4 KiB inline threshold, so it shipped as a
    `data:` URI and `font-src 'self'` blocked it — one CSP violation per boot and a fallback
    font; both apps now opt font files out of inlining and the policy was **not** widened.
    (b) The 375 px drawer needed two Escapes: focusing a nav link opened its tooltip, which
    consumed the first Escape; tooltips are suppressed in the drawer. (c) An offline terminal
    read `Downloaded 14:02` instead of Offline because the badge only consulted the uploader;
    a synced-before terminal whose transport is down now reports Offline, with a
    `lastSyncedAt` guard so a first boot does not flash. (d) A statement printed from dark
    mode came out as a slab of ink — dark is a screen mode, not a paper mode — so the one
    token file now resets the palette inside `@media print`, and walkthrough step 5 prints
    from dark mode on purpose to prove it.
  - **Two test defects fixed.** The chart galleries compared the computed transition duration
    to the string `0s` while the reduced-motion policy caps it at `0.01ms` (Chrome serialises
    `1e-05s`); both now parse the duration and fail above 1 ms. The packaged smoke connected
    over CDP as soon as `/json/version` answered, before Chromium exposed a page target, and
    hung for its full timeout; it now waits for a page target.
  - **Deliberate deviations** (all in the report §7): `ci.yml` not `checks.yml`; the emitted
    bundle has **two** `--brand` declarations (`:root` and `.dark`) because D7 fixes the brand
    as unchanged in dark mode — one would require deleting a deliberate token; contrast pairs
    resolve through the token graph; steps 8–9 run the unpackaged build because a packaged app
    sets `allowLocalOrigins: false` by design; the offline leg aborts requests in the driver
    rather than killing a server it does not own; each POS run creates its own terminal so no
    shipped ledger row is deleted to make room for a fixture.
  - **Carry-forwards.** Outbox ordering (a backed-off `SHIFT_OPEN` can be overtaken by a sale,
    which is then dead-lettered `SHIFT_MISSING` — the till never blocked the sale, but causal
    order should be enforced before payments) → **Phase 13**. A first install opens the
    diagnostics shell rather than enrolment, and POS product tiles truncate names → **Phase
    10**. `STAFF_ID_PREFIX` remains `GA` in `.env`; it is not a brand string and changing it
    rewrites identity values, so it is an operator decision.
  - **Re-enrolment consequence unchanged:** the rename moved Electron's `userData` and
    invalidated device tokens, so existing development terminals must re-enrol
    (`desktop/README.md`).

### Phase 8 execution notes (2026-10-24)

- **Goal met:** 14 domain modules exist, every route that owns a body is ≤ 25 lines and imports
  one barrel, and `lib/api-types.ts` is deleted with zero importers. `bun run modules:check:strict`
  is green and is now a CI step.
- **Numbers.** `admin/src/routes` fell from **9,770 to 780 lines** across the same 53 files;
  `lib/api.ts` from 651 to **102** (transport only); 64 domain components moved into modules;
  79 inline `queryKey` sites became module `api/keys.ts` factories. Largest route that owns a body
  is now `login.tsx` at 25 (three exemptions: `__root.tsx`, `dev-charts.tsx`, and the
  authenticated shell layout, each named in the gate with a reason).
- **The gate is the phase's real deliverable.** `scripts/check-modules.mjs` separates hard rules
  (module shape, deep imports, self-aliasing, migrated-route thinness) from progress targets
  (pending modules, unmigrated routes, legacy component imports, `lib/api-types` importers,
  `lib/api.ts` groups). Progress fails only `--strict`, which CI runs — otherwise the gate would
  have been red for the whole phase and a real regression would have hidden in the noise.
  `evidence/verify-module-gate.mjs` proves it can fail **20/20** with twelve mutations restored
  byte-for-byte.
- **Biome finding (carry forward).** `noRestrictedImports` has no importer-aware scope, so the
  boundary rule cannot exempt a module from deep-importing itself. The convention is therefore
  *relative imports inside a module, the barrel across modules*, and the gate enforces the
  self-alias case that Biome cannot. A leading `#` in a pattern is **not** treated as a gitignore
  comment — verified by probe before building on it.
- **Two cycles were designed out, one was caught in review.** `supplier-combobox`,
  `product-picker` and `invoice-status-badge` moved to `components/common` because each is used by
  more than one domain and each would have made a barrel re-export a component into a cycle. The
  loyalty adjust dialog's import of the customers key was caught mid-phase and replaced with the
  literal key. `inventory ↔ payables` and `suppliers ↔ payables` remain two-way **data** edges,
  documented in `admin/src/modules/README.md`.
- **Deviations, all recorded.** Migration order amended from D8 (credit → loyalty → customers,
  because the 470-line customer detail route composes all three; suppliers before payables, which
  are 9 routes and 19 components between them). The dashboard moved from Plan 12 to Plan 03 because
  its staff count was the last reader of the `api.staff` group. No `hooks/` folder in staff: its
  four mutations each close over one component's state, so extracting them would have been a
  rewrite. `modules:check` judges a route by its body rather than by its imports, because Plan 07
  required flipping imports in a route whose body belongs to Plan 09.
- **Verification.** `walkthrough-sections.mjs` **49/49** (25 sections + 8 detail screens + statement,
  then a manager leg that completes the forced password change, proves the branch lock and a
  foreign `branchId`), `capture-shell.mjs` **16/16**, API **360**, shared **96**, desktop **339**,
  `check-types` 6/6, lint clean (24 pre-existing warnings), admin build and desktop package green.
  Report: `phases/08-admin-modules-shell/01-VERIFICATION.md`; transcript: `evidence/suites.txt`.
- **Pre-existing defects found, not fixed (D9):** SSR hydration mismatch on
  `/inventory/transfers/new` (body byte-identical to the pre-Phase-8 route), the shell's branch
  provider requesting `/api/branches` for managers (one 403 per load), `["supplier-balances"]` never
  invalidated after a payment, and client-side money arithmetic in the receipt detail and credit
  ledger.
- **Test-harness note.** `bun run test` produced one 5 s timeout in
  `api/src/modules/sync/sync.test.ts` while a browser suite and the build were running concurrently;
  the file passes 18/18 in isolation and the full suite passes 360/360 alone. Run the suite without
  parallel browser runs.
- **The admin still has no unit tests.** The section walkthrough is the regression net; it lives at
  `admin/test/walkthrough-sections.mjs` and runs as `bun run --filter admin test:walkthrough`, NOT
  as `test`, so root `bun run test` keeps skipping the admin package.

### Operational gap audit (2026-10-24) → Phases 11 and 12

An audit of the built system against parts-manager duties found real deficiencies:

- **No purchase ordering exists.** Stock can only enter by recording a supplier invoice after
  delivery; there is no order, no expected delivery, and no way to see what is coming.
- **Transfers are a self-service pull.** `transfer` starts at `DRAFT` and a manager with
  `inventory.transfer` can create a pull from any branch or warehouse and dispatch it
  themselves. No request, no approval, no oversight.
- **No approval entity exists anywhere.** The only authorisation is the POS PIN override.
- **Replenishment is a single threshold.** `stock_threshold` has no max, no reorder quantity,
  and no lead-time or velocity input; a part the branch has never stocked appears in no list.
- **Purchase returns are impossible.** An invoice can be voided; goods cannot be sent back.
- **Manager catalogue access is admin-only,** so a new part waits for the admin.
- **A manager can edit customer credit limits directly** (`credit.profile.manage`), with no
  second decision.

Operator decisions (locked in `phases/11-…/00-CONTEXT.md` and `phases/12-…/00-CONTEXT.md`):

- Full purchase-order workflow with a **GHS 10,000** default approval threshold per branch.
- Transfers become **request → approve → dispatch → receive**, with source-based authority
  (branch→branch by the source manager, warehouse→branch by the admin).
- Managers may create suppliers, submit products, edit prices within **±10%**, raise POs,
  receive goods, initiate purchase returns, and request write-offs.
- A manager's **product submission creates the product only on admin approval**.
- **Supplier-product links are auto-created on first receipt** with the last cost.
- Replenishment uses **min/max plus velocity and lead-time suggestions**, including parts
  never stocked at the branch.
- One **approval inbox** covers POs, transfer requests, write-offs, price changes, credit
  limit changes, and shift variances; **no self-approval**, in-app notification only.
- Purchase returns settle by **credit note** against payables.
- **Cycle count scheduling** (ABC cadence, generated tasks, trigger counts, accuracy metric)
  added to Phase 12.
- **Gross profit only.** `sale_line.unit_cost_minor` already freezes cost at sale time, so
  margin is historically stable; there is no expense ledger, therefore no net profit or P&L.
- `product.costPriceMinor` becomes **derived and read-only**; `stock_level.avg_cost_minor` is
  the current figure and `sale_line.unit_cost_minor` the historical one.

Phases 7 and 9 are the phases with `NN-PLAN.md` files, and 7 is complete. Phases 11–14 carry
context and a planned-plan list, and get task-level plans when the phase before them
completes. Phase 15 is deliberately context-deferred: its decisions are operator
inputs (domain, VPS sizing, RPO/RTO, backup retention, signing certificate, PowerSync Cloud
instances, monitoring, UAT), listed in `phases/15-production-hardening/00-CONTEXT.md`.

### Phase 13–15 context lock (2026-10-24)

- **Why 13 and 14 were locked late:** context is written when a phase is about to be planned.
  13 and 14 inherit most decisions from earlier phases, so their roadmap entries were
  considered sufficient. That was wrong for 13: the roadmap claimed refunds would use the
  Phase 12 approval queue, which contradicts "cash refunds work offline".
- **Resolved:** refunds are authorised by the Phase 6 manager PIN at the till and work
  offline. A refund at or above `pos.refundApprovalThresholdMinor` (default 20,000 pesewas,
  GHS 200) raises a `REFUND` approval for **retrospective** review when online, or on the next
  sync when authorised offline. Phase 12's approval types now include `REFUND`.
- **Refund restock:** per line and explicit (`RESALABLE`, `DAMAGED` with a write-off reason,
  `NOT_RETURNED`).
- **Failed electronic tender:** the sale stays open with an unpaid balance; the cashier
  retries or switches to cash. A technical fault never creates a receivable.
- **Phase 14 re-scoped:** the executive dashboard and the sales/tax/product reports were
  delivered in Phase 9 and are not rebuilt. Phase 14 owns POS oversight (sales, refunds,
  shifts, terminals, devices) with conflict resolution and server-side receipt reprint, the
  stock/aging/liability reports, supplier Paystack transfers, the E-VAT mock adapter, and
  users/settings/audit. Roles stay the fixed three; no custom roles.
- **Phase 15 stays deferred on purpose:** eight operator inputs are listed in its context;
  nothing in Phases 1–14 depends on them except the one-line domain swap.
- **Counter workflow added to Phase 13** on operator request: held carts (multiple per
  terminal, required label, any cashier recalls, survives a restart, re-prices on recall),
  cart void (reason code, no PIN, uploaded as `CART_VOID`), and split tender that includes
  credit. Phase 13 grows from 9 to 10 plans; `POS-15` and `POS-16` were added and `POS-11`
  amended. Holds are local-only by design; a terminal wipe loses them. Void-rate reporting is
  a Phase 14 oversight addition, not a Phase 9 rewrite.


### Phase 1 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Workspace, tooling, Postgres, shared and db packages | ✅ Complete |
| 02 | API skeleton, configuration, logging, health, first schema | ✅ Complete |
| 03 | Auth, RBAC, organisation APIs, audit, seeds | ✅ Complete |
| 04 | Admin shell, auth flows, CRUD screens, CI, verification | ✅ Complete |

### Phase 2 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared tax engine and pricing helpers | ✅ Complete |
| 02 | Catalog schema, migration, settings, demo seed | ✅ Complete |
| 03 | Catalog module APIs (categories, brands, units) | ✅ Complete |
| 04 | Products module APIs (products, barcodes, prices, search) | ✅ Complete |
| 05 | Console catalog screens and settings extensions | ✅ Complete |
| 06 | Phase 2 verification and state update | ✅ Complete |

### Phase 3 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Inventory schema, migration, settings, and demo seed | ✅ Complete |
| 02 | Inventory core service — ledger, projection, average cost, guards | ✅ Complete |
| 03 | Inventory APIs — receipts, adjustments, stock, history, low stock, thresholds | ✅ Complete |
| 04 | Transfers module — draft, dispatch, receive, short-close | ✅ Complete |
| 05 | Counts module — snapshot, entry, post | ✅ Complete |
| 06 | Console — inventory shell, stock screens, receive, adjust, thresholds | ✅ Complete |
| 07 | Console — transfers and stock count screens | ✅ Complete |
| 08 | Phase 3 verification and state update | ✅ Complete |

### Phase 4 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 4 schema, settings, permissions, phone helper, and demo seed | ✅ Complete |
| 02 | Customers module — identity, search, lifecycle | ✅ Complete |
| 03 | Credit module — profiles, ledger, enforcement, repayments, aging, statements | ✅ Complete |
| 04 | Loyalty module — account, ledger, lots, FEFO, expiry engine | ✅ Complete |
| 05 | pg-boss jobs infrastructure and the loyalty expiry schedule | ✅ Complete |
| 06 | Console — customers, credit ledger, repayments, statements, aging | ✅ Complete |
| 07 | Console — loyalty history, liability report, and settings | ✅ Complete |
| 08 | Phase 4 verification and state update | ✅ Complete |

### Phase 5 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 5 schema, receipt link, settings, permissions, and demo seed | ✅ Complete |
| 02 | Suppliers module — master, payment details, supplied products, last cost | ✅ Complete |
| 03 | Payables module — invoices from receipts and standalone, totals, voids | ✅ Complete |
| 04 | Payments, allocations, voids, balances, aging, and reconciliation | ✅ Complete |
| 05 | Console — suppliers section, payment details, supplied products | ✅ Complete |
| 06 | Console — invoices, payments, aging, and goods-receipt linking | ✅ Complete |
| 07 | Phase 5 verification and state update | ✅ Complete |

### Phase 6 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 6 schema, shared cart math, settings, permissions, and demo seed | ✅ Complete |
| 02 | Desktop shell, Electron security, keychain, and PowerSync spike | ✅ Complete |
| 03 | Device auth, PowerSync sync config, local schema, and connector | ✅ Complete |
| 04 | Offline PIN, device bindings, shifts, and console PIN reset | ✅ Complete |
| 05 | Server sale application, upload endpoint, conflicts, and reconciliation | ✅ Complete |
| 06 | POS selling UI — catalog, cart, customers, credit, loyalty, discounts | ✅ Complete |
| 07 | Sale completion, receipts, ESC/POS printing, and cash drawer | ✅ Complete |
| 08 | Outbox uploader, retries, sync status, and conflict surfacing | ✅ Complete |
| 09 | Phase 6 verification and state update | ✅ Complete |

### Phase 6 execution notes

- **Plan 01 complete** (commits `58c63ec`, `e0caf52`, `d0bd35a`, `c78a439`, `74082d0`):
  - Migration `0007_common_next_avengers.sql` adds `shift`, `sale`, `sale_line`,
    `sale_tender`, `cash_movement`, `pos_sync_transaction`, `sync_conflict`, and
    `pos_staff_binding`, with the one-open-shift and active-binding partial uniques and the
    terminal/client idempotency uniques; `stock_movement` now accepts `SALE`.
  - `@sceptre/shared` exports `allocateProportionally` and `priceCart` (integer
    largest-remainder allocation, line/sale/loyalty discounts, per-line Ghana tax); 20 new
    tests, 70 shared tests pass.
  - Eight `pos.*` settings and the `staff.pin.reset` / `pos.discount` permissions.
  - Demo seed: device `seed-ACC-SPX-T01`, cashier PIN `2468`, closed shift
    `ACC-SPX-T01-S-20261020-01` (float 20000, expected/counted 42500, variance 0), cash sale
    `…0001` (22500, change 7500), credit sale `…0002` (18500, Akosua balance 24500), and one
    RESOLVED `PRICE_MISMATCH` conflict. Re-running `db:seed --demo` is a no-op.
  - Verification: fresh `sceptre_drive_test` schema → migrate → **API 277/277**, shared 70/70,
    lint and check-types green; demo seed run twice on `sceptre_drive_dev` with unchanged counts.
  - Test DB note: the seed suite now cleans POS sales/shift/device/conflict before its
    fixtures; reset `public` **and** `drizzle` schemas (not just `public`) when rebuilding
    `sceptre_drive_test`, or Drizzle will believe the migrations already ran.
- **Plan 02 complete** (commits `4dec559`, `98d0395`, `23e24a7`, `4231a34`):
  - `desktop/` is a Bun workspace on Electron Forge 8.0.1 + Vite 8.3.5 + React 19.2;
    `bun run dev:pos|build:pos|package:pos|make:pos` at the root, and root
    `lint`/`check-types`/`test`/`build` cover it. `bun run build` now also packages the
    Linux app; `make:pos` produces a Squirrel installer on Windows and a ZIP elsewhere.
  - **Linker decision:** the repo now installs with Bun's **hoisted** linker
    (`bunfig.toml`) because Forge crawls `desktop/node_modules` and does not follow
    symlinks, and Bun 1.3.14 does not implement `workspaces.selfContained` /
    `installConfig.hoistingLimits` for the hoisted linker. `desktop/scripts/prepare-desktop.mjs`
    links `electron` into the workspace and will materialise native runtime modules as
    real files (Plan 07). API/shared suites and the admin build stay green under it.
  - **Origin + CSP:** production loads `app://sceptre-drive/index.html` via
    `protocol.handle` (privileged standard scheme, no `file://`); the CSP
    (`src/main/csp.ts`) is sent as a header *and* injected into `index.html` as a meta
    fallback, and is built from config origins that are checked against a fixed
    allowlist. Verified: no Node in the renderer, `window.open`/remote navigation denied,
    all permissions refused, fuses block `--inspect`, no CSP violations.
  - **Keychain:** async `safeStorage` only, `userData/secrets.json` at mode `0600`,
    ciphertext-only, no plaintext fallback (`KEYCHAIN_UNAVAILABLE` when unavailable),
    key-rotation re-encrypt, typed preload surface (`app.getInfo`, `secure.get/set/delete`)
    with Zod-validated inputs and sender checks. This host reports Linux
    `basic_text` → `secureStorage.level: 'basic'`; Windows DPAPI reports `os`.
  - **PowerSync gate: PASSED** — encrypted WASM SQLite (ChaCha20) runs in the sandboxed
    renderer with `wasm-unsafe-eval`/`worker-src` allowance, local-only tables write,
    `watch()` fires, close/reopen works, and data survives a packaged-app restart
    (run #1 → #2). Both `IDBBatchAtomicVFS` and `OPFSCoopSyncVFS` work; **OPFS is chosen**
    with IDB as the fallback. Evidence:
    `evidence/powersync-spike.md` + `.json` + `.png`.
  - **Findings to carry into Plan 03:** always pass an explicit `vfs` (the SDK's VFS
    resolver has no default branch and throws `resolveVfs is not a function`), build the
    adapter with `WASQLiteOpenFactory`, set `enableMultiTabs: false`, and point
    `worker` at the SDK's copied `@powersync/worker.js`.
  - **A hidden-window trap:** a `show: false` window that loads from `app://` never paints,
    so `ready-to-show` never fires and the app is invisible. `windows.ts` now also shows on
    `did-finish-load` and after a 3 s fallback.
- **Plan 03 complete** (commits `b3f671e`, `5b4999b`, `4aa1fb2`, `bfe2a0f`, `4fc59c9`, `3277930`):
  - **POS JWT + JWKS:** Ed25519 (`jose`); `POS_JWT_PRIVATE_KEY` required in production
    (boot fails without it), ephemeral + warn in dev/test. `/.well-known/jwks.json` (and an
    `/api/...` alias) serves the public JWK only. Device JWTs (`aud=sceptre-pos`,
    `typ=device`, 15 min) and PowerSync JWTs (`aud=POWERSYNC_AUDIENCE`) share the key;
    `verifyDeviceJwt` collapses every failure into 401 `DEVICE_TOKEN_INVALID`.
  - **Enrollment → device token:** `POST /api/enrollments/redeem` now issues a 32-byte
    token once (201) and stores only `HMAC-SHA256(token)`; the row is locked `FOR UPDATE`
    so one code cannot be redeemed twice. Guards: code used/expired (400), terminal
    inactive (409), warehouse branch (409), branch inactive (409). Audits
    `terminal.enrollment.redeemed` and `device.token.issued` with no token material.
  - **Device session:** `POST /api/pos/session` (Bearer device token, rate limited)
    returns the terminal/branch identity, a device JWT, and the config snapshot (tax mode,
    loyalty rates, all `pos.*` policy, receipt header/footer, `Africa/Accra`, server time);
    it doubles as the refresh path. `POST /api/pos/powersync/token` (device JWT) returns
    `{endpoint, token, expiresAt}` or 503 `POWERSYNC_NOT_CONFIGURED`. `requireDeviceJwt`
    re-reads the device/terminal/branch on every call and fails closed (403 revoked /
    inactive / warehouse, 401 stale claims).
  - **Self-hosted service:** `compose.yaml` gains `journeyapps/powersync-service:1.27.1`
    under `profiles: ["sync"]` (unified mode, port 8080, Postgres bucket storage,
    `extra_hosts` for the JWKS); `powersync/init/powersync.sql` creates `powersync_role`,
    the `sceptre_drive_powersync` storage database, and a `powersync` publication scoped to the
    8 synced tables. `sync-config.yaml` (edition 3) streams products/barcodes globally and
    prices/stock/credit by `auth.parameter('branch_id')`, plus customers and live loyalty
    lots. Root scripts `sync:init|up|down|logs|config-check`.
  - **Local client:** `lib/powersync/schema.ts` declares the 8 synced tables plus 15
    local-only tables (config, session, staff binding, shift, sale/line/tender, cash
    movement, customer draft, outbox, three delta tables, document sequence, local
    conflicts); `database.ts` opens one encrypted OPFS database (`WASQLiteOpenFactory`,
    `enableMultiTabs: false`, SDK worker) with the keychain key; `connector.ts` implements
    only `fetchCredentials` (`uploadData` throws by design); `provider.tsx` + `status.ts`
    expose live sync status; `lib/api/client.ts` adds the bearer client with a single 401
    refresh, typed 403 `DeviceRevokedError`, timeouts and no cookie use.
  - **Dev diagnostics:** `#dev/sync` shows per-table counts, the local terminal config and
    live status with offline/reconnect controls; `#pos` shows the minimal shell plus an
    enrolment/revoked banner.
  - Verification: `walkthrough-sync.mjs` **24/24** (redeem once, hash-only storage, config
    snapshot free of credentials, JWT claims, service accepts our token / rejects a bogus
    one, revocation blocks both endpoints); `test:sync` **18/18** (all 8 tables equal the
    server counts, `hasSynced=true`, offline readable, reconnect, encrypted file header).
    API 305/305, desktop 60/60, lint/check-types green.
  - Findings recorded: `app://sceptre-drive` must be in `CORS_ORIGINS`; the CSP `<meta>`
    fallback must be a superset of the header (browsers intersect); `allowLocalOrigins`
    replaces `isDev` for localhost policy; the container-to-host firewall path is bypassed
    by generating a service config with the public key inlined; the Docker host port is now
    `POSTGRES_PORT` (5433 was taken locally).

  - Verification: fresh `bun install`, `bun run lint`, `bun run check-types` (5/5),
    `bun run build` (admin + desktop package), API 277/277, shared 70/70,
    desktop 51/51; `test:e2e` 35/35; `test:spike` 8/8; `.github/workflows/desktop.yml`
    passes actionlint (Windows installer job is `workflow_dispatch` until a remote exists).
- **Plan 04 complete** (commits `4f89d3b`, `83c85fa`, `b4b8097`, `6064ea3` + the state
  update):
  - **Shared PIN policy** (`packages/shared/src/pin.ts`): 4–6 digits, rejects repeated
    digits and straight sequences; used by the API, the console, and the terminal.
  - **Console PIN reset:** `POST /api/staff/:id/pin` (Argon2id, `pinVersion++`,
    `pinMustChange=true`, revoke every live binding, audit `staff.pin.reset` without the
    PIN) and `GET /api/staff/:id/pin-status` (`hasPin`, version, must-change, live
    bindings). Managers may reset only cashiers in their branch; admins anyone. The staff
    list carries `pinVersion`/`pinMustChange` so the badge needs no N+1 fetch. Role,
    branch, and deactivation changes bump the version and revoke bindings. Migration
    `0008_parallel_marvel_apes.sql` adds `user.pin_must_change`.
  - **Device bindings** (`pos.repository.ts` / `pos.service.ts`): `POST
    /api/pos/staff/authorize` (device JWT, 10/min/device) resolves staff by code or email,
    verifies the PIN, replaces the one active binding, stores only
    `HMAC-SHA256(bindingToken)` with a 90-day expiry, and returns the token once.
    `POST /api/pos/staff/change-pin` verifies `x-pos-binding`, sets the new PIN, bumps the
    version, revokes every binding, issues a fresh one for this terminal, and audits
    `staff.pin.changed`. `POST /api/pos/staff/binding/validate` answers 200 with
    `valid:false` for dead bindings (PIN version, role, branch, device, expiry, active
    staff). Every failure is the same 401 `PIN_INVALID` plus an audit row without the PIN.
  - **Desktop auth:** async Argon2id in the **main process** (`pin.hash`/`pin.verify`,
    `@node-rs/argon2` with the device salt as the Argon2 pepper), exposed as two typed IPC
    methods. `staff_binding` gained `binding_id`, `binding_token`, `expires_at`, and
    `pin_must_change` (additive local-only columns). `bindings.ts` activates online, stores
    the verifier, counts failures per binding, locks for `pos.pinLockMinutes`, and unlocks
    with an independent manager/admin binding. The staff session is **in memory only**.
    Bundled `#login` route: enrolment code screen when the device has no credential,
    activation, PIN pad, forced PIN change after a temporary PIN, and manager unlock.
  - **Shifts:** local `openShift`/`recordCashMovement`/`closeShift` write the fact and its
    outbox row in one `writeTransaction`; numbering is
    `${terminal.code}-S-${YYYYMMDD}-${NN}` from `document_sequence`; expected =
    float + cash tenders − change + cash in − cash out. The server functions
    (`openShift`, `recordCashMovement`, `closeShift`) lock the terminal/shift, enforce
    one-open-per-terminal, recompute the server expected cash, store both expected values
    and the variance, and raise `SHIFT_VARIANCE_MISMATCH` without blocking the close.
    `#shift` renders the float/expected cards, cash in/out, and a close dialog with a live
    green/red variance.
  - **Packaging:** the Forge Vite plugin ignores everything outside `/.vite`, so
    `forge.config.mts` gained a `packageAfterPrune` hook that copies
    `desktop/node_modules/@node-rs` (wrapper + host platform package, materialised by
    `prepare-desktop.mjs`) into the package; `auto-unpack-natives` then extracts both
    `.node` binaries. Verified in the packaged app.
  - **Verification:** API 325/325 (new: 5 staff-PIN, 7 device-binding, 8 shift cases),
    shared 73/73, desktop 74/74 (lockout, PIN crypto, money/shift math, IPC bridge),
    lint + check-types (5/5) + admin build green, `bun run build:pos` packages,
    `evidence/smoke-pin-ui.mjs` **5/5** against the packaged binary (login route renders,
    Argon2 hash/verify over real IPC, verifier never contains the PIN), and
    `evidence/smoke-console-pin.mjs` **8/8** against the real console (forced TOTP
    bootstrap, trivial PIN rejected inline, temporary PIN set, badge flips to
    `Temporary`, no hash in any staff payload, pin-status agrees). Screenshots under
    `evidence/shots/`. The full enrolled-device E2E (authorize → change → relaunch
    offline → shift → upload) stays the Plan 09 gate because it needs the API and
    PowerSync service.
- **Plan 05 complete** (commit `f439dba` + the state update):
  - **Idempotent upload:** `POST /api/pos/sync/upload` (device JWT, 60/min/device,
    1–50 transactions) validates a discriminated union per type and verifies the body's
    `deviceId`/`terminalId` against the JWT (403). Each transaction opens one DB
    transaction, reserves `pos_sync_transaction` with
    `INSERT … ON CONFLICT (terminal_id, client_transaction_id) DO NOTHING RETURNING`,
    replays a stored result as `REPLAYED` (no side effects), and finalises `APPLIED` with
    the result JSON. A 4xx `AppError` rolls the domain work back and writes a committed
    `REJECTED` reservation in a second transaction (with an `UNKNOWN_PRODUCT` conflict
    that cannot reference the rolled-back sale, so the client transaction id is in
    details). Unexpected errors stay 5xx with no reservation. Responses are always 200
    for business outcomes.
  - **Atomic sale application** (`applySale`): validates the binding (stale →
    `STALE_CREDENTIALS`, sale applies), the open shift on this device, the catalogue in
    one query, the charged price vs `resolveEffectivePrice` (`PRICE_MISMATCH`, charged
    price kept), resolves the offline customer draft (link by id/phone, insert with the
    client UUID + loyalty bootstrap, `DUPLICATE_CUSTOMER`/`INVALID_CUSTOMER`), prices with
    the shared `priceCart` at the server tax mode, compares the header
    (`TOTAL_MISMATCH` when internally consistent, `INVALID_TOTALS` rejection otherwise),
    validates single tender/change arithmetic, posts `SALE` stock movements with
    `allowNegative` + `STOCK_OVERSELL`, posts the credit charge (`CREDIT_OVER_LIMIT` /
    `CREDIT_HOLD`, ledger always records the debt), posts redemption/earn (`LOYALTY_NEGATIVE`,
    `LOYALTY_RATE_CHANGED`), checks the discount cap (`OVERRIDE_INVALID`),
    flags `CLOCK_SKEW`, then writes the sale/lines/tenders, conflicts, and audits.
  - **Ledger transaction seams:** `credit.service.postEntryInTransaction` and
    `loyalty.service.postEntryInTransaction` run inside the caller's tx (the public
    `postEntry` wraps them). `PostEntryInput.bypassPolicy` and
    `LoyaltyPostEntryInput.bypassBalanceCheck` are internal-only; `CreditTxContext.overrideActor`
    records the validated approver on the entry and the `credit.override` audit. Customer
    draft resolution lives in `customers.service.resolveDraftCustomer`.
  - **Conflict reads:** `GET /api/pos/sync/conflicts?since&limit` (own terminal only,
    receipt/shift numbers joined, ids/amounts only) and `GET /api/pos/sync/state`
    (`pendingConflicts`, `lastSaleAt`, `serverTime`, `configVersion` = latest settings
    update).
  - **Reconciliation:** `reconcileSales(branchId?)` proves header = lines (subtotal,
    discounts, VAT/NHIL/GETFund/tax, total), tenders = total + change, credit = one
    CHARGE entry with the receipt reference, loyalty = one REDEEM entry, and one `SALE`
    movement per product with the receipt number. `reconcileShifts(branchId?)` proves
    expected cash/variance and OPEN/CLOSED field consistency plus one open shift per
    terminal. `GET /api/pos/reconciliation` (`inventory.read`, admin all / manager own
    branch) is read-only and never repairs.
  - **Verification:** API **350/350** (new: 16 sale, 8 upload, 2 reconciliation, plus the
    shift suite), lint/check-types green. No migration was needed.


---

## Repository State

- Fresh git history on `dev`; planning + Phase 1 committed. **No git remote exists yet.**
- Root Bun workspace with catalogs; `@sceptre/shared` (roles, permissions, branch
  codes) and `@sceptre/db` (Drizzle client, config, migrations).
- API boots on Node 24 with native TypeScript type stripping: `bun run dev:api`.
  Validated env, pino logs, request IDs, security headers, CORS, `/health`, `/ready`.
- PostgreSQL: the **Docker stack** (`sceptre-drive-dev`, host `:5434`) since the Phase 7
  rename: `sceptre_drive` is the dev database and `sceptre_drive_test` the test database
  (created by `compose.yaml` and `bun run db:test:prepare`). The operator's local instance on
  `:5432` still holds the pre-rename databases and the **discarded prototype schema**
  (PascalCase tables); v1 does not use it. `compose.yaml` sets `wal_level=logical` and 10
  replication slots for PowerSync. Migrations need an explicit `DATABASE_URL`; tests honour
  `TEST_DATABASE_URL`.
- API serves auth (public sign-up blocked), branches, terminals, enrollment, devices,
  staff, `/api/me/password`, audit (with `actorId` + `actorStaffId` filters), settings.
  Middleware: session loading (cookie cache bypassed for authorization), permission
  checks, fresh-session gate, branch scoping, rate limiting.
- Admin console (`admin/`, TanStack Start 1.169 + React 19 + Tailwind v4 + shadcn
  Radix/new-york): login/forgot/reset/2FA pages, forced password change, forced TOTP for
  admins, permission-aware shell with branch switcher, and CRUD screens for branches,
  terminals (enrollment + devices), staff (temp passwords, resets), audit (diff viewer),
  and settings. Dense neutral design (system font stack, zinc tokens).
- Dev email: file provider writes to `api/.mail/` in development (gitignored); console
  provider elsewhere; Resend when `RESEND_API_KEY` is set.
- Tests: `bun run test` — shared 73/73, api 360/360, desktop 339/339 against
  `sceptre_drive_test` (`TEST_DATABASE_URL`; migrate it first). The suite loads the repo-root
  `.env` itself, so a plain `bun run test` from the root works.
- CI: `.github/workflows/ci.yml` (checkout@v7, setup-bun@v2, Postgres 18 service, lint →
  brand:check → check-types → migrate → test → build). Validated with actionlint; full
  sequence run locally. **Remote run pending a git remote.** `desktop/` builds and packages
  as part of that job; `.github/workflows/desktop.yml` adds the manual Windows-installer job
  and the
  Linux E2E/PowerSync jobs (also pending the remote).
- `.planning/phases/01-foundation/01-VERIFICATION.md` records all evidence, deviations,
  and the human verification checklist.

### Phase 2 additions

- `@sceptre/shared` now exports the Ghana tax engine (`taxBreakdown`, basis-point rates,
  `addTaxBreakdowns`) and pricing helpers (`resolveEffectivePrice`, `isValidPriceMinor`) —
  integer-only, reused by API, console preview, and (Phase 6) the offline POS.
- Catalog module (`api/src/modules/catalog`): categories (two-level tree, depth/self-parent/
  duplicate guards, guarded archive/reactivate), brands, units (uppercase codes, immutable).
- Products module (`api/src/modules/products`): create with atomic SKU allocation,
  suggest-sku peek, update/archive, barcode add/remove, branch price overrides,
  trigram-backed search with branch-aware effective pricing.
- Migration `0002_fresh_shen.sql` creates `pg_trgm` and the `product_name_trgm_idx` GIN
  index; `db:seed --demo` seeds a browsable catalog idempotently (12 products, 14 barcodes).
- Console: Catalog section (Products/Categories/Brands/Units tabs), product editor with
  live tax preview and per-branch override panel, catalog settings (SKU, tax mode) in
  Settings. `formatGhs`/`parseGhsToMinor`/`formatMinorPlain` in `admin/src/lib/format.ts`.
- Verification: fresh-DB cycle, API walkthrough 31/31, real browser (Playwright)
  walkthrough 29/29 with screenshots and scripts under
  `.planning/phases/02-catalog-pricing/evidence/`.

### Phase 3 additions

- `@sceptre/shared` exports `averageCostAfterReceipt` (integer weighted average,
  half-up) used by the API and the demo seed.
- Inventory module (`api/src/modules/inventory`): append-only `stock_movement` ledger +
  `stock_level` projection, receipts (`stock_receipt`, `stock_receipt_line`),
  adjustments, per-branch thresholds, stock/history/low-stock reads; one posting
  service with sorted per-product locks (`lockOrCreateLevel`) enforcing the non-negative
  guard (409).
- Transfers module (`api/src/modules/transfers`): draft → dispatch → receive →
  short-close with source/destination on-hand context, cost carry to the destination,
  side-scoped authority, direction-filtered list reads.
- Counts module (`api/src/modules/counts`): snapshot at open, entry, post (variance
  movements only), cancel; negative-guard 409 names the offending products.
- Guards: product archive blocked while any branch holds stock; warehouses cannot host
  POS terminals.
- Sequences/settings: `GRN-#####`, `TRF-#####`, `CNT-#####`; demo seed adds opening
  stock (GRN-00001 @ ACC-WH1, GRN-00002 @ ACC-SPX) and thresholds GIK-00007=5 /
  GIK-00011=10 at ACC-SPX, idempotently.
- Console: Inventory section (Stock / Transfers / Counts tabs) — stock list with
  search + low filter, product detail with movement history, receive / adjust /
  threshold dialogs, transfer detail (dispatch / receive / short-close), count
  entry/posting; permission-aware actions.
- Verification: fresh-DB cycle (demo seed ×2 idempotent), HTTP + SQL walkthrough 92/92
  (ledger invariant SQL, audit rows, permission matrix, warehouse + archive guards),
  browser walkthroughs 15/15 + 6/6; scripts and screenshots under
  `.planning/phases/03-inventory-transfers/evidence/`.

### Phase 4 additions

- Schema (migration `0004_cute_namor.sql`): `customer` (global identity, partial unique
  phone index `WHERE anonymized_at IS NULL`), `credit_profile` + append-only
  `credit_ledger_entry`, `loyalty_account` + append-only `loyalty_ledger_entry` +
  `loyalty_lot` + `loyalty_lot_consumption`; `pg_trgm` indexes on customer name/phone.
- Settings: `loyalty.minimumRedeemPoints`, `credit.repaymentPrefix` (REP),
  `credit.repaymentSequence` (REP-#####); `loyalty.earnPointsPerCedi` is integer-only.
- Permissions: `customer.read/create/update/archive/anonymize`,
  `credit.read/profile.manage/repayment/adjust/override`, `loyalty.read/adjust/settings`
  (archive, anonymize, and loyalty settings are admin-only) plus
  `packages/shared/src/phone.ts` (`normalizeGhanaPhone` / `formatGhanaPhone`).
- Demo seed: 3 customers at ACC-SPX — Akosua (credit limit GHS 500, opening CHARGE
  GHS 120, sequenced REP repayment GHS 60 → balance GHS 60), Kwame (250 points, 12-month
  lot), Efua (plain).
- Customers module (`api/src/modules/customers`): search by phone digit-suffix or name
  ILIKE (trigram-backed), `page`/`pageSize`, archived hidden unless admin
  `includeArchived`, `branchId` admin filter; create normalizes the phone, dedupes (409
  with the existing id), and bootstraps the loyalty account in the same transaction;
  archive/reactivate/anonymize are audited; anonymize requires zero credit balances and
  zero loyalty points, scrubs PII in place, and releases the phone.
- Credit module (`api/src/modules/credit`): one write path `postEntry` — locks the
  customer+branch profile `FOR UPDATE` (upsert-then-lock, Phase 3 D16 pattern), applies
  kind rules (CHARGE positive with reason; REPAYMENT/REFUND negative; ADJUSTMENT signed;
  method required for repayments), enforces hold (409) and limit (`balance + amount >
  limit` → 409 unless a `credit.override`-permitted user records `overrideReason` /
  `overriddenBy`), allocates `REP-#####`, writes the append-only entry, projects
  `balanceMinor = balance + amount`, and audits (`credit.charge/repayment/refund/
  adjustment`, plus a second `credit.override` row when applied). Idempotent per
  `(branchId, idempotencyKey)` — pre-check plus unique-violation replay inside the
  transaction (parallel same-key race returns one row).
- Credit reads: `listProfiles` / `listEntries` (branches resolved via
  `resolveBranchFilter`), pure `settleCharges` (oldest-first application of negative
  entries to charges, exposing unapplied overpayment) used by `getAging` (fixed buckets
  Current / 1–30 / 31–60 / 61–90 / 90+ from the due date; only non-zero outstanding;
  branch totals = sum of customer rows; admin sees every branch separately) and
  `getStatement` (opening = sum before `from`; ranged entries; closing = opening +
  ranged, reconciling to `balanceMinor`; aging snapshot as of `to`; 404 without a
  profile; admins must name `branchId`). Console printing is Plan 06.
- Repayment API accepts positive amounts (`POST /api/credit/repayments`) and stores them
  negative; charges/refunds/adjustments post through `POST /api/credit/entries` — two
  routes so kind-dependent permission middleware (`credit.repayment` vs `credit.adjust`)
  stays at the edge, with the override re-checked fail-closed in the service.
- Routes: `GET/PUT /api/credit/profiles(/:customerId)`, `POST /api/credit/repayments`,
  `POST/GET /api/credit/entries`, `GET /api/credit/aging`,
  `GET /api/credit/statements/:customerId` wired in `app.ts`.
- Loyalty module (`api/src/modules/loyalty`): one write path `postEntry` — locks the
  global account `FOR UPDATE` (upsert-then-lock, D16), computes EARN points
  `floor(netPaidMinor × loyalty.earnPointsPerCedi / 100)` (floor per sale, no carry —
  a sale below one point writes nothing), requires REDEEM ≥ `loyalty.minimumRedeemPoints`
  and ≤ balance (409 otherwise), stores redemptions/clawbacks negative, consumes live lots
  earliest-expiry-first with per-lot `loyalty_lot_consumption` rows (lots locked
  `FOR UPDATE` ordered `(expiresAt, earnEntryId)`), creates a lot for every positive
  posting (`expiresAt = occurredAt + loyalty.expiryMonths`), allows clawback shortfall as
  a negative balance with lots clamped at zero, projects the balance, audits
  (`loyalty.earned/redeemed/clawback/adjusted`), and replays idempotently per
  `(branchId, idempotencyKey)` — pre-check plus unique-violation replay. `expireDueLots(now)`
  expires per account in one transaction (single global EXPIRE entry with
  `branchId`/`createdBy` null plus consumption rows) and no-ops on a second run; audit
  `loyalty.expiry_run`.
- Loyalty reads: `getAccountDetail` (global — one balance across branches; account
  bootstrapped if missing) and `getLiability` (outstanding points + GHS value at the
  current rate, per-branch activity totals for the range, negative balances — managers
  scoped to their own branch activity plus their customers, admins to all), plus read-only
  `reconcileAccounts` proving `balance = Σ deltas` and
  `lots remaining = Σ positive deltas − Σ consumed` across every account.
- Loyalty routes: `GET /api/loyalty/accounts/:customerId` (`loyalty.read`),
  `POST /api/loyalty/entries` (`loyalty.adjust` — the staff path Phase 6/7 POS flows
  reuse), `GET /api/loyalty/liability` (`loyalty.read`) wired in `app.ts`; redeem quote
  250 pts = GHS 2.50 (250 pesewas) at the 100 pts/GHS default.
- Jobs (`api/src/jobs/`): pg-boss 12 against the API database (own `pgboss` schema,
  installed on first boot with start retries). Started after the HTTP server with
  pino-bridged `error`/`warning` events; `loyalty-expiry` worker calls `expireDueLots()`
  and logs the `{ accounts, lots, points }` summary; schedule `5 0 * * *` in
  `Africa/Accra` with `missed: 'once'` catch-up; graceful shutdown stops jobs first
  (5s grace) then closes the pool. `POST /api/loyalty/expiry-run` (admin-only,
  `loyalty.settings`) runs the same seam synchronously, returns the summary, and the
  engine writes one `loyalty.expiry_run` audit row per run.
- Console (Plan 06, `admin/src/components/customers/`): Customers section — list with
  search + archived toggle, create/edit dialogs; profile with Overview / Credit / Ledger
  tabs; credit settings, repayment (REP toast, received-by from the session), and entry
  dialogs (kind-specific reason sets, live headroom hint, 409-driven override block
  re-submitted as `override: { reasonCode, note }`); printable A4 statement rendering the
  exact API payload (`statement-view.tsx`); aging tab (manager's branch fixed, admin
  all-branches or one, as-of date, zero buckets muted); archive/reactivate/anonymize with
  a live zero-balance checklist and server 409s surfaced readably. Money dialogs keep one
  idempotency key per form session (kept on network failure, cleared on any API response).
- Console (Plan 07): loyalty tab on the customer profile (`loyalty-card.tsx`,
  `loyalty-adjust-dialog.tsx`, `loyalty-history-table.tsx`) — global balance with implied
  GHS value at the current rate, expiring-soon total, live lots with FEFO order and
  "in N days" hints, full history (kind badges, signed points, reason, branch, reference);
  adjust dialog (Earn from amount paid / Redeem with quoted value and minimum hint /
  Clawback pinned to RETURN with negative-balance warning / Adjust with reason) whose
  server 409s (minimum, insufficient balance) surface inline; liability page
  (`routes/_authenticated/loyalty.tsx`, `liability-report.tsx`, sidebar `Gift`) — headline
  cards (outstanding, GHS liability, expiring in 30 days), per-branch activity table with
  net check, negative-balance review list linking to profiles; Settings Loyalty/Credit
  groups (minimum redemption, repayment prefix/sequence; earn rate now integer-only).
  The liability API gained `expiringSoonPoints` (remaining live lots expiring within 30
  days).
- Verification: fresh-DB cycle (volume reset → migrate → seed → demo seed; TOTP
  re-bootstrapped), HTTP + SQL walkthrough **154/154** (FIFO reconstruction, statement and
  aging arithmetic incl. an as-of date, FEFO consumption rows, expiry job + idempotent
  second run, liability + activity, branch scoping 403s, anonymization guards, credit and
  loyalty reconciliation SQL, audit coverage), browser walkthrough **29/29** with
  screenshots; scripts and evidence under
  `.planning/phases/04-customers-credit/evidence/`, verification record in
  `01-VERIFICATION.md`.

---

### Phase 5 additions

- Schema (migrations `0005_peaceful_synch.sql` for suppliers, `0006_calm_swarm.sql` for
  payables + `stock_receipt.supplier_id`): `supplier` (global master, `SUP-#####`,
  ACTIVE/ARCHIVED, trigram name index), `supplier_payment_detail` (BANK/MOMO, one active
  default per supplier via partial unique index, nullable `paystack_recipient_code`),
  `supplier_product` (unique supplier+product, one preferred supplier per product),
  `supplier_invoice` (+ lines; status OPEN/PARTIAL/PAID/VOID; supplier number unique per
  supplier+branch among non-VOID; one invoice per receipt; branch idempotency key),
  `supplier_payment` (+ append-only `supplier_payment_allocation`: positive APPLY, negative
  RELEASE with `reverses_allocation_id`; branch idempotency key).
- Settings: `supplier.codePrefix`/`codeSequence`, `payable.invoicePrefix`/`invoiceSequence`,
  `payable.paymentPrefix`/`paymentSequence` (defaults SUP/SINV/PAY, pad 5, allocated via
  `allocateFromSequence`).
- Permissions: `supplier.read` (admin+manager) and admin-only `supplier.create/update/
  archive`; `payable.read/invoice.manage/payment/void` (admin all; manager branch-scoped);
  cashier none.
- Demo seed: SUP-00001 Accra Parts Depot (bank + MoMo default), SUP-00002 Sceptre Drive Imports
  (MoMo); receipt links for GRN-00001/00002; four product mappings with last costs;
  `SINV-00001` from GRN-00002 with the derived split and a 40% `PAY-00001`; standalone
  freight `SINV-00002`; `PAY-00002` on account; sequences advanced to 3. Fully idempotent.
- Suppliers module (`api/src/modules/suppliers`): search by name fragment/code (archived
  hidden unless admin), create allocates `SUP-#####` and normalises the phone, archive
  blocked while owed ≠ 0 (409 names the amount), reactivate, payment details with
  default-switch/deactivate semantics and masked account numbers, product mappings with the
  joined product view, and `recordInvoiceCosts` refreshing `last_cost` from invoice lines.
- Payables module (`api/src/modules/payables`): `createInvoice` (receipt copy or standalone
  lines; omitted tax ⇒ `taxBreakdown(STANDARD, INCLUSIVE)` so the total equals the entered
  tax-inclusive costs; provided tax ⇒ net lines + manual split; server-recomputed totals;
  supplier row locked; idempotency replay checked before unique-violation mapping; one
  invoice per receipt), `voidInvoice` (only at zero net allocation), `createPayment`
  (dedupe allocations, Σ ≤ amount, outstanding/supplier/VOID/branch guards, sorted invoice
  locks, on-account remainder, status recompute), `voidPayment` (RELEASE rows + invoice
  flips + audit), payment reads with allocated/on-account totals, `getAging` (fixed buckets,
  as-of, on-account separate), `listSupplierBalances` (outstanding − remainder per supplier),
  and `reconcilePayables()` (invoice paid = signed allocations, status derivation, VOID at
  zero, owed = independent `sumSupplierOwed`).
- Routes: `/api/suppliers…` (list, create, get, patch, archive, reactivate, payment details,
  products) and `/api/payables…` (invoices list/create/get/void, payments list/create/get/
  void, balances, aging), wired in `app.ts`.
- Console: Suppliers section (Truck icon) with Suppliers / Invoices / Payments / Aging tabs;
  supplier list + form dialog, detail (overview, payment details with default/deactivate,
  supplied products with last cost); invoice list with filters and overdue tint, invoice
  form (receipt picker, product/free-text lines, derived/zero/manual tax panel, live totals,
  idempotency key) and detail (lines, tax split, linked receipt, allocations, record payment,
  void); payment list/form (allocation editor with oldest-first and on-account remainder),
  payment detail and void dialog with release preview; aging page with summary cards and
  totals row; supplier list owed column fed by balances. Inventory gains the Receipts tab,
  receipt detail with "Record supplier invoice", and a supplier picker (free-text fallback)
  in the receive dialog. Settings shows the Suppliers & Payables group.
- Verification follow-ups committed during the phase: `ca41b50` payment list rows carry
  supplier/branch names; `9bd652a` product mapping mutations return the joined view;
  `951499f` invoice list filters by `receiptId`; admin `ApiError.details` surfaces the
  duplicate-invoice/archived ids for inline links.
- Tests: suppliers suite 15/15, payables service 19/19, payables HTTP 5/5; the phase adds
  **41** API tests (235 → 276). Phase 5 verification: API/SQL 102/102, console 25/25.

### Phase 6 Plan 06 execution notes (2026-10-23)

- **Plan 06 complete** (commits `59dbcd0`, `bd466dd`, `3696cd8`, `d4b8d19`, `acdbb57`,
  `f95c6a4`, `5ca4867`): the POS selling UI. Verification record:
  `phases/06-pos-offline-core/06-VERIFICATION.md`.
- **Shell and guards** (`routes/_pos/app.tsx`): no database → starting screen; no staff
  session → `#login`; no cached terminal config → `#login`; no open shift while
  `pos.salesRequireOpenShift` → `#shift`; `#pos/settings` requires MANAGER/ADMIN. The old
  placeholder `routes/_pos/route.tsx` was deleted (the shell it sketched is `app.tsx`).
  `lib/router.ts` adds `parseHash`/`navigate`/`useHashRoute`/`useRedirect`; `main.tsx`
  routes `#pos`, `#pos/tender`, `#pos/settings` through one `PosProvider` so the cart
  survives navigation.
- **Crash-safe cart**: `cart_draft` + `cart_draft_line` (local-only) hold the in-progress
  sale; the draft **id is the future sale id / client transaction id**, so Plan 07 writes
  the receipt and outbox row with the id already chosen. Persisted 150 ms after each change
  in one transaction (`saveCartDraft`), restored only when `shift_id` matches the open
  shift, sanitised on read (a corrupt or old draft can never reach `priceCart` in a shape it
  rejects). The reducer clamps quantity (1–10 000), line discounts to the line gross, the
  sale discount to the net after line discounts, and clears loyalty/credit approvals when
  the customer changes.
- **Local catalogue**: `product.tax_category` was added to the local schema (additive; the
  terminal cannot price tax without it; PowerSync adds the column to existing devices).
  Search binds every parameter, escapes `%`/`_`/`\`, and covers barcode → SKU → name,
  with a browse mode for an empty term (5 000-row cap) rendered in a virtualised 2-column
  grid (`@tanstack/react-virtual` 3.14.22, `useFlushSync: false` for React 19). Prices use
  the shared `resolveEffectivePrice`; stock shows synced + unacked deltas and never blocks.
- **Selling flow**: offline customers (`customer_draft`, uuidv7, normalized phone, duplicate
  phone selects the existing person), loyalty earn preview from the tax-exclusive base and
  redemption capped at the cart net, credit headroom including pending charges with
  `OK`/`OVER_LIMIT`/`HOLD`/`NO_PROFILE`/`NO_CUSTOMER`, manager overrides proven by a
  MANAGER/ADMIN binding + PIN (a cashier binding is refused before the PIN is checked),
  permissioned line and sale discounts, and a tender screen that builds the Plan 07 draft
  (cash keypad, exact/notes/change, credit with approval or explicit bypass, zero-total
  "no payment due").
- **Server change (operator-approved):** `applySale`'s discount cap now measures **all**
  discounts (line + sale) over gross **in pesewas** — `totalDiscountMinor >
  floor(subtotal × capPercent / 100)` — instead of the sale discount over net. This closes
  a bypass where a cashier with a 0% cap could discount a whole line with no approval, and
  the pesewa comparison closes a second one where a discount under 1% of a large cart
  floored to "0%". `OVERRIDE_INVALID` details now carry `totalDiscountMinor`,
  `grossMinor`, and `allowedDiscountMinor`. The approval proof is read from
  `saleDiscount.override`; for a line discount the client sends a zero-amount sale discount
  carrying the proof (`buildSaleDraft`).
- **Sale draft** (`lib/sale/sale-draft.ts`): pure, key-for-key conformant to the upload
  schema (a unit test asserts the exact key sets because the server schema is `.strict()`);
  cash change = tendered − total; credit requires a customer and equals the total; a
  zero-total sale sends no tenders. Receipt numbers are *peeked* from `document_sequence`
  for display only; the sequence is consumed at commit (Plan 07).
- **Verification:** desktop **235/235**, API **353/353**, shared 73/73, lint/check-types
  green, `bun run build:pos` packages, `evidence/verify-selling.ts` **32/32** (the real
  modules → the API's own Zod upload schema → server re-pricing agreement), and
  `evidence/smoke-selling-ui.mjs` **8/8** against the packaged binary. The contract script
  found the percent-floor loophole described above before it shipped.
- **Deliberately not in this plan:** the sale write, receipt rendering, ESC/POS printing,
  the cash drawer, the outbox uploader, and the enrolled-device E2E. Plan 07 owns the first
  four, Plan 08 the uploader, Plan 09 the E2E gate. Until Plan 07, the tender screen
  reaches "Sale ready" with the final draft but does not record it.

### Phase 6 Plan 07 execution notes (2026-10-23)

- **Plan 07 complete** (the plan file's task list, implemented as one atomic slice). The
  local schema gained two additive sale columns (`print_error`, `reprint_count`) and one
  local-only table, `device_setting`. No server or migration change was needed.
- **Atomic completion** (`lib/sale/complete-sale.ts`, `lib/sale/sale-repository.ts`):
  `prepareSale` is pure — it re-prices the cart with the shared `priceCart`, validates the
  tender, and builds the sale, lines, tenders, per-product stock deltas, credit delta,
  loyalty deltas, and upload payload. `completeSale` opens one `db.writeTransaction`,
  allocates `${terminal.code}-${YYYYMMDD}-${NNNN}` from `document_sequence` **inside** it,
  and writes every row plus the outbox row and the cart-draft cleanup. A failed write
  rolls all of it back and burns no receipt number. Duplicate product lines stay separate
  `sale_line` rows but aggregate into one negative `local_stock_delta`.
- **Receipt numbering** moved to `lib/sale/document-sequence.ts` (generic sequence in
  `lib/document-sequence.ts`, shared with shifts). The tender screen still peeks for
  display; the sale transaction consumes the number. Scope remains `sale`.
- **Receipt model** (`lib/receipt/render.ts`): one model from the local sale row drives
  both the on-screen 80 mm preview and the 42-column ESC/POS text. Money is formatted with
  integer `formatMinorPlain`/`formatMinorWithSymbol` (`GHS` by default; `GH₵` optional).
  E-VAT serial/QR/signature are present but empty until Phase 8.
- **Printer port** (`src/shared/printing.ts`, `src/main/printing/*`, `src/main/ipc/printer.ts`):
  a bounded, validated job crosses IPC; the main process builds `initialize → rows →
  feed(3) → optional drawer kick → cut` with `@maxxuxx/node-printer` 1.6.11. Adapters:
  `winspool` (Windows RAW), `network` (TCP 9100), `fake` (text + `.escpos.bin` + drawer
  log; the default so no terminal boots into a native error). Native import is dynamic and
  failures collapse to `PRINTER_*` codes with no raw error text.
- **Drawer**: cash tenders append `ESC p 0 50 250` (pin 2; pin 5 configurable) to the
  receipt, sent after the sale commits. A standalone kick is available from the receipt
  screen when printing failed.
- **Failure handling** (`lib/printing/print-sale.ts`): `PENDING → PRINTING → PRINTED |
  FAILED`; a failure stores a short `print_error`, keeps the sale, and the receipt screen
  offers Retry. Auto-print runs once for a `PENDING` sale; `FAILED` and a stale `PRINTING`
  wait for the button (a crash mid-print may already have produced paper). Reprints add
  `*** REPRINT ***` and increment `reprint_count` only after a successful print.
- **UI**: `#pos/receipt/<saleId>` (preview, status, Retry, Print again, Open drawer, New
  sale), `#pos/sales` (today plus any older unprinted receipt), an app-header “N to
  print” badge, and a printer section in `#pos/settings` (driver, queue/host/port, drawer
  pin, charset, copies, cedi symbol, test print). The tender screen now commits and
  navigates; the placeholder “Sale ready” dialog is gone.
- **Crash race closed**: `loadCartDraft` deletes a draft whose id already exists in `sale`,
  so a debounced cart write that lands after commit can never resurrect a sold cart.
- **Packaging**: `@maxxuxx/node-printer` is a runtime dependency externalised from the
  main bundle. `prepare-desktop.mjs` walks its production dependency closure and writes
  `node_modules/.runtime-packages.json`; Forge copies exactly that list. The first package
  attempt found the missing `iconv-lite → safer-buffer` edge, which is why the list is
  generated rather than hand-maintained.
- **Verification:** desktop **292/292** (57 new: sequence, sale completion/rollback,
  receipt model/text, ESC/POS bytes, fake adapter, print state machine, settings,
  formatting), typecheck and biome clean, `bun run build:pos` packages, packaged
  `test:print` **21/21** (text columns, money, drawer bytes, cut, simulated failure +
  retry, reprint, no CSP/page errors). Evidence: `evidence/printing.md`,
  `evidence/receipts/`, `evidence/shots/plan07-print-diagnostics.png`. The
  enrolled-device sale → print walkthrough stays the Plan 09 gate (needs API + PowerSync);
  the Windows hardware checklist is in the evidence note.

### Phase 6 Plan 08 execution notes (2026-10-23)

- **Plan 08 complete.** No server, migration, or permission change was needed; the upload
  endpoint and conflict reads from Plan 05 are the contract. The local schema gained two
  additive outbox columns (`last_error_code`, `last_error_message`, `acked_at`), an
  `outbox_next_attempt` index, plus `sync_conflict_local.sale_receipt_number`,
  `shift_number`, and a severity index.
- **State machine** (`lib/outbox/outbox-types.ts`): `pending → in_flight → acked |
  dead_letter` (with `conflict` reserved), `attempts` as a failure count, exponential
  backoff `min(1s × 2^attempts, 5min)` ±20% jitter, and RFC 9110 `Retry-After` parsing
  (seconds or HTTP-date, capped at 1h). There is **no max-attempts dead letter**: a long
  outage must never drop a sale. Only a server `REJECTED`/4xx or a corrupt local payload
  dead-letters.
- **Repository** (`outbox-repository.ts`): `nextBatch` claims the oldest due rows inside
  one write transaction; `in_flight` rows reset at every drain start (crash/ambiguity
  safe); APPLIED/REPLAYED ack the row, all three local delta tables for the sale, and link
  a server-resolved customer draft onto the sale and pending deltas; REJECTED dead-letters
  without acking deltas; retry resets a dead letter; acked rows prune after 30 days; the
  last successful upload timestamp persists in `device_setting`.
- **Uploader** (`lib/outbox/uploader.ts`): one drain at a time, strict FIFO, batch size
  from the session config (clamped 1–50), loop while a full batch is consumed. Triggers:
  outbox-insert event (debounced 200 ms), 15 s heartbeat while pending, `online` event, a
  successful PowerSync download, and manual Sync now. 401 pauses 60 s (the API client
  already used its one refresh); 403 calls `markDeviceRevoked` and pauses permanently until
  re-enrolment; 429 honours `Retry-After`; 5xx/network back off; 400 dead-letters the
  batch; an incomplete response leaves rows claimed and retries after 2 s (server replay is
  safe); corrupt payloads dead-letter per row and do not block the queue.
- **Offline hint nuance:** scheduled drains skip when `navigator.onLine === false`, but
  **manual Sync now attempts anyway**. Electron/Chromium docs say `false` is a strong
  offline signal while `true` proves nothing; Windows NCSI behind a firewall can report
  offline while the API is reachable, and stranding sales is worse than one failed attempt.
- **API client:** `ApiError` now carries `retryAfterSeconds` from the response header; the
  shared client still performs the single 401 refresh before the uploader sees a 401.
- **UI**: `SyncBadge` in the POS header (green synced time, amber pending/pulsing, red
  offline/action) links to `#pos/sync`; `#pos/sync` shows connection/download/upload/pending
  cards, manual sync, the outbox table, dead-letter Retry (manager/admin only), and the
  locally cached conflict list with expandable details. Receipts/sales/sync are reachable
  without an open shift. No payload, token, receipt line, or customer PII is rendered or
  persisted in error fields.
- **Provider**: one uploader per open database, started only with an active device session
  and stopped/reset on unmount; session token refreshes do not restart an in-flight drain;
  the PowerSync status listener nudges the uploader after a successful download. StrictMode
  and unmount races are guarded with stopped checks after every async start step.
- **Verification:** desktop **332/332** (40 new: state machine/backoff, repository SQL
  transitions, uploader scenarios, conflict upsert, Retry-After), typecheck and Biome clean,
  `bun run build:pos` packages, shell E2E **38/38**, packaged print smoke **21/21**, selling
  UI smoke **11/11** (adds sales/sync/receipt redirects), and the runnable
  `evidence/verify-outbox.ts` **41/41** against real SQLite with a scripted server
  (offline drain, lost response → REPLAYED, 503 backoff, 401 pause, 403 revoke, batch 1/25,
  rejected isolation, pruning, crash reset). Evidence: `evidence/outbox-recovery.md` +
  `outbox-recovery.json`. The full enrolled-device E2E (real API + PowerSync) remains Plan
  09.

### Phase 6 verification (Plan 09, 2026-10-23)

- **Phase 6 complete and verified** (commits `9b43ac9`, `3bc9446`, `64764a5`, `6956689`,
  `b58cfdb`, `8917f44`, `57acdb4`, `73b14e1`, plus the evidence/state commits). Record:
  `.planning/phases/06-pos-offline-core/01-VERIFICATION.md`.
- **Fresh cycle:** Docker volume reset → migrate → seed → demo seed ×2 (second is a no-op)
  → `sceptre_drive_test` migrated → `sync:init` → API on :4000 against :5434 → `sync:up` with the
  JWKS inlined → all 8 synced tables replicated. Evidence scripts:
  `walkthrough-pos.mjs` **162/162**, `race-last-unit.mjs` **18/18**,
  `duplicate-upload.mjs` **24/24**, `e2e-pos.mjs` **51/51**; packaged `test:e2e`
  **38/38** and `print-smoke` **21/21**. Suites: API **354/354**, shared 73/73, desktop
  **339/339**; lint + check-types clean.
- **Bugs found by phase verification and fixed:**
  - Credit-only tenders were reported as `TENDER_TOTALS` divergences (the check compared
    cash tenders minus total with change). Fixed to use the sum of all tenders; test added.
  - Stock-movement reconciliation scanned every branch's movements while the expected side
    was branch-filtered. Fixed with a branch predicate and a foreign-branch test.
  - `x-pos-binding` was missing from the CORS allowlist, so browser preflight blocked PIN
    change and binding validation. Header + preflight test added.
  - The enrolment screen never persisted the device token (`persistDeviceToken` was dead
    code), so a restart forced re-enrolment. Now persisted at redemption.
  - A terminal that booted offline never retried the session, so PowerSync and the uploader
    never started when the network returned. Resume on `online` and on manual Sync now.
  - PowerSync local-only `sale_line`, `sale_tender`, and `cart_draft_line` inserts omitted
    the required `id` (the unit tests used a SQL recorder). Ids generated; the E2E caught it.
  - The local `customer` table lacked `anonymized_at`, so the customer dialog failed with
    `no such column`. Column added.
  - `#pos` could bounce back to `#shift` because readiness ignored the shift query; the
    shift screen had no "Start selling" action. Both fixed (with a pure readiness test).
  - Revocation discovered by the PowerSync credential fetch hid the reason and cleared the
    status; the badge and sync screen now derive it from the session.
  - "Continue without approval" on an over-limit credit sale reopened the dialog forever;
    a conscious bypass now lets the sale complete and the server records the conflict.
- **Performance (5k products / 20k customers, `performance.json`):** cold start 1.66 s;
  first sync 19.9–24.1 s; search 338/18/369 ms type-to-result (includes 150 ms debounce);
  sale commit 125 ms cold / 132 ms warm click-to-receipt; print 40 ms; 2-row drain 10 ms;
  100 transactions through the upload endpoint 4.9 s. Cold start is within target; search
  and commit exceed their strict targets as UI-perceived numbers. **Operator decision
  requested** (documented in the verification record): accept for v1 and tune in Phase 7,
  or block.
- **Packaging:** Linux package + ZIP hashes in `evidence/logs/package-sha256.txt`; packaged
  shell 38/38 and print 21/21. The Windows Squirrel installer needs a remote/windows-latest
  run (still pending). `zip` is absent on this host, so the archive was made with Python.
- **Deliberate test constraint:** the packaged binary refuses localhost API origins, so the
  Electron E2E drives the unpackaged production build (same `app://` renderer/CSP/IPC).

### Post-verification security fix (2026-10-24)

- **Backup codes failed at sign-in** because the console uppercased input while Better Auth
  issues mixed-case codes and matches exactly. Preserved the case, accept a pasted code
  without the dash, and hide the backup-code switch during setup (codes recover a future
  sign-in; only the authenticator code finishes enrolment). `verify-two-factor-backup.mjs`
  **9/9**: throwaway admin → TOTP enrol → browser sign-in → typed mixed-case backup code →
  dashboard. API regression `two-factor.test.ts` 3/3.
- **Forced TOTP is now a toggle.** `auth.requireTwoFactor` (default off) in Settings >
  Security; the console's two guards read `GET /api/auth/policy`. Turning it on requires the
  acting admin to be enrolled, so it cannot lock its owner out. `verify-two-factor-policy.mjs`
  **9/9** (toggle off, refusal without 2FA, forced-setup redirect when on, back to the
  console when off). Screenshots 11–15 under `evidence/shots/`.
- **Break-glass CLI:** `bun run --filter api two-factor:reset -- --email <address>` clears the
  TOTP secret, backup codes, and `two_factor_enabled`, and audits the action. Used on
  2026-10-24 to clear the admin's pending enrolment in `sceptre_drive_dev`.
- Suites after the fix: API **360/360**, shared 73/73, desktop 339/339; lint and types clean.

### Phase 6 planning additions (2026-10-22)

- Phase 6 is **planned only** (9 plans, waves 1–6). Artifacts:
  `phases/06-pos-offline-core/00-CONTEXT.md` (D1–D36), `01-RESEARCH.md`, `01-PLAN.md` …
  `09-PLAN.md`.
- Locked mechanics worth carrying into execution: terminal-scoped offline receipt numbers
  (`${terminal.code}-${YYYYMMDD}-${NNNN}`); local-only tables + our own outbox (PowerSync
  downloads only, no CRUD `uploadData`); charged amounts are sale facts and price/total
  drift becomes a conflict, never a repricing; `SALE` stock movements use
  `postMovements(..., { allowNegative: true })`; credit/loyalty replay uses internal
  bypass options on `postEntry`; one `pos_sync_transaction` row per client transaction for
  exactly-once; the shared `priceCart` in `@sceptre/shared` is the only pricing path.
- Research deltas since the 2026-10-17 notes: Forge is now **8.0.1** (ESM-only, Vite
  plugin stable on Vite 8, `.cjs` main/preload); Electron is **45** (sync `safeStorage`
  deprecated, async only); PowerSync Web SDK is **2.5.0** (ESM-only, HTTP streaming,
  `syncStream`, local-only tables); Bun's self-contained workspace
  (`installConfig.hoistingLimits: "workspaces"`) is the Forge packaging fix.
- Desktop architecture: Electron Forge 8 + Vite 8 + React 19 + hash routing +
  `app://` secure protocol + strict CSP + fuses + async `safeStorage`; `@maxxuxx/node-printer`
  for Windows spooler RAW/ESC-POS behind a printer port with a fake adapter for CI.
- Verification gates: Plan 02's PowerSync-in-Electron spike must pass before UI work;
  Plan 09 needs a fresh Docker DB, the self-hosted PowerSync Docker service (`bun run
  sync:init` / `sync:up`), a two-device last-unit race, duplicate-upload drill, Electron
  E2E with fake printing, and an unsigned Windows installer.




| Date | Decision |
|---|---|
| 2026-10-17 | The earlier prototype and its planning are discarded; fresh git history on `dev`. |
| 2026-10-17 | v1 scope: POS + back office + inventory + suppliers + credit + loyalty + Paystack. E-commerce, delivery, payroll, GL, AI, fitment, and mobile are out of scope. |
| 2026-10-17 | API: Hono + Drizzle + Better Auth on Node 24. |
| 2026-10-17 | Offline sync: PowerSync Cloud (Free → Pro), Web SDK in the Electron renderer. **Superseded for development on 2026-10-22: self-hosted Docker service; production target open for Phase 9.** |
| 2026-10-17 | Database: PostgreSQL 17 on a VPS via Docker; PowerSync Cloud connects over TLS with an IP allowlist. **(Cloud path retained for the Phase 9 production decision; dev/CI self-hosted.)** |
| 2026-10-17 | Admin/Manager: TanStack Start. Desktop POS: Electron Forge + Vite + React + shadcn + Tailwind. |
| 2026-10-17 | Ghana GHS; VAT 15% + NHIL 2.5% + GETFund 2.5% = 20%; E-VAT receipt contract now, GRA adapter mock until credentials. |
| 2026-10-17 | Roles: Admin (global), Manager (branch), Cashier (terminal). One cashier per terminal per shift. |
| 2026-10-17 | Credit is branch-local; customer identity and loyalty are global. |
| 2026-10-17 | Offline: cash + credit work; MoMo/card/bank require internet. Never block a sale; oversell, over-limit credit, and loyalty double-spend become reconciliation conflicts. |
| 2026-10-17 | Loyalty: configurable; defaults 1 pt/GHS 1, 100 pts = GHS 1, 12-month expiry. |
| 2026-10-17 | Suppliers: invoices + payments ledger; Paystack transfers + manual fallback. |
| 2026-10-17 | Deployment: one VPS, separate staging/prod Docker stacks, Caddy, GitHub Actions, R2 backups. |
| 2026-10-17 | Scale target: 5 branches, 20 terminals, 5k SKUs, 20k customers. Manual data entry only. |
| 2026-10-17 | Plan 03: session freshness is measured from `session.createdAt` (Better Auth semantics), not updatedAt. |
| 2026-10-17 | Plan 03: public sign-up is blocked at the route level with `autoSignIn: false`; `disableSignUp` would also block server-side staff creation. |
| 2026-10-17 | Plan 03: added `branch.deactivate` as an admin-only permission. |
| 2026-10-17 | Plan 03: enrollment codes are HMAC-hashed with the auth secret, one live code per terminal, redeem rate limited (Phase 6 contract returns 501). |
| 2026-10-17 | Plan 03: `pinHash`/`pinVersion` are stored with `returned: false` and never leave the server. |
| 2026-10-17 | Plan 03: tests use `sceptre_drive_test` (`bun run db:test:prepare`); `TEST_DATABASE_URL` overrides for CI. |
| 2026-10-17 | API modules follow a fixed seven-file layout (`routes`, `validation`, `controller`, `service`, `repository`, `schema`, `types`); `schema` = Drizzle tables, `validation` = Zod schemas + validators. See AGENTS.md. |
| 2026-10-17 | Drizzle tables live in `api/src/modules/*/*.schema.ts`; drizzle-kit config, migrations, and seeds live in `api/`; `packages/db` is only the Postgres client. |
| 2026-10-18 | Console design: dense neutral ops console (system font stack, zinc tokens, compact tables); decorative scaffold styling pruned. Radix/new-york shadcn kept (no Base UI migration mid-project). |
| 2026-10-18 | Development email writes to `api/.mail/` (file provider); message bodies and tokens never reach logs. |
| 2026-10-18 | `GET /api/audit` supports `actorId` (user id) and `actorStaffId` (e.g. GA-0001) filters. |
| 2026-10-18 | Authorization never reads the session cookie cache: `loadSession` always fetches fresh (`disableCookieCache: true`), so role/branch/2FA/mustChangePassword changes apply immediately. |
| 2026-10-18 | Admin build script pins `NODE_ENV=production` (SSR bundle mixes dev JSX runtime otherwise). |
| 2026-10-18 | Vite: `envDir` = repo root; `resolve.dedupe` + `ssr.noExternal: ["sonner"]` prevent a second React copy from the Bun store. |
| 2026-10-18 | Forced flows order: password change first (API lock), then TOTP setup for admins; `/change-password` renders standalone. |
| 2026-10-18 | Phase 2: category `PATCH` updates name/parent only; archiving goes through the guarded archive/reactivate endpoints (no `isActive` on PATCH) so guards cannot be bypassed. |
| 2026-10-18 | Phase 2: saving a suggested SKU advances `catalog.skuSequence` (`advanceSequencePast`), on create and SKU-changing update; gaps acceptable. |
| 2026-10-18 | Phase 2: reference validation on product update runs only when the value changes (keeps archived-brand products editable). |
| 2026-10-18 | Phase 2: catalog archive counters live in `products.service` (service-to-service) to avoid a module cycle with `catalog.service`. |
| 2026-10-18 | Phase 2: products routes are `catalog/products/index.tsx` + thin `products.tsx` layout (flat-file children need the parent `Outlet`). |
| 2026-10-18 | Console money rendering: `formatGhs` / `parseGhsToMinor` / `formatMinorPlain` in `admin/src/lib/format.ts`; storage stays integer pesewas. |
| 2026-10-18 | Browser verification uses Playwright with `channel: "chromium"` (cached full build; the headless shell is not installed). |
| 2026-10-18 | Phase 3: branch average cost uses the shared `averageCostAfterReceipt` (weighted integer average, half-up). Receipts blend; adjustments and count variances never change average cost. |
| 2026-10-18 | Phase 3: posting is single-writer per product/branch — `lockOrCreateLevel` (upsert + `FOR UPDATE`) with products locked in sorted order; no deadlocks (concurrency test). |
| 2026-10-18 | Phase 3: short-close records status/note/closer with no stock movement — dispatched stock simply never arrives; destination discrepancies are the destination's problem, losses at source are adjustments. |
| 2026-10-18 | Phase 3: transfer authority is side-scoped — dispatch/cancel belong to the source branch, receive/short-close to the destination; the other side sees 403. |
| 2026-10-18 | Phase 3: count snapshots copy the level book at open; posting writes only variance movements (counted − snapshot) and refuses negative results (409, naming products). |
| 2026-10-18 | Phase 3: product archive requires zero stock everywhere (409 otherwise); warehouses cannot host POS terminals (409). |
| 2026-10-18 | Phase 3: movements carry `reference_number` (GRN/TRF/CNT, null for adjustments) so offline history reconciles without joins (Phase 6 contract). |
| 2026-10-18 | Phase 3: receipts record supplier name + invoice now; the payable row is created in Phase 5 from the same receipt (`payable` table does not exist yet). |
| 2026-10-18 | Phase 4: customer creation records the creating branch; admins must pass `branchId`, managers default to their own branch. |
| 2026-10-18 | Phase 4: customer search is `q` + `page`/`pageSize` (default 20); `includeArchived` and `branchId` filters are admin-only, managers search globally. |
| 2026-10-18 | Phase 4: anonymization requires zero credit balances (all branches) and zero loyalty points; it scrubs PII in place, keeps the ledgers, and releases the phone for re-registration. |
| 2026-10-19 | Phase 4 Plan 03: repayments are accepted positive at the HTTP edge and stored negative; charges are positive, refunds negative, adjustments signed. A single service path (`postEntry`) keeps one semantic. |
| 2026-10-19 | Phase 4 Plan 03: credit profiles are created lazily (upsert-then-lock) by the first settings change or posting; the default limit is 0, so charges need a manager to raise the limit first. |
| 2026-10-19 | Phase 4 Plan 03: a hold blocks new CHARGE only (collections stay open); anonymized customers accept no credit writes at all; archived customers block charge but allow repayment. |
| 2026-10-19 | Phase 4 Plan 03: an over-limit override writes two audit rows — the posting plus `credit.override` (reason, note, approver, limit snapshot). Aging buckets are fixed from the due date and only non-zero outstanding appears; statement closing is computed as opening + ranged so it reconciles by construction. |
| 2026-10-19 | Phase 4 Plan 04: earn is floor per sale with no carry (`floor(netPaidMinor × rate / 100)`); a sale below one point writes nothing. Redemptions are accepted positive at the HTTP edge, stored negative, and require ≥ `loyalty.minimumRedeemPoints` and enough balance (409). EARN carries the net amount paid; the engine computes points. |
| 2026-10-19 | Phase 4 Plan 04: redemption and clawback consume lots earliest-expiry-first; a clawback shortfall leaves the balance negative with lots clamped at zero (surfaced in the liability negative-balances list). Positive adjustments create a lot so expiry stays total; ADJUST is reason-coded, CLAWBACK is always RETURN, and EXPIRE is engine-only (`branchId`/`createdBy` null), one entry per account per run, idempotent across runs. |
| 2026-10-19 | Phase 4 Plan 04: reconciliation compares each projection to its ledger sum and lot remainders to positive backing − consumption; the liability value uses `floor(points × 100 / pointsPerCedi)`. Liability scoping: outstanding is global (all-branch), activity rows are manager-scoped plus global expiry rows, negative balances are manager-scoped by customer branch. |
| 2026-10-19 | Phase 4 Plan 05: background jobs run on pg-boss 12 against the API database (own `pgboss` schema); the loyalty expiry worker is the only queue so far. The schedule fires daily at 00:05 Africa/Accra with `missed: 'once'` so an outage catches up on boot; jobs start after HTTP listening and stop before the DB pool closes. |
| 2026-10-19 | Phase 4 Plan 05: the admin expiry trigger is `POST /api/loyalty/expiry-run` gated by the admin-only `loyalty.settings` permission; it calls the same `expireDueLots()` seam directly (no queue hop) so operators get an immediate, audited summary. |
| 2026-10-19 | Phase 4 Plan 06: console money dialogs keep one idempotency key per form session — kept on network failure, cleared on any API response — so retries never double-post while a corrected entry stays possible. |
| 2026-10-19 | Phase 4 Plan 06: statements print from the same API payload through a dedicated A4 print stylesheet (`@media print`, app shell hidden) rather than a second document generator. |
| 2026-10-19 | Phase 4 Plan 07: "expiring soon" is the sum of remaining live lot points expiring within 30 days; the liability headline value is `floor(points × 100 / pointsPerCedi)` and is legitimately negative when clawback shortfalls exist. |
| 2026-10-19 | Phase 4 Plan 08: verification runs the API/SQL walkthrough first on a fresh volume, then the browser walkthrough against the same data; exact REP numbers and staff emails are asserted by design, so `walkthrough-phase4.mjs` is fresh-DB-only and documented as such. |
| 2026-10-19 | Phase 4 Plan 08: a deactivated staff session fails closed with 401 (the session no longer resolves); the walkthrough asserts the lockout without depending on the exact status code. |
| 2026-10-22 | Phase 5 implements D1–D18 as locked. Specific mechanics: invoice unit costs are tax-inclusive when the tax fields are omitted (derived STANDARD 20% split, total = entered costs); sending tax fields switches the lines to net amounts and `total = subtotal + vat + nhil + getfund`. |
| 2026-10-22 | On-account payment remainders are never netted into aging buckets; they reduce the supplier's owed balance and appear as a separate "On account" figure. Aging uses the current due dates shifted by the as-of parameter (not a historical allocation snapshot), mirroring Phase 4 credit aging. |
| 2026-10-22 | A voided invoice keeps occupying its receipt slot (one invoice per receipt); voiding frees only the supplier's invoice number for re-entry. Payment voids are append-only RELEASE rows and never delete APPLY history. |
| 2026-10-22 | Supplier creation/archiving and invoice/payment creation serialize on the supplier row (`FOR UPDATE`), so archiving cannot race a new debt; allocation payments lock invoice rows in id order so parallel payments cannot over-apply. |
| 2026-10-22 | Console money forms keep one idempotency key per form session (kept on network failure, cleared on any API response), the Phase 4 pattern. |
| 2026-10-22 | Verification runs on the operator's **local PostgreSQL `:5432`** (`sceptre_drive_test`, schema reset because the role lacks `CREATEDB`), not Docker; tests use `TEST_DATABASE_URL`. The walkthrough is fresh-DB-only and asserts the seeded starting points (`SUP-00001/2`, `SINV-00001/2`, `PAY-00001/2`, sequences = 3). |
| 2026-10-22 | Phase 5 verification fixes kept: payment list rows carry supplier/branch names; supplier-product create/update return the joined product view; invoice lists filter by `receiptId`; the admin client surfaces API error `details`. |
| 2026-10-22 | Root linker switched to Bun **hoisted** (`bunfig.toml`) so Electron Forge can package `desktop/`: Forge does not follow symlinks and Bun 1.3's self-contained workspaces are not available for the hoisted linker. `desktop/scripts/prepare-desktop.mjs` bridges the gap. |
| 2026-10-22 | Plan 02: the POS renderer is served from `app://sceptre-drive` (privileged standard scheme), never `file://`; CSP is emitted as a header by the protocol handler and mirrored as a meta fallback, with config origins checked against a fixed allowlist. |
| 2026-10-22 | Plan 02: the PowerSync Web SDK **passes the phase gate** in the sandboxed `app://` renderer (encrypted WASM SQLite, local-only writes, watch, restart persistence). Production VFS = `OPFSCoopSyncVFS`, fallback `IDBBatchAtomicVFS`; always pass `vfs` explicitly and use `WASQLiteOpenFactory`. |
| 2026-10-22 | Plan 02: keychain = async `safeStorage` only, `secrets.json` mode 0600, ciphertext only, fail closed with `KEYCHAIN_UNAVAILABLE`. Linux `basic_text` is reported as `secureStorage.level: 'basic'` so Plan 04 enrolment can require `os`. |
| 2026-10-22 | Plan 03: POS tokens are Ed25519-signed (`jose`); device JWTs (`aud=sceptre-pos`) and PowerSync JWTs (`aud=POWERSYNC_AUDIENCE`) share one key served at `/.well-known/jwks.json`. `POS_JWT_PRIVATE_KEY` is required in production (boot fails without it); dev/test fall back to an ephemeral key with one warning. |
| 2026-10-22 | Plan 03: enrollment redemption issues the device token exactly once and stores only its HMAC-SHA256 hash (row locked `FOR UPDATE`). The device token is also the refresh credential — `/api/pos/session` is both sign-in and refresh. |
| 2026-10-22 | Plan 03: `allowLocalOrigins = isDev \|\| !app.isPackaged` decides whether `http://localhost` API/PowerSync origins are acceptable; a packaged app still fails closed. `app://sceptre-drive` must be listed in `CORS_ORIGINS`. |
| 2026-10-22 | Plan 03: the CSP `<meta>` fallback is always built with local origins included, because browsers enforce the *intersection* of header and meta; the runtime header stays authoritative. |
| 2026-10-22 | Plan 03: local development generates `powersync/.generated/service.yaml` with the API's public JWK inlined (`sync:up`), so sync works even when the host firewall blocks container→host. Staging/production use the committed `service.yaml` with `jwks_uri`. |
| 2026-10-22 | Plan 03: the compose Postgres host port is `${POSTGRES_PORT:-5433}` (5433 was already taken on this machine; `.env` uses 5434). |
| 2026-10-22 | Plan 03: the local PowerSync database uses `OPFSCoopSyncVFS` with an explicit `WASQLiteOpenFactory`, `enableMultiTabs: false`, and the SDK's own worker — the configuration the Plan 02 gate proved. |
| 2026-10-22 | Phase 6: development and CI use the **self-hosted PowerSync Docker service** (pinned `journeyapps/powersync-service` stable tag, `-r unified`) against the Docker Postgres, with Postgres bucket storage and the API JWKS. **Staging and production use PowerSync Cloud** (two instances) with the same sync config; no Cloud account is needed for development. |
| 2026-10-23 | Plan 04: PIN policy lives once in `@sceptre/shared` (4–6 digits, no repeated digits or straight sequences) and is enforced by the API, the console, and the terminal. |
| 2026-10-23 | Plan 04: managers may reset only **cashier** PINs in their branch (mirroring the password rule); admins may reset anyone. Role, branch, deactivation, and every PIN reset bump `pinVersion` and revoke live bindings so stale terminals fail closed. |
| 2026-10-23 | Plan 04: a binding token is 32 random bytes returned once and stored as `HMAC-SHA256` keyed with the auth secret; one active binding per (device, staff) enforced by the partial unique index; expiry 90 days; the token travels in `x-pos-binding`, never a URL or body. |
| 2026-10-23 | Plan 04: offline PIN hashing runs in the Electron **main process** with `@node-rs/argon2` (Argon2id 64 MiB/t=3/p=4). The 16-byte device salt is stored beside the verifier and used as the Argon2 pepper. The staff session is in memory only; quitting requires the PIN again. |
| 2026-10-23 | Plan 04: `staff_binding` gained `binding_id`, `binding_token`, `expires_at`, and `pin_must_change` as additive local-only columns (no local migrations, per D10). |
| 2026-10-23 | Plan 04: lockout is per binding (`pos.pinMaxAttempts` / `pos.pinLockMinutes`); a manager/admin binding unlocks a cashier and keeps its own independent failure counters. |
| 2026-10-23 | Plan 04: shift close stores the client expected cash, the server recomputed expected cash, and the variance; a difference raises `SHIFT_VARIANCE_MISMATCH` (MEDIUM) and never blocks the close. The server value is authoritative for Phase 7 reports. |
| 2026-10-23 | Plan 04: the Forge Vite plugin's default `ignore` drops `node_modules`, so native runtime modules are copied in a `packageAfterPrune` hook (`desktop/node_modules/@node-rs`) and unpacked by `auto-unpack-natives`. The packaged-app smoke proves real Argon2 IPC. |
| 2026-10-23 | Plan 04: `#login` also hosts the one-time enrollment-code screen (missing/revoked device), because a terminal cannot authorize a PIN without a device credential; the offline (`unknown`) state still allows PIN login. |
| 2026-10-23 | Plan 05: credit and loyalty expose `postEntryInTransaction(tx, …)`; the public `postEntry` wraps it. The POS sale calls the transaction seam so sale, ledgers, stock, conflicts, and audit commit atomically. |
| 2026-10-23 | Plan 05: `bypassPolicy` (credit) and `bypassBalanceCheck` (loyalty) are internal-only flags. The POS always records the debt/redemption and raises `CREDIT_OVER_LIMIT`/`CREDIT_HOLD`/`LOYALTY_NEGATIVE` instead of rejecting. |
| 2026-10-23 | Plan 05: a validated manager approval is passed as `CreditTxContext.overrideActor` so the credit entry's `overridden_by`/`override_reason` and the `credit.override` audit name the approver, not the till. POS also writes `pos.sale.override` for discount/credit approvals. |
| 2026-10-23 | Plan 05: the sale id **is** the upload's `clientTransactionId`; the receipt number is the human key. A receipt already used by another sale is a `RECEIPT_CONFLICT` rejection. |
| 2026-10-23 | Plan 05: Phase 6 accepts exactly one tender (cash or credit) and allows zero tenders only when the total is zero (fully redeemed). Cash tenders include the amount handed over; `change = cash − total`; credit equals the total. |
| 2026-10-23 | Plan 05: an internally consistent but different header is stored as charged and flagged `TOTAL_MISMATCH`; reconciliation will report it as a divergence by design. An internally inconsistent header is a rejection. |
| 2026-10-23 | Plan 05: stock/credit/loyalty post before the sale row, then the sale/lines/tenders and conflicts are written so `sync_conflict.sale_id` can reference the sale. `UNKNOWN_PRODUCT` rejections write a conflict without a sale reference. |
| 2026-10-23 | Plan 05: upload results are HTTP 200 with per-item `APPLIED`/`REPLAYED`/`REJECTED`; only auth/scope (401/403), validation (400), throttle (429), and unexpected failures (5xx) are non-200. |
| 2026-10-23 | Plan 05: device conflict reads and reconciliation are branch/terminal-scoped from the JWT and session scope respectively; reconciliation is read-only and returns divergences only. |
| 2026-10-23 | Plan 09: tender reconciliation uses the sum of all tenders minus the total (change), not the cash filter alone, so credit-only and zero-total sales reconcile cleanly. |
| 2026-10-23 | Plan 09: both sides of stock-movement reconciliation are branch-scoped; a deliberate header drift (`TOTAL_MISMATCH`) is expected to surface as a `HEADER_TOTALS` divergence, so the walkthrough asserts the exact set rather than zero. |
| 2026-10-23 | Plan 09: `x-pos-binding` is an allowed CORS request header; any future custom POS header must be added there or Electron preflight will fail as a network error. |
| 2026-10-23 | Plan 09: the device token is persisted to the keychain at enrollment; the token, not the JWT, is the restart credential. |
| 2026-10-23 | Plan 09: a terminal that started offline re-establishes the device session on the browser `online` event and on manual Sync now, then connects PowerSync; the uploader starts with the active session. |
| 2026-10-23 | Plan 09: every local-only row must supply its own `id` (PowerSync creates the column without a default); writes that only have a SQL-recorder test need a real-SQLite or E2E check. |
| 2026-10-23 | Plan 09: the local `customer` table includes `anonymized_at` for defensive filtering even though the Sync Stream already excludes anonymized rows. |
| 2026-10-23 | Plan 09: runtime readiness gates on the shift query as well as the config query; the shift screen offers "Start selling" once a shift is open. |
| 2026-10-23 | Plan 09: revocation discovered by the sync layer is surfaced from the session state on the badge and sync screen, because the uploader may stop before it can report `REVOKED`. |
| 2026-10-23 | Plan 09: "Continue without approval" is a tracked conscious bypass; the sale completes and the server records `CREDIT_OVER_LIMIT`/`CREDIT_HOLD` for review. |
| 2026-10-23 | Plan 09: the Electron E2E runs the unpackaged production build because a packaged app refuses localhost API origins by design; packaged startup, security, and printing are verified separately. |
| 2026-10-24 | Backup codes are mixed-case and case-sensitive (Better Auth compares them exactly). The console preserves case, tolerates a pasted code without the dash, and offers backup codes only at sign-in — they cannot finish enrolment. |
| 2026-10-24 | Forced TOTP for administrators is the global setting `auth.requireTwoFactor` (default **off**), toggled from Settings > Security and read by the console from the public `GET /api/auth/policy`. |
| 2026-10-24 | The toggle can only be turned on by an admin whose own account has TOTP, so enabling it cannot lock the operator out of Settings. |
| 2026-10-24 | Break-glass: `bun run --filter api two-factor:reset -- --email <address>` removes an account's TOTP secret and backup codes and audits `auth.two_factor.reset`. |


---

## Open Items (carry forward)

- Phase 6 Plan 04 carry-forward for Plan 05: the upload dispatcher must call
  `pos.service.openShift` / `recordCashMovement` / `closeShift` **inside** the per-client-
  transaction DB transaction and keep `pos_sync_transaction` as the idempotency owner.
  `requireActiveBinding` is the binding check uploads should use (403 `STALE_CREDENTIALS`).
  The device stores `bindingId`/`bindingToken`/`pinVersion` locally; an upload for a
  deactivated staff member or stale version must be rejected, not applied.
- **Plan 09 completed the enrolled-device E2E** (`evidence/e2e-pos.mjs`, 51/51): enrol →
  authorize manager + cashier → change PIN → open shift → offline sale with loyalty and an
  approved discount → print/drawer → quit → offline relaunch → PIN login → reprint →
  reconnect → exactly-once upload; plus over-limit credit and revocation. Hardware
  (printer, drawer, scanner, Windows terminal) remains a human checklist item.
- Phase 6 Plan 04: shift dialogs live in one `components/shift/shift-dialogs.tsx` module
  rather than three files as listed in the plan; the responsibilities (open / cash /
  close) are unchanged.
- Phase 6 Plan 04: `#pos` remains the Plan 02 shell; Plan 06 must route through
  `requireStaffSession()` and block selling until `loadShiftState().shift` is open when
  `pos.salesRequireOpenShift` is true.

- Phase 6 Plan 03 carry-forward for Plan 04: the device token lives in the keychain and
  `/api/pos/session` is the only refresh path; `requireDeviceJwt` re-reads the whole
  device→terminal→branch chain per request, so revoking a device (or deactivating a
  terminal/branch) takes effect immediately. `staff_binding` exists with a device-bound
  verifier and `pin_version`; there is no PIN endpoint yet.
- Phase 6 Plan 03: local development needs `POS_JWT_PRIVATE_KEY` in `.env` (otherwise the
  key rotates on every API restart and both stored JWTs and the generated PowerSync service
  config go stale). Regenerate the service config with `bun run sync:up`.
- Phase 6 Plan 03: the sync E2E (`bun run --filter desktop test:sync`) needs
  `DATABASE_URL` (Docker Postgres) and `BETTER_AUTH_SECRET`, plus a running API and
  PowerSync service; it cleans up the device it enrols.
- Phase 6 Plan 03: `psql` must be on PATH for the sync E2E and `sync:init`.
- **No git remote yet** — push `dev`, add `staging`/`main`, and watch the CI workflow run
  on GitHub (workflow is written and locally verified).
- Phase 4 and Phase 5 are verified (`phases/04-customers-credit/01-VERIFICATION.md`,
  `phases/05-suppliers-payables/01-VERIFICATION.md`). The verification fixtures live in the
  local `sceptre_drive_test` database; reset + reseed it before a demo and rerun the admin TOTP
  bootstrap afterwards.
- Phase 5 verification used `sceptre_drive_test`. The dev stack is the Docker project
  `sceptre-drive-dev` on host `:5434` (`sceptre_drive` + `sceptre_drive_test`). The operator's
  local instance on `:5432` still holds the pre-rename databases and the **discarded prototype
  schema** (PascalCase tables); do not point v1 at it.
- Phase 8: Paystack transfers consume `supplier_payment_detail.paystack_recipient_code`
  and the reserved `PAYSTACK` payment method; E-VAT purchase reporting uses the stored
  VAT/NHIL/GETFund split. Receipts and payables-aging exports are Phase 8 scope.
- Human verification from Plan 04: TOTP with an authenticator app is now machine-verified
  end to end (browser walkthrough performs forced setup + verification). Remaining: a
  human visual pass over the Phase 2 console screens and the dev-mail password-reset
  flow (Phase 1 list).
- GRA E-VAT onboarding: credentials, QR encoding, submission API shape (mock until then).
- Paystack registered business and keys; `PAYSTACK_MODE=mock` until then.
- VPS provider, domain, and DNS (Phase 9 setup gate).
- Windows code-signing certificate (Phase 9; unsigned builds first).
- PowerSync: development and CI use the **self-hosted official Docker service**
  (`journeyapps/powersync-service`, pinned stable tag, `start -r unified`) against the
  Docker Postgres with logical replication; no Cloud account is needed for Phase 6.
  **Staging/production use PowerSync Cloud** (two instances) with the same
  `sync-config.yaml`; the Cloud project/instances are a Phase 9 setup gate.
- Phase 6 packaging: the PowerSync spike passed and the Linux package is verified. The
  **Windows Squirrel installer** still needs a git remote (or a manual `windows-latest`
  run) and a clean-VM install; v0.1.0 is unsigned (Phase 9 certificate).
- **Operator decision requested:** search (~190–220 ms query+render) and sale commit
  (125–132 ms click-to-receipt) exceed the strict Phase 6 targets (150 ms / 100 ms) as
  UI-perceived numbers. Accept for v1 and tune in Phase 7, or block. Details in
  `phases/06-pos-offline-core/01-VERIFICATION.md`.
- **Phase 7 hand-offs:** admin conflict-resolution/reconciliation UI (SYNC-08 second half),
  returns/refunds, split tender, shift report screens, and the app-boot route (the POS still
  boots to the shell diagnostics; cashiers reach `#pos` by hash). Phase 7 also owns any
  search/commit performance tuning.
- Physical hardware for human verification: Windows terminal, ESC/POS printer, keyboard-wedge
  scanner, cash drawer (Phase 6 checklist).
- **Two-factor requirement is OFF (2026-10-24) per operator.** The admin's pending
  enrolment was cleared with the break-glass CLI and the toggle defaults off. To turn it on:
  sign in, set up 2FA from the user menu, then Settings > Security → Require two-factor.
- Cosmetic: console `favicon.ico` is a 404 (Phase 9 polish).

---

## Session Notes

- Load `gsd` and `owasp-security` before every planning or building task; load
  `powersync`, `hono`, `better-auth-*`, and `supabase-postgres-best-practices` when the
  task touches those areas.
- Plans are prompts. Implement one task at a time and commit atomically.
- Stop and ask before decisions that affect money, credit, stock, loyalty, permissions,
  or production infrastructure.
- The API runs TypeScript directly on Node 24 (`node src/index.ts`); keep source free of
  TS enums, namespaces, and parameter properties.
- Branch code suggestions use first/second/last consonant for long area names
  (Spintex → SPX, Adum → ADM); codes stay editable before save.
- Root scripts: `bun run db:up`, `dev:api`, `dev:admin`, `lint`, `check-types`, `test`,
  `build`, `db:generate`, `db:migrate`, `db:seed`, `db:test:prepare`.
- Run `bun run db:test:prepare` after migrations before running API tests; integration
  suites are skipped when the test database is unreachable.
- Email: console provider in dev (recipients redacted, bodies not logged); the file
  provider (`api/.mail/`) exists in development; temp passwords are returned once in API
  responses and emailed, never logged.
- Regenerating `packages/db/src/schema/auth.ts` with the Better Auth CLI will overwrite
  manual hardening; re-apply and regenerate a migration afterwards.
- New API modules: copy the seven-file layout documented in AGENTS.md. Pure scope
  helpers live in `api/src/auth/scope.ts`; request context adapters in `api/src/http/`.
- Phase 2 modules: `api/src/modules/catalog` (category/brand/uom + schema) and
  `api/src/modules/products` (product/barcode/price + guard counters). Cross-module
  calls: `catalog.service` → `products.service` (counts); `products.service` →
  `catalog.repository` (ref lookups) — keep it acyclic.
- Sequences: `allocateFromSequence` (consumes), `peekSequenceValue` (peeks),
  `advanceSequencePast` (syncs after an explicit `PREFIX-#####` value was saved) in
  `api/src/modules/platform/settings.service.ts`.
- Integration test fixtures seed catalog rows directly via Drizzle when the API under
  test does not own them; track every created id for scoped cleanup (other suites run
  in parallel against `sceptre_drive_test`).
- Walkthrough scripts (API + Playwright browser) live under
  `.planning/phases/02-catalog-pricing/evidence/`; run them against a running
  API (`:4000`) and console (`:3000`). The browser script auto-handles forced TOTP
  setup, storing the dev secret at `/tmp/opencode/admin-totp.json`.
- Phase 3 posting is a single service path: `postMovements` in
  `api/src/modules/inventory/inventory.service.ts` (sorted locks via
  `lockOrCreateLevel`; receipts, adjustments, transfers, and counts all go through it) —
  keep every future write path (POS sales) on it.
- Phase 3 evidence scripts: `.planning/phases/03-inventory-transfers/evidence/`
  (`walkthrough-inventory.mjs`, `smoke-console.mjs`, `smoke-transfers-counts.mjs`); run
  the browser scripts from a directory where `playwright` resolves and point `SHOTS_DIR`
  at the `evidence/` folder.
- Phase 5 evidence: `.planning/phases/05-suppliers-payables/evidence/` holds
  `walkthrough-payables.mjs` (HTTP + SQL, 102 checks) and
  `smoke-console-suppliers.mjs` (Playwright, 25 checks, 18 screenshots) with their logs.
  Both are **fresh-DB-only** (exact `SUP-00003/4`, `SINV-00003`, `PAY-00003` assertions).
  Rerun cycle on the local instance: reset the `sceptre_drive_test` schema, migrate, `db:seed`,
  `db:seed --demo` twice, start the API with that `DATABASE_URL`, bootstrap TOTP, run the
  API walkthrough, then the browser script from a directory where `playwright` resolves
  (`SHOTS_DIR` pointing at `evidence/`). Tests use `TEST_DATABASE_URL`.
- Phase 6 verification commands (fresh DB, API + PowerSync up, `DATABASE_URL` = Docker
  `:5434/sceptre_drive`): `walkthrough-pos.mjs` → `race-last-unit.mjs` → `duplicate-upload.mjs`
  (run with `bun`; they import `@sceptre/shared`), then `node e2e-pos.mjs` (Playwright
  over CDP must run on Node, not Bun) and `node perf-pos.mjs`. The E2E owns :4000: it stops
  the API to prove the offline relaunch, so stop any other `bun dev` first.
- The Electron E2E uses the **unpackaged production build** (`.vite` + Electron) because a
  packaged app refuses localhost origins by design. Rebuild with `bun run build:pos` before
  running it; do not build while an Electron test instance is running.
- `zip` is not installed on this host, so Forge's ZIP maker fails; the Linux package is
  still produced. CI/Windows runners have `zip`.
- Phase 5 invariants to preserve: invoices and payments have one write path
  (`createInvoice`, `createPayment`); allocations are append-only signed rows; invoice
  `amount_paid_minor`/status are projections recomputed in the same transaction; supplier
  rows lock before debts/archive; totals are always server-computed; account numbers stay
  masked outside the owning supplier detail payload.
- `bun run db:test:prepare` is Docker-specific; on the local instance, create/migrate
  `sceptre_drive_test` directly (the role lacks `CREATEDB`, so reset the schema instead of
  dropping the database).
- Phase 6 contracts to honour: extend `StockMovementType` (e.g. `SALE`) and add an
  oversell posting mode; keep movements append-only, `reference_number` populated, and
  the ledger-invariant test green.
- Admin console: server functions live in `admin/src/lib/*.functions.ts`; the session
  guard is `admin/src/routes/_authenticated/route.tsx`; permission helpers in
  `admin/src/lib/role.ts`; API client + types in `admin/src/lib/api.ts` / `api-types.ts`
  (hand-maintained). Catalog screens under `admin/src/routes/_authenticated/catalog/`;
  shared dialogs under `admin/src/components/catalog/`.
- Long-running dev servers in this environment: start with
  `(setsid nohup bun run dev > log 2>&1 < /dev/null &)` and kill with
  `pkill -f "[v]ite dev"` (bracket pattern avoids killing the calling shell).
- Better Auth CSRF: browser requests carry `Origin`; scripted clients must send a trusted
  `Origin` header on POSTs or the API rejects with `MISSING_OR_NULL_ORIGIN`.
- Phase 4: `writeAudit(entry, executor)` takes the executor as its second positional
  argument. Sequence assertions in tests stay format-based (e.g. `/^REP-\d{5}$/`) because
  the platform suite advances global sequences and test files run in parallel.
- Phase 4: every credit write goes through `postEntry` in
  `api/src/modules/credit/credit.service.ts` (profile locked `FOR UPDATE`; kind rules,
  enforcement, REP allocation, balance projection, audit). `settleCharges` is pure and
  shared by aging and statements; `balance_minor = SUM(amount_minor)` is test-enforced,
  including parallel refunds and same-key replay.
- Phase 4: `credit.service` calls `requireCustomer` (customers.service) for identity —
  service-to-service keeps the customers → loyalty bootstrap and credit → customers
  dependency direction acyclic (D22).
- Phase 4: customer archive/anonymize POST bodies are `{}` or `{ "note": "…" }`; the
  customer module owns bootstrap of the `loyalty_account` row (schema import only, no
  loyalty-module dependency) per D22.
- Phase 4: every loyalty write goes through `postEntry` in
  `api/src/modules/loyalty/loyalty.service.ts` (account locked `FOR UPDATE`, a lot per
  positive posting, FEFO consumption ordered `(expires_at, earn_entry_id)`, balance
  projection, audit). `expireDueLots` is the seam Plan 05 schedules; read-only
  `reconcileAccounts` backs the journey test and the Phase 8 reports — keep both green.
- Phase 4: loyalty settings stay at defaults in tests (`earnPointsPerCedi` 1,
  `pointsPerCedi` 100, `expiryMonths` 12, `minimumRedeemPoints` 100); platform tests only
  read them or reject invalid writes, so no suite should mutate global loyalty settings.
- Phase 4: loyalty reads are global, but `getLiability` activity is manager-scoped
  (own branch plus branch-less EXPIRE rows); tests assert per-branch totals only for
  their own uniquely-coded branches because all suites share `sceptre_drive_test`.
- Phase 4: pg-boss lives in `api/src/jobs/` (`boss.ts` singleton, `queues.ts`
  queue/worker/schedule, `index.ts` start/stop); tests import `app.ts` only, never
  `src/index.ts`. The loyalty job test starts its own instance against the test DB with
  `schedule: false` + `__test__enableSpies` and unschedules/stops in `afterAll`. A dev
  server under `node --watch` restarts into the jobs code automatically; two API
  instances share the `pgboss` schema safely.
- Phase 4 console: print support = `@media print { @page A4 }` in `admin/src/styles.css`
  plus `print:hidden` on the app shell and the customers layout; verify print output with
  Playwright's `page.emulateMedia({ media: "print" })`.
- Phase 4 console: while a Radix dialog is open it marks the rest of the page
  `aria-hidden`, and Playwright's `getByRole` excludes aria-hidden content while
  `getByText` does not — wait for dialogs to close before counting role-based locators.
- Phase 4 smokes seed fixtures through the real API (a fresh customer per run stays
  rerunnable) and may tweak non-reconciled columns directly for edge states (e.g.
  `loyalty_lot.expires_at` into the 30-day window) — the ledgers stay truthful because
  expiry dates are not part of reconciliation.
- Phase 4 evidence scripts: `.planning/phases/04-customers-credit/evidence/`
  (`walkthrough-phase4.mjs`, `smoke-console-credit-loyalty.mjs`). The API walkthrough is
  fresh-DB-only (asserts exact REP numbers and staff emails), restores the demo passwords,
  and must run before the browser walkthrough; the browser script runs from a
  Playwright-capable directory with `SHOTS_DIR` pointed at `evidence/`.
- Phase 4 console: statements print through `@media print` (A4, shell hidden); verify with
  `page.emulateMedia({ media: "print" })` and expect the sidebar to be hidden. Full-page
  screenshots include dialogs; card labels can duplicate page descriptions, so use exact
  text locators for them.
- Phase 6 (planned): load `powersync` before any sync work and re-read
  `phases/06-pos-offline-core/01-RESEARCH.md` — the SDK/Forge/Electron versions moved since
  the original 2026-10-17 research. Development runs the **self-hosted PowerSync Docker
  service** (`sync:init` → `sync:up`), not Cloud. Local-only PowerSync tables are never
  queued for upload; do not "fix" that by making sale/shift tables synced. The only sale
  write path is `pos.service.applySale`; the only pricing path is the shared `priceCart`;
  outbox rows are never deleted before an ack.
- Phase 6 (planned): the desktop workspace must be a self-contained Bun workspace
  (`installConfig.hoistingLimits: "workspaces"`) or Forge packaging will follow symlinks and
  fail. Use `POS_PRINTER_DRIVER=fake` for all automated runs; real hardware is a human
  checklist item. `app://` (not `file://`) is required for PowerSync workers.

- Phase 6 Plan 04: PIN policy is `pinProblem()` in `@sceptre/shared`; never duplicate the
  digit/trivial checks. Server PIN hashing reuses `auth/password.ts`; the terminal hashes in
  the Electron main process (`main/ipc/pin.ts`) with the stored 16-byte salt as the Argon2
  `secret` (pepper).
- Phase 6 Plan 04: device-facing staff endpoints are `POST /api/pos/staff/authorize`,
  `/change-pin`, and `/binding/validate`; the binding credential is the `x-pos-binding`
  header. All failures collapse into 401 `PIN_INVALID` (or 403 `STALE_CREDENTIALS` for a
  dead binding) and audit rows never contain the PIN or token.
- Phase 6 Plan 04: `pos.service.openShift/recordCashMovement/closeShift` take a
  `DbExecutor`; Plan 05's dispatcher must pass its transaction so the shift fact, the
  idempotency row, and the audit commit together. `computeExpectedCash` is exported for
  tests and mirrors the terminal's arithmetic.
- Phase 6 Plan 04: local-only `staff_binding` now carries `binding_id`, `binding_token`,
  `expires_at`, and `pin_must_change`; `pin_version` remains the server version. Keep the
  staff session in memory — do not persist it.
- Phase 6 Plan 04: packaging native modules requires the `packageAfterPrune` hook in
  `desktop/forge.config.mts` plus `desktop/node_modules/@node-rs` from
  `scripts/prepare-desktop.mjs`; the Vite main config marks `@node-rs/argon2` external.
  `bun run build:pos` then leaves `*.node` in `app.asar.unpacked`.
- Phase 6 Plan 04: the packaged-app smoke uses CDP (fuses block `--inspect`); run
  `node .planning/phases/06-pos-offline-core/evidence/smoke-pin-ui.mjs` from `desktop/`
  after `bun run build:pos`.
- Phase 6 Plan 04: the running dev API on :4000 points at the **Docker** Postgres
  (`localhost:5434/sceptre_drive`), not the local :5432 instance. After adding a migration, run
  `DATABASE_URL=postgresql://sceptre_drive:sceptre_drive@localhost:5434/sceptre_drive bun run --filter api db:migrate`
  or Better Auth answers 500 (schema validation) on every request.
- Phase 6 Plan 04: console smoke `evidence/smoke-console-pin.mjs` bootstraps forced TOTP
  and saves the secret to `/tmp/opencode/admin-totp.json`; it needs the API (:4000) and
  admin dev server (:3000) running. The admin dev server must be restarted after dependency
  changes (a stale Nitro process can 500 with a missing `youch` asset).
- Phase 6 Plan 05: the only server sale write path is `pos.service.applySale`; the only
  upload entry point is `sync.service.applyUpload`. Both take the caller's transaction
  (`applySale`) or open one per client transaction (upload). Do not add a second path.
- Phase 6 Plan 05: credit/loyalty writes from the POS must call
  `postEntryInTransaction(tx, …)`. `bypassPolicy`/`bypassBalanceCheck` are server-internal;
  the HTTP Zod schemas are `.strict()`, so a client cannot inject them.
- Phase 6 Plan 05: the sale payload contract lives in `sync.validation.ts` and
  `pos.types.ts`. The sale id = `clientTransactionId`; the tender override shape is
  `{ staffId, userId, bindingId, pinVersion, reasonCode, note, occurredAt }`; the cashier
  binding token is a secret — hash it, never log or audit it.
- Phase 6 Plan 05: `TOTAL_MISMATCH` sales intentionally store the charged header with the
  computed lines, so `reconcileSales` reports a divergence for them. Clean sales must
  reconcile to zero; Plan 09's walkthrough should assert both.
- Phase 6 Plan 05: reconciliation uses raw SQL; `max(uuid)`/`min(uuid)` do not exist in
  Postgres, so branch ids are grouped rather than aggregated. Keep the branch filter
  parameterised.
- Phase 6 Plan 05: the last-active-admin assertion in `staff.test.ts` is global to
  `sceptre_drive_test`. An aborted suite can leave an active `test-*@sceptre.test` admin and
  break it; clean those rows (or reset the DB) before a verification run.
- Phase 6 Plan 05: `sync.upload.test.ts` covers the endpoint (replay, concurrency,
  per-item rejection, 50-item cap, device mismatch, conflict/state reads); `pos.test.ts`
  covers sale arithmetic/conflicts and reconciliation. Both run serially.

- Phase 6 Plan 06: the discount cap is measured on **total** discounts over gross, in
  pesewas (`totalDiscountMinor > floor(gross × capPercent / 100)`), on both the client and
  the server. A floored percentage alone let sub-1% discounts on large carts pass a 0% cap.
- Phase 6 Plan 06: the upload contract has one override slot (`saleDiscount.override`).
  A line-discount approval is promoted onto a zero-amount sale discount
  (`reasonCode: 'OTHER'`) so the server can still validate it; line discount reasons live on
  the local line only (the payload carries no per-line reason).
- Phase 6 Plan 06: the cart draft id **is** the sale id / client transaction id; Plan 07 must
  reuse it for the local sale, the receipt number, and the outbox row.
- Phase 6 Plan 06: `best`-effort UI state is never authoritative — every displayed amount is
  a field of `priceCart`. The loyalty redemption is capped at the cart net so points are not
  burnt for no discount; the printed/charged discount is what the server keeps.
- Phase 6 Plan 06: search runs one parameterised query for barcode/SKU/name/browse and
  escapes LIKE wildcards; a full scan of 5k rows is acceptable locally, an FTS table is not
  needed at the target scale.
- Phase 6 Plan 07: the printer is a **port** (`winspool` / `network` / `fake`). The default
  is `fake` so a fresh terminal never boots into a native-module error; a manager selects
  real hardware in `#pos/settings`. Fake output is text + `.escpos.bin` + `drawer.log`.
- Phase 6 Plan 07: receipt, lines, tenders, deltas, outbox, and cart cleanup commit in **one
  local transaction**; receipt numbering is allocated inside it, so a rolled-back sale burns
  no number and a committed sale can never reuse one.
- Phase 6 Plan 07: one receipt model feeds the 80 mm screen preview and the 42-column
  ESC/POS text; money is integer-formatted (`GHS` by default, `GH₵` optional). E-VAT fields
  are reserved and unprinted until Phase 8.
- Phase 6 Plan 07: a cash tender appends the drawer kick to the receipt (`feed → kick →
  cut`, pin 2 default, pin 5 configurable) only after the sale commits. A standalone kick is
  offered when printing failed.
- Phase 6 Plan 07: print state is `PENDING → PRINTING → PRINTED | FAILED`. `FAILED` stores a
  short code/message and never touches the sale. Retry is manual; a reprint prints
  `*** REPRINT ***` and increments `reprint_count` only on success.
- Phase 6 Plan 07: `#pos/sales` lists today plus any older receipt that still needs
  printing, so a multi-day printer outage cannot hide a sale. Receipts/sales are reachable
  without an open shift.
- Phase 6 Plan 07: `prepare-desktop.mjs` writes the exact externalised runtime package list
  (`node_modules/.runtime-packages.json`) and Forge copies it, rather than a hand-maintained
  list (the first attempt missed `iconv-lite → safer-buffer`).
- Phase 6 Plan 07: the enrolled-device “sell → print → restart” E2E remains the Plan 09
  gate because it needs the API and PowerSync service; Plan 07 verifies the same
  orchestration with unit tests and a packaged fake-adapter print.
- Phase 6 Plan 08: the outbox is the only write path (`SALE`, `SHIFT_OPEN`,
  `CASH_MOVEMENT`, `SHIFT_CLOSE`); PowerSync stays download-only. One server transaction
  per item, idempotent by `(terminal_id, client_transaction_id)`, `REPLAYED` is success.
- Phase 6 Plan 08: no max-attempts dead letter. Transient failures retry forever with a
  5-minute backoff cap; only a server rejection, a 4xx, or a corrupt payload dead-letters.
  A dead letter is retried by a manager after review, never silently dropped.
- Phase 6 Plan 08: 401 pauses 60 s (the API client already refreshed once), 403 revokes the
  device and pauses until re-enrolment, 429 honours `Retry-After`, 5xx/network back off.
  Ambiguous responses leave rows claimed and replay on the next drain.
- Phase 6 Plan 08: scheduled drains honour `navigator.onLine === false`; manual **Sync now**
  still attempts, because Chromium's `false` is a strong offline hint while `true` is not
  proof of reachability and a false offline must not strand sales.
- Phase 6 Plan 08: conflict cache is refreshed without `since` after each drain so status
  changes are not missed; upserts are keyed by the server id. The local receipt/shift
  number is stored for display and linked to the local row by a subquery.
- Phase 6 Plan 08: the uploader is created once per open database and only while a device
  session is active; token refreshes do not restart an in-flight drain. Acked rows are
  retained 30 days, then pruned; sale rows remain.
