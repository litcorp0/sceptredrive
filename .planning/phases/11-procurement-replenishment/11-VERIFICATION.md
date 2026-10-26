# Phase 11 — Verification: Procurement, Replenishment & Supplier Returns

**Verified:** 2026-10-26
**Milestone:** v1
**Scope:** 11 plans, 33 commits (`8a0804a..HEAD` at the time of writing)
**Status:** complete — every roadmap success criterion maps to a command, a walkthrough leg or a
screenshot below. What could not be proven is named in §12 rather than omitted.

The goal, verbatim from `ROADMAP.md`:

> A manager can decide what to order from the numbers on screen, raise a purchase order, get it
> approved when it matters, receive the goods against what was ordered, send back what is wrong,
> and see which suppliers actually deliver.

---

## 1. Roadmap success criteria → proof

| # | Criterion | Proof | Result |
|---|---|---|---|
| 1 | Raise an order; below the threshold it is approved automatically, at or above it waits for the admin and cannot be sent | Walkthrough legs 1–4 (`/^PO-…/`, goods value, `APPROVED` with no approval row, `PENDING_APPROVAL` at exactly the limit); `shared/src/procurement.test.ts` threshold boundary; `api/…/procurement.test.ts` "auto-approves one pesewa below" and "waits at exactly the limit" | ✅ |
| 2 | Receiving works in full, partial, short and over deliveries; each line shows ordered / previously received / received now / outstanding; short leaves the order open; over needs a reason and is recorded | Walkthrough legs 10–13 (6 of 10 → `PARTIALLY_RECEIVED` with 4 outstanding; 4 → `RECEIVED`; over-delivery without a reason → 400; with `SUPPLIER_SENT_MORE` → accepted and the excess stored); `procurement.test.ts` receiving block; receive dialog shows all four numbers per line | ✅ |
| 3 | Receiving posts stock and average cost through the existing ledger path; no new stock write path; the ledger stays append-only | `createReceipt`→`postMovements` is the only write (no new writer added); walkthrough leg 21 (Σ movements = on hand) and leg 10d/11b; `inventory.service.ts` has no update/delete path for movements | ✅ |
| 4 | An invoice can be matched to an order; a price or quantity difference is flagged with both values, never silently accepted, never blocks the payable | Walkthrough legs 14–17 (`MATCHED`, `PRICE_VARIANCE` with both unit costs, `QUANTITY_VARIANCE`, cancelled order → 409); invoice detail match panel shows invoiced/received/ordered and both costs | ✅ |
| 5 | A purchase return creates a credit note that reduces the supplier balance and posts a negative stock movement; nothing is edited or deleted | Walkthrough legs 18a–18g (`-2` `SUPPLIER_RETURN` movement, `SCN-…`, balance reduced by exactly 2 × cost); `procurement.test.ts` returns block; posted returns cannot be cancelled | ✅ |
| 6 | Every product carries a min and a max per branch; the screen suggests a quantity from velocity and lead time, groups by supplier, and raises one order | Walkthrough legs 23–24 (inputs re-derived from SQL, coverage/suggested recomputed by hand, never-stocked part, unassigned part, open order reduces the suggestion, suggestion → DRAFT at the last cost); `replenishment.test.ts` 18 cases; threshold dialog's Minimum/Maximum/MOQ | ✅ |
| 7 | Supplier performance: on-time delivery, fill rate, actual vs promised lead time, last-cost drift | Walkthrough leg 26 of the read model is covered by `replenishment.test.ts` (6667 bp on-time, 7407 bp fill, 43 vs 40 tenths, 500 minor / 1000 bp drift); performance screen states its definitions and exclusions | ✅ |
| 8 | Every state change is audited, numbers reconcile to the ledgers, and the POS is untouched | Walkthrough legs 20, 21 and the audit block (12 actions present); §9 below (desktop diff reviewed, local schema and sync config empty) | ✅ |
| 9 | A manager submits a new product; it is created only when an admin approves; catalogue cost is derived from receipts | Walkthrough legs 25a–25g (submission, zero products, approval, exactly one product with cost 0, rejection creates nothing); product form no longer sends cost; walkthrough leg 22 | ✅ |
| 10 | The first receipt from a supplier creates the supplier-product link with its last cost | Walkthrough leg 10e (`lastCostMinor` created by the first delivery); `procurement.test.ts` "creates the supplier-product link on the first receipt" | ✅ |

## 2. Requirements → evidence

| Requirement | Evidence |
|---|---|
| PROC-01 raise an order with supplier, lines, costs, expected date | walkthrough legs 1–3 |
| PROC-02 threshold approval | legs 2, 4–7; shared boundary test |
| PROC-03 full/partial/short/over receiving | legs 10–13; receive dialog |
| PROC-04 invoice matching, advisory | legs 14–17; invoice detail match panel |
| PROC-05 purchase returns and credits | legs 18–20 |
| PROC-06 min/max, velocity, never-stocked parts | legs 23–24; `replenishment.test.ts` |
| PROC-07 supplier performance | `replenishment.test.ts` performance block; performance screen |
| PROC-08 reconciliation | legs 20–21 |
| PROC-09 product submission creates the link/cost only on receipt | legs 10e, 25 |
| PROC-10 no POS dependency | §9 |
| MGR-01 manager may create a supplier | permissions test; `AGENTS` matrix; approve of `supplier.create` for MANAGER |
| MGR-02 manager submits products, price policy stays admin | leg 25; `catalog.create` not granted (P11-D21) |
| MGR-03 manager sees own branch only | legs 26a–26e |
| MGR-04 returns and replenishment reachable by a manager | legs 18, 23 (manager cookie) |
| MGR-05 manager cannot approve | legs 5, 26d; `procurement.approve` is admin-only |

## 3. Gates

The transcript is `evidence/suites.txt`, produced by `evidence/run-suites.sh` in one sitting and
ending `ALL SUITES PASSED`. The two uncommitted local edits described in §11 were stashed for the
run and restored afterwards, so the transcript describes the committed tree plus this phase's
changes.

| Gate | Result |
|---|---|
| `bun run lint` | exit 0 — 25 pre-existing warnings, no errors (see §11 for the local files stashed to get this) |
| `bun run check-types` | 6/6 packages, exit 0 |
| `bun run --filter @sceptre/shared test` | 191 passed |
| `bun run --filter api test` | 479 passed, 37 files |
| `bun run --filter desktop test` | 421 passed, 50 files |
| `bun run modules:check` / `:strict` | 17/17 admin, 14/14 POS |
| `bun run brand:check` | OK over 964 tracked files |
| `bun run tokens:check` | OK, one token source |

Baseline at the end of Phase 10: shared 149, API 394, desktop 413. Phase 11 moved shared by +42
and API by +85; desktop moved by +8 **before Plan 01** (two local-API/CSP fixes committed during
the phase's setup, §9), not by any plan in this phase.

## 4. Fresh database cycle

```bash
docker compose down -v && docker compose up -d
bun run db:migrate          # every migration from zero, including 0009 (enum) and 0010
bun run db:test:prepare
bun run db:seed --demo      # admin + demo master data
bun run sync:init           # PowerSync publication
bun run seed:demo-sales     # 168 shifts, 2 433 sales
```

All five steps ran in one sitting on 2026-10-26 and exited 0. Two fresh databases (dev + test)
were migrated from an empty volume, which is the migration proof the phase's schema split
(`ALTER TYPE … ADD VALUE` in its own file, P11-D16) exists for.

## 5. API walkthrough — 85 assertions

`evidence/walkthrough-procurement.mjs`, transcript in `evidence/walkthrough-procurement.txt`.
Every fixture is created through the API with a unique suffix; the script exits non-zero on any
failure. It covers the plan's 28 legs (each leg is one or more `PASS n` lines; legs 10, 13, 14,
15, 18, 23, 25 and 26 print several assertions each).

The three suggestion facts are re-derived from the database with `pg` in the same run
(`stock_level`, `sale_line` over 90 days, open order lines) and the API's coverage/target/
suggested are recomputed from them — so the screen's number is reproducible from SQL, not merely
present.

## 6. Console walkthrough

`admin/test/walkthrough-sections.mjs` gained three sections, a manager leg and screenshots.
Result: **159/159 checks passed**, exit 0 (Phase 9's close was 138; the 21 new checks are this
phase's screens, dialogs and manager boundary). The transcript is
`evidence/walkthrough-console.txt`.

| Section | Assertion |
|---|---|
| `/procurement/orders` | renders; manager's rows = their branch's orders, no branch column, no approve action |
| `/procurement/replenishment` | renders "What to order"; the `Why?` breakdown expands |
| `/procurement/suppliers` | renders "Which suppliers deliver"; states its definition |
| pending order detail (admin) | the admin approves it and the page records who |
| receive dialog | an over-delivery reason unlocks the submit button |
| return dialog | states what is still returnable, capped |
| print preview | the order sheet renders under `media: print` |

Screenshots at a 1440 px-wide viewport (full page) in `evidence/shots/`: `plan11-orders-list.png`,
`plan11-order-detail-pending.png`, `plan11-order-detail-approved.png`,
`plan11-approval-panel.png`, `plan11-receive-dialog.png`, `plan11-return-dialog.png`,
`plan11-replenishment.png`, `plan11-supplier-performance.png`, `plan11-print-preview.png`.
Every section also asserts zero console errors and zero failed requests, which is how a broken
module barrel fails.

## 7. The gates can fail (mutation proof)

Each mutation was applied, the named check was run, the failure recorded, and the mutation
reverted (`git diff` empty afterwards).

| # | Mutation | Gate that failed | Failure |
|---|---|---|---|
| 1 | `requiresApproval` uses `>` instead of `>=` | `shared/src/procurement.test.ts` | 2 failed: "expected false to be true" at the exact limit |
| 2 | `assertBranchAccess` removed from `getOrder` | walkthrough leg 26a | "26a a foreign branch cannot read an order" — 84 passed, 1 failed |
| 3 | Over-receipt reason guard removed | `procurement.test.ts` | "refuses an over-delivery without a reason" — expected 400, got 201 |
| 4 | Self-approval check removed from `decideApproval` | `approvals.test.ts` | "refuses self-approval even for an admin" — expected 403 |
| 5 | Credit notes not subtracted in `sumSupplierOwed` | `suppliers.test.ts` | "lets a credit note offset an invoice…" — `Cannot archive: GHS 100.00 is still owed` |
| 6 | `.strict()` dropped from `orderCreateSchema` | walkthrough leg 28 | "28 order create rejects an unknown field" — expected 400, got 201 |

Mutation 5 exposed a real gap rather than confirming one: P11-D9 claims the archive rule is "a
tested invariant, not a comment", and no test exercised it. The test was written in this phase
(`65e0136`). The plan's table named an "archive-blocked test" that did not exist; the balance
level was already covered by walkthrough leg 20, which is why the first attempt at this mutation
did not fail.

## 8. Security acceptance (OWASP Top 10:2025 / ASVS 5.0 L2)

| Control | Evidence |
|---|---|
| A01 deny by default | every route file's `requirePermission`; walkthrough legs 26–27 (a cashier is refused all five route groups) |
| A01 object level (IDOR) | legs 26a–26e: read, receive, return, decide, list-filter — four 403s and one 403 on the query |
| A02 misconfiguration | the approval threshold is `writableBy: 'admin'`; a manager cannot raise their own limit (settings tests) |
| A05 injection | `grep -rn "sql\`" api/src/modules/{procurement,replenishment}` returns five sites: four `sql\`true\`` constants and one bound `days` parameter in `make_interval(days => $n)`. No string-built predicate |
| A06 insecure design | threshold falls back to the default, never to "no approval needed" (Plan 03 test); self-approval has no path (mutation 4); return caps re-checked inside the transaction (Plan 07 test) |
| A08 integrity | append-only movements; a posted return cannot be cancelled; an approval is decided once (leg 7 → 409); ledger totals reconcile (leg 21) |
| A09 logging | the walkthrough's audit block shows `purchase_order.created/auto_approved/submitted/approved/sent/received/cancelled`, `supplier_return.created/posted`, `stock_threshold.updated`; no PII, tokens or card data in any payload |
| A10 fail-closed | unauthenticated is 401; unknown id is 404; foreign id is 403; a missing setting uses the documented default |

Mass assignment: every body is a `.strict()` Zod object and is mapped field by field; mutation 6
proves the strictness is load-bearing.

## 9. The POS is untouched

Phase start is `8a0804a` (Phase 10's closing state document):

```text
git diff --stat 8a0804a..HEAD -- powersync/                       # empty
git diff --stat 8a0804a..HEAD -- desktop/src/renderer/lib/powersync/schema.ts   # empty
git diff --stat 8a0804a..HEAD -- desktop/src/renderer/lib/powersync desktop/src/renderer/lib/outbox   # empty
```

`git diff --stat -- desktop/` over the same range is **not** empty: seven files, +153/−8, from two
commits made during this phase's *setup*, before Plan 01 — `780268d` (a packaged build may reach a
local API on explicit opt-in) and `3e33492` (the dev server's CSP must allow the local API). Both
touch `desktop/src/main/{config,csp,main}.ts` and the renderer Vite config, add their own unit
tests, and exist so the console can be exercised against a local API. Neither touches the selling
path, the local schema, the outbox, the connector or a sync stream; the three empty diffs above
are the proof that no terminal migration and no sync change is implied.

The desktop suite reads **421** (was 413 at Phase 10's close; the +8 are those two commits'
tests). It was re-run, not assumed.

## 10. Defects found and fixed

| Found by | Defect | Fix |
|---|---|---|
| Plan 08 execution | `sale_line_product_sale_idx` was prescribed unconditionally; measurement showed it cannot be used by the velocity query's join shape | no migration written; measurement recorded in `evidence/08-velocity-and-suggestion.md` |
| Plan 08 execution | promised lead time averaged over undelivered lines, so "promised 7, took 9" compared different sets | averaged over delivered lines only |
| Plan 08 execution | fill rate gated on "has any receipt" rather than the order's status | gated on `RECEIVED`/`CLOSED`/`PARTIALLY_RECEIVED` |
| Plan 08 execution | `POST /orders/from-suggestions` accepted an explicit zero cost and silently substituted the link cost | explicit zero is refused; an omitted cost uses the link |
| Plan 08 execution | `POST /api/procurement/returns/:id/post` was registered twice (Plan 07) | duplicate removed |
| Plan 09 execution | the plan's invoice `matchStatus` list filter does not exist in the API (list rows carry `hasVariance`) | `variance=true` filter and a variance badge; the line-level status is on the detail |
| Plan 09 execution | product submission had no admin decision screen, so the console could never create the product | pending-submissions panel on the product list, behind `procurement.approve` |
| Plan 09 execution | the order detail could not list its receipts: `purchase_order_id` was written but no read exposed it | `purchaseOrderId` added to the receipt list/detail and as a filter (`a0df343`) |
| Plan 09 execution | the return dialog could not cap at `received − returned`; no read exposed it | `GET /api/procurement/receipts/:id/returnable` (`a0df343`) and the dialog uses it (`2782cf3`) |
| Plan 10 execution | the suggestion screen's header sentence needed the settings it computed with, which the payload did not echo | `settings: { velocityDays, safetyDays, defaultLeadDays }` (`78c2324`) |
| Plan 10 execution | `threshold-dialog` did not send or prefill max/MOQ, and stock detail did not read the threshold row | one dialog, both fields, prefilled from the branch's row |
| Plan 11 | no test proved P11-D9's archive rule; mutation 5 did not fail anything | `suppliers.test.ts` credit-offset archive test (`65e0136`) |
| Plan 11 | both new pages hid their own title when no branch was chosen, so a deep link looked like a blank section | the `PageHeader` renders before the branch guard |

## 11. Deviations from the plan set

- **Plan 08's five commits became three.** The two read models share all six module files, so the
  split would have committed the same files twice; the tests landed with the code they test.
- **Plan 09's eight commits became six** (plus my two follow-ups). `index.ts`, `routeTree.gen.ts`
  and `order-detail-page.tsx` were touched by several plan tasks; the split is by buildable
  change instead of by plan bullet.
- **Plan 10's six commits became two**, for the same reason: `suggestions-view` imports the
  raise-order dialog and the extended threshold dialog, and the generated route tree must match
  both routes.
- **The gate line lives in the controller's commit** (`da472f8`), not the lane's: `scripts/**` is a
  controller file. The two directories and their `REQUIRED_MODULES` entries are in that one
  commit because a required-but-absent module is a hard failure.
- **Plan 10's "product that drifted most" is not rendered.** `SupplierPerformanceRow` carries the
  drift amount, basis points and the number of comparable products, but no product identity. The
  screen shows what the API returns rather than inventing a name; carrying the top product is a
  one-field API change recorded as a carry-forward.
- **The empty state's "last computed" time is the client's last successful fetch**, because the
  payload has no server compute timestamp. Named rather than described as server time.
- **`bun run lint` is red on one file that is not this phase's**: a stray formatter run in
  `admin/src/modules/settings/pages/settings-page.tsx` (uncommitted, pre-existing). It was left
  untouched; every file this phase wrote passes Biome. The 25 warnings are pre-existing in
  `.planning/**/evidence/*`, two API tests and `packages/brand/src/tokens.css`.
- **`AGENTS.md` needed no edit.** Plan 11 asked to correct the "Test command" note header that
  still said `bun test`; the header already says `bun run test` in this tree, so the defect was
  fixed before this phase.
- **The console screenshots are one viewport (1440 px wide).** Phase 11's plan asked for 1024 × 768
  and 1440 × 900; the 1024 pass was not added to this script (the responsive matrix it already runs
  is 320/768/1024/1440 for analytics). Recorded as not proven for the procurement screens.

## 12. Not proven here

- The **console at 1024 × 768** for the procurement and replenishment screens. The walkthrough
  runs at a 1440 px-wide viewport; the tables use horizontal scroll containers, but that is a code reading, not
  a measurement.
- **A real browser print preview**: `media: print` is emulated and screenshotted, which proves the
  sheet renders and the rest of the page hides; it does not prove a printer's pagination.
- **The console's `matchStatus` list filter** — the API exposes `hasVariance`, so the filter is
  "Variance to check". A per-line status in the list would be an API aggregate, not a UI choice.
- **Multi-branch supplier comparison** on the performance screen: it is per branch by design
  (the read model is branch-scoped), so an owner comparing branches reads them one at a time.
- **Approval expiry** and **per-branch lead time** remain out of scope, as P11-D3/D10 recorded.

## 13. Evidence index

| File | Contents |
|---|---|
| `evidence/suites.txt` | every gate, one transcript |
| `evidence/run-suites.sh` | the script that produced it |
| `evidence/walkthrough-procurement.mjs` | the 85-assertion API walkthrough, fixtures included |
| `evidence/walkthrough-procurement.txt` | its committed transcript |
| `evidence/08-velocity-and-suggestion.md` | the velocity query plan, the rejected index, one suggestion reconciled by hand |
| `evidence/shots/plan11-*.png` | the console screens |
| `admin/test/walkthrough-sections.mjs` | the console walkthrough, extended |
| `api/src/modules/{procurement,replenishment,approvals}/*.test.ts` | the service-level proofs |
| `packages/shared/src/{procurement,replenishment}.test.ts` | the arithmetic and the transition matrix |
