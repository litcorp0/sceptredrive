---
phase: 04-customers-credit
plan: 08
title: Phase 4 verification — Customers, Credit & Loyalty
status: verified
verified: 2026-10-19
verifier: agent (HTTP + SQL walkthrough, Playwright browser walkthrough; screenshots in evidence/)
---

# Phase 4 — Customers, Credit & Loyalty — Verification

**Goal proven:** one customer identity across the business, branch-local credit with
limits and ledgers, and a global loyalty programme with earning, redemption, and expiry —
all reconciled at the ledger level.

**Environment:** dev database volume dropped and recreated (`gikautos`), migrations
applied, `db:seed` + `db:seed --demo` run; API (`:4000`) and admin console (`:3000`)
running. The fresh database required a new admin TOTP enrolment, re-run with
`/tmp/opencode/bootstrap-admin-totp.mjs` (secret at `/tmp/opencode/admin-totp.json`). The
API walkthrough drove the same HTTP endpoints the console uses and asserted the ledgers
directly in SQL; the Chromium browser walkthrough then drove the console flows against
that same database state.

**Evidence scripts** (committed for reproduction):

- `evidence/walkthrough-phase4.mjs` — HTTP + SQL walkthrough, **154/154** on the fresh
  database (ledger invariants in SQL, FIFO reconstruction, statement/aging arithmetic,
  FEFO consumption rows, expiry job, liability, permission matrix, lifecycle, audit,
  reconciliation).
- `evidence/smoke-console-credit-loyalty.mjs` — Playwright console walkthrough with real
  submissions and screenshots, **29/29**.

Key screenshots: `01-customer-create-dialog.png`, `02-customer-created.png`,
`03-search-phone-suffix.png`, `04-credit-panel.png`, `05-credit-settings-dialog.png`,
`06-repayment-toast.png`, `07-over-limit-409.png`, `08-override-posted.png`,
`09-statement.png`, `10-statement-print.png`, `11-aging-buckets.png`,
`12-loyalty-adjust-dialog.png`, `13-loyalty-history.png`, `14-liability-report.png`,
`15-settings-loyalty-credit.png`.

## Success criteria

### 1. Global customer identity with branch-owned credit — PASS

- The ACC-SPX manager created `Walkthrough Credit <stamp>`; the customer returned with
  `createdBranchId` = ACC-SPX and `status` ACTIVE.
- A temporary warehouse manager (ACC-WH1) found the same customer by 4-digit phone
  suffix and by name fragment from the global customer list.
- That manager's customer detail and profile list for the customer contained **zero**
  credit profiles; the ACC-SPX manager saw exactly one profile (branch ACC-SPX, limit
  GHS 500.00, 14-day terms). Requesting profiles for the SPX branch from the WH manager →
  **403**.
- Later the WH manager opened its own profile for the same customer at ACC-WH1 and posted
  a GHS 50.00 charge: WH1 balance GHS 50.00, SPX balance unchanged at GHS 940.00, and
  each manager's customer detail shows only their own profile.

### 2. Credit ledger, limit enforcement, and reasoned override — PASS

- Opening charge GHS 300.00 (`OPENING_BALANCE`) posted; the response `dueDate` equals the
  charge `occurredAt` date **+ 14 days** exactly (terms shape the due date).
- A further GHS 250.00 charge with projected balance GHS 550.00 against the GHS 500.00
  limit → **409** `This charge exceeds the credit limit (balance GHS 550.00, limit
  GHS 500.00)`.
- The same charge with `override: { reasonCode: "TEMPORARY_APPROVAL", note }` → **201**;
  the entry carries `overrideReason` and `overriddenBy` (staff id), and the audit log has
  a `credit.override` row whose `after.reasonCode` is `TEMPORARY_APPROVAL`.
- Full scripted ledger: seven charges (30 000 / 25 000 / 10 000 / 15 000 / 12 000 /
  8 000 / 1 000), a GHS 30.00 refund stored **negative**, a GHS 40.00 repayment stored
  **negative** → projected balance GHS 940.00; refunds reduce principal and repayments
  reduce the balance.
- Re-submitting the same client idempotency key returned the same entry and the ledger
  held exactly one row for the key.

### 3. Repayment, statement, and aging reconcile to the ledger — PASS

- The first walkthrough repayment allocated **REP-00002** (the demo seed's opening
  repayment consumes REP-00001 on a fresh database); the next two repayments were
  REP-00003 and REP-00004.
- FIFO settlement was reconstructed in SQL (window over `occurred_at, created_at, id`):
  total credits of 7 000 applied oldest-first, so the 134-day-old GHS 80.00 charge was
  left with **GHS 10.00** outstanding and every other charge untouched (30 000 / 25 000 /
  15 000 / 12 000 / 10 000 / 1 000). The API statement's per-charge aging matched that map
  charge for charge.
- Full statement: opening **0**, 9 ledgers rows, closing **94 000** = `currentBalanceMinor`.
  Windowed statement from −30 days: opening **35 000**, 6 in-range rows, closing **94 000**.
- Aging today: Current 56 000 (30 000 + 25 000 + 1 000), 1–30 10 000, 31–60 15 000,
  61–90 12 000, 90+ 1 000, total **94 000**, oldest due date 120 days ago.
- Aging as-of −31 days: Current 66 000, 1–30 15 000, 31–60 12 000, 61–90 1 000, 90+ 0,
  total 94 000 — the same settlement re-buckets without drift.
- Overpayment: one charge GHS 100.00, refund GHS 30.00 (principal 70.00), repayment
  GHS 250.00 → balance **−GHS 180.00**; the statement shows the negative current balance
  with zero aging rows. No netting against other customers.

### 4. Loyalty earn/redeem/adjust/expire update the ledger and balance — PASS

- An earn on GHS 0.50 floors to zero points: the response `entry` is `null` and the
  balance stays 0 (floor per sale, no carry).
- Earn GHS 200.00 (backdated 40 days) → **+200** points and lot A 200/200; replaying the
  idempotency key returned the same entry with exactly one ledger row.
- Earn GHS 300.00 → **+300**, lot B 300/300, balance **500**.
- Redeem 250 → **−250**; the quote valued 250 points at 250 pesewas; FEFO consumption
  drained lot A (200) then lot B (50); consumption rows `(A, 200)` and `(B, 50)` were
  stored; lot remainders 0/250; balance **250**.
- Adjust +50 (`GOODWILL`) → lot C 50; balance **300**.
- A test-only SQL shift moved lot B's `expires_at` into the past; `POST
  /api/loyalty/expiry-run` (admin) returned `{ accounts: 1, lots: 1, points: 250 }`,
  wrote the ENTIRE lot as one **EXPIRE −250** entry with `branchId`/`createdBy` null and
  reason `EXPIRY`, zeroed lot B, and dropped the balance to 50. A second run returned
  `{ accounts: 0, lots: 0, points: 0 }`.
- Clawback 400 → **−400**; the remaining 50-point lot was drained (consumption 50, zero
  remainder) and the balance became **−350**, surfaced for manager review.
- Liability (API run): rate 100 points = GHS 1.00; outstanding points 250 (seeded Kwame)
  − 350 = **−100**, value `floor(−100 × 100 / 100)` = **−100** pesewas; the
  negative-balance list flags the walkthrough customer (−350 at ACC-SPX); expiring-soon
  exposure was 0; the SPX activity row reconciles (earned 750 including the seeded 250,
  redeemed 250, clawed back 400, adjusted 50, net 150) with the global EXPIRE row at 250.
  After the browser fixtures the same database held **575** live points, and the browser
  check reconciled the headline (`575 points` ↔ `GHS 5.75`).

### 5. Managers see only their branch's credit; the admin sees all — PASS

- Both managers' branch lists contained exactly one branch (their own).
- Cross-branch credit entry list, statement, aging, post, and repayment → **403** in both
  directions (WH manager into ACC-SPX, SPX manager into ACC-WH1).
- Admin aging returned both branches separately, with the same customer at ACC-SPX
  (GHS 940.00) and ACC-WH1 (GHS 50.00). Manager aging returned one branch each.
- Permission matrix: manager archive → **403**, manager anonymize → **403**, manager
  expiry run → **403**, manager global setting PATCH → **403**; cashier customers list,
  credit posting, and loyalty liability → **403** each.
- Lifecycle: admin archive → `ARCHIVED`; charging an archived customer → **409**
  `Archived customers cannot be charged new credit`; reactivate → `ACTIVE`; repayment
  settles to zero; admin anonymize → `Anonymized customer` with `phone` null and
  `anonymized_at` set, the three credit entries intact, absent from the name and
  phone-suffix searches.
- Anonymize guards: main customer → **409** `Cannot anonymize: unreconciled credit at
  ACC-SPX: GHS 940.00, ACC-WH1: GHS 50.00`; loyalty customer → **409**
  `Cannot anonymize: -350 unreconciled loyalty points remain`.

## Additional verification

- **Reconciliation SQL (all zero):** every `credit_profile.balance_minor` equals its
  ledger sum; no credit entries without a profile; every `loyalty_account.balance_points`
  equals its entry sum; every lot's remainder equals positive postings minus consumption;
  no negative lot remainders.
- **Audit coverage:** the walkthrough produced rows for `customer.created`,
  `customer.updated`, `customer.archived`, `customer.reactivated`, `customer.anonymized`,
  `credit.charge`, `credit.repayment`, `credit.refund`, `credit.adjustment`,
  `credit.profile_updated`, `credit.override`, `loyalty.earned`, `loyalty.redeemed`,
  `loyalty.adjusted`, `loyalty.clawback`, and `loyalty.expiry_run` (24 distinct actions
  exist across the whole database including the earlier plan smokes).
- **Demo fixtures intact:** the seeded Kwame loyalty balance is still 250 points after
  the full run.
- **Session hygiene:** the walkthrough restores the demo manager/cashier passwords to
  `demo-password-1234`; the temporary warehouse manager is deactivated at the end and its
  session is rejected with **401** (session invalidated).
- **Browser evidence (same fresh DB):** create dialog → toast + list row; 4-digit phone
  search finds the customer; credit panel shows GHS 120.00 owed; settings dialog prefills
  limit 500.00 / 14 days; repayment toast carries the `REP-…` number and drops the
  balance to GHS 70.00; a GHS 460.00 charge surfaces the 409, reveals the override block,
  and posts with a reason → GHS 530.00; the statement prints three ledger rows with the
  REP reference and two Current aging lines, and the print media hides the app shell; the
  aging page places the customer in the Current bucket at GHS 530.00; Loyalty shows 200
  points, the adjust dialog posts +25 Goodwill → 225 points with both history rows; the
  admin liability cards reconcile points to GHS at the 100-point rate, the negative
  balances section renders, and Settings shows the Loyalty and Credit groups.
- **Quality gates:** `bun run db:test:prepare` re-created `gikautos_test` after the
  volume reset; `bun run lint` clean (315 files); `bun run check-types` clean (api,
  admin, shared, db); `bun run test` — shared **54/54**, api **235/235**; `bun run build`
  (admin SSR) passes.

## Deviations from plan text

1. **Receipt numbering starts at REP-00002** for the walkthrough: the demo seed posts an
   opening repayment (REP-00001) on a fresh database, so the run asserts exact values
   REP-00002/00003/00004 instead of REP-00001.
2. **"A second manager" is temporary:** the walkthrough creates a warehouse manager
   through the staff API, exercises the temporary-password + forced-change flow, and
   deactivates the account at the end so reruns stay clean. It does not leave a test user
   behind.
3. **Deactivated sessions answer 401**, not 403 — the session no longer resolves, which
   is the intended invalidation semantics; the walkthrough asserts the lockout without
   pinning the framework's status choice.
4. **The API walkthrough requires a fresh database volume** (exact REP numbers, staff
   email, and reconciliation figures); the browser evidence runs afterwards on the same
   database, and repeated browser runs accumulate console fixtures in the dev DB by
   design (dev-only).
5. **Browser scripts are executed from a Playwright-capable directory** (the dev harness
   at `/tmp/opencode`) with `SHOTS_DIR` pointed at `evidence/`, mirroring the Phase 3
   convention; the committed files are the ones that produced the recorded results.
6. **Negative liability values are expected** in the API run (−100 points remaining):
   the walkthrough deliberately exercises the clawback-shortfall path, and the browser
   run afterwards sees a net positive (575) once its own earns land.

## Human verification still valuable

- A visual pass over `evidence/*.png` to confirm the console styling matches taste; the
  flows themselves are machine-verified.
- A real A4 print of the statement (the Phase 3/4 print CSS is exercised through
  Playwright's print media emulation; physical output belongs with the Phase 6 printer
  work).
- **Phase 5** must link supplier invoices to Phase 3 receipts (payables do not exist yet)
  and keep the catalogue/credit consoles consistent.
- **Phase 6** sync contract: keep `customer.created_branch_id`, branch-local
  `credit_profile.branch_id`, and ledger `reference_number`s meaningful offline; queued
  over-limit credit and loyalty double-spends must surface as reconciliation conflicts
  for manager review, never blocked sales.
- **Phase 7** Paystack repayments must post through the same `postEntry` path (REP
  allocation, audit, idempotency) so statements and aging stay reconciled.
- **Phase 8** exports and the negative-balance queue should reuse `reconcileAccounts` and
  the liability report rather than re-deriving sums.
- Dev TOTP secret remains at `/tmp/opencode/admin-totp.json` (session-local, dev only).

## Commits (phase execution)

34 commits from `27d0bc9` (Phase 4 context lock) through `0db2775` (Plan 07 progress):
Plan 01–02 `a3150c7`…`56d1e38`; Plan 03 `d39e8b9`…`0aea8d8`; Plan 04 `3b742dc`…`ef5eeb7`;
Plan 05 `8aa777b`…`6173973`; Plan 06 `6897a25`…`973f00e`; Plan 07 `422c012`…`0db2775`.
This verification document and the evidence scripts are committed as
`docs(planning): verify phase 4 customers credit and loyalty`; the state update follows as
`docs(planning): update state for phase 4`.
