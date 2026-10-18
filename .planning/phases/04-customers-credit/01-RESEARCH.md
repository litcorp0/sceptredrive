# Research — Phase 4: Customers, Credit & Loyalty

**Researched:** 2026-10-18
**Sources:** Ghana Data Protection Commission (dpc.gov.gh — mandate, registration, for
organisations), Ghana National Communications Authority numbering plan (Wikipedia
Telephone numbers in Ghana), libphonenumber-js (official libphonenumber port), PostgreSQL
17 `pg_trgm` documentation, pg-boss v12 documentation (scheduling, database install,
jobs), PowerSync Sync Streams documentation (overview, parameters), Phase 2–3 codebase
patterns and research documents, plus this phase's 14 operator decisions (00-CONTEXT.md).

## 1. Customer identity and Ghana phone numbers

- Ghana numbers are **+233**, nine-digit national significant number, written with trunk
  prefix 0 (`024 123 4567`). Mobile ranges: 020, 023–028, 050, 053–059 (MTN, Telecel,
  AirtelTigo, Glo, Expresso). A Ghana customer identity keyed on phone must normalize
  `024…`, `23324…`, `+233 24…`, and spaced/dashed input to one E.164 form:
  `+233241234567`.
- **`libphonenumber-js` is the maintained JavaScript port of Google's libphonenumber** —
  the documented, battle-tested option. `parsePhoneNumberFromString(input, 'GH')`
  validates against live number rules and returns `.number` (E.164). Use it in the API
  for validation/normalization and in the console for input formatting; store only E.164.
- **Uniqueness vs erasure:** the phone must be unique among non-anonymized customers.
  A partial unique index (`WHERE anonymized_at IS NULL`) allows a recycled SIM's number
  to register fresh after a DPA erasure, without constraint conflicts.
- **Search:** phone is normalized digits — suffix search (`%34567`) is indexable by
  plain B-tree only left-anchored, so practical search combines an exact-digit match
  with `pg_trgm` GIN for both name and phone substrings. The PostgreSQL docs confirm GIN
  `gin_trgm_ops` accelerates `ILIKE '%…%'` and needs no left anchor. At 20k customers
  this is comfortably interactive. Enable the extension in the migration
  (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) — it is a trusted module.

## 2. Credit as an append-only ledger (accounts receivable)

- **Same settled pattern as Phase 3 stock:** immutable signed entries, balance as a
  disposable projection written in the same transaction, reconciliation by replay.
  `credit_profile.balance_minor = SUM(amount_minor)` for the customer+branch. Nothing
  in the credit module may update or delete an entry.
- **Signed-entry semantics:** CHARGE + (credit sale, opening balance, correction),
  REPAYMENT −, REFUND − (credit note for returned goods), ADJUSTMENT ± (write-off,
  dispute, correction). The sign carries the arithmetic; the kind carries the meaning —
  reporting sums by kind without CASE expressions on operands.
- **Settlement is oldest-first, derived.** Per-charge outstanding is computed by
  applying negative entries to charges in `occurred_at` order (a running allocation).
  Nothing is persisted, so there is no allocation state that can drift from the ledger —
  statements and aging are both pure functions of entries plus due dates.
- **Due dates and aging:** `due_date = charge date + payment_term_days` (0 = due on
  demand). Aging buckets are the industry-standard Current / 1–30 / 31–60 / 61–90 /
  90+ **days past due**; measuring from due date (not charge date) keeps the report
  consistent with the terms the branch granted.
- **Statements:** opening balance (sum of entries before the range) + ranged entries +
  closing balance + aging summary reads directly from the ledger. Printing is a
  browser-print A4 page in Phase 4; document PDF generation is a Phase 8 reporting
  concern (RPT-06).
- **Enforcement point:** the server checks `hold`, then `balance + charge ≤ limit`,
  inside the same locked transaction that writes the entry. An override is a property
  of the entry (`overridden`, reason code, actor) plus an audit entry — one approved
  over-limit charge, not a raised limit.
- **Concurrency:** `INSERT … ON CONFLICT DO NOTHING` to guarantee the profile row,
  then `SELECT … FOR UPDATE` on it, then compute and insert. Serializing on the profile
  row is correct because every credit invariant is per customer+branch (Phase 3 D16
  pattern, PostgreSQL explicit-locking docs).

## 3. Loyalty: lots, FEFO, and liability

- **Lot-based expiry is the standard loyalty model** when points expire: every earn
  creates a lot with its own expiry date; redemption consumes earliest-expiry-first
  (FEFO); expired remainders are written off by a scheduled job. This is what makes
  "12-month expiry" implementable without ever rewriting history.
- **Two truth layers:** the append-only ledger (`points_delta`) is the balance truth;
  lots plus per-lot consumption rows are the expiry truth. `remaining_points` is a
  projection of consumption rows, exactly like `stock_level` is of movements.
  Reconciliation: `SUM(points_delta) = SUM(lot.remaining_points)` in normal states;
  a clawback shortfall is the only documented divergence (balance negative, lots at
  zero) and is flagged for admin review.
- **Earn math:** integer points per full GHS of net merchandise paid, floor per sale —
  `points = floor(net_paid_minor × earnPointsPerCedi / 100)`. Excluding tax and
  redemption keeps the base "what the customer actually paid for goods". No carry
  avoids per-customer fractional state for a rounding gift.
- **Redemption math:** `pesewas = floor(points × 100 / pointsPerCedi)` recomputed from
  settings at redemption; minimum redemption setting bounds micro-redemptions. Applied
  as a discount before tax in Phase 6/7 — the Phase 4 engine exposes `quoteRedeem` so
  the POS can display and validate the same numbers.
- **Expiry job:** lots where `expires_at <= now` and `remaining_points > 0`, grouped
  per account, one EXPIRE ledger entry per account+run with per-lot consumption rows in
  the same transaction. Re-running is a no-op (no remaining lots due) — safe for
  `missed: 'once'` catch-up and manual triggers.
- **Liability report:** outstanding points × redemption rate in pesewas = the deferred
  value the business owes customers; plus period activity per branch. Global account,
  branch-attributed activity.

## 4. Background jobs with pg-boss v12

- **The locked stack already includes pg-boss** (`PROJECT.md`); Phase 4 is its first
  consumer. v12 documentation:
  - `boss.schedule(name, cron, data, { tz, missed })` registers a cron (or RRULE)
    schedule; occurrences are checked every 30 s; minute precision is fine for a
    nightly job. `missed: 'once'` sends **one catch-up job** when the deployment was
    down at the scheduled minute — correct for idempotent nightly sweeps.
  - The `pgboss` schema is auto-created on first use (needs CREATE privilege on the
    database) or installed via the CLI; our dev/prod Postgres role has it.
  - Workers are backpressure-aware polling consumers; a single API process runs the
    schedule + worker (single-instance deployment), and `boss.stop()` participates in
    graceful shutdown.
  - The docs' testing utilities (including clock control) let integration tests drive
    schedules without waiting.
- **Design:** `api/src/jobs/` owns the boss instance, a tiny job registry, graceful
  start/stop wired into the API bootstrap, and the `loyalty-expiry` queue whose handler
  calls `loyalty.service.expireDueLots()` — the same function behind the admin trigger
  endpoint, so operations and tests exercise one code path.

## 5. Ghana Data Protection Act (Act 843) mapped to design

- The Data Protection Commission (dpc.gov.gh) is the regulator; **all data controllers
  and processors must register** with the Commission, and the Act's principles bind
  processing: purpose specification, lawful basis/consent, minimization, accuracy,
  security safeguards, and retention limits; data subjects have access, correction, and
  deletion rights where no lawful retention basis exists.
- Design consequences (D1, D27):
  - Collect the minimum: name, phone, optional email/address. No ID photos, no second
    identifiers, no marketing flags in v1.
  - **Archive** stops new charges but keeps the ability to collect debt (a lawful
    processing purpose: contract/legal claim). **Anonymize** is the erasure path: PII
    is irreversibly removed while financial ledgers — which the business must retain —
    keep only the internal identifier. Audit records the who/when.
  - Registration and retention-policy review are operator gates (Phase 9), not code.

## 6. PowerSync forward-compatibility (Phase 6 contract)

- Sync Streams filter rows with subscription and auth parameters
  (`subscription.parameter('branch_id')`, JWT claims) — branch-scoped streams are
  first-class. Column shapes this phase must guarantee:
  - `credit_profile.branch_id` → terminals subscribe "my branch's credit profiles".
  - `customer.created_branch_id` → optional stream scoping; global phone lookup stays a
    server-side concern until Phase 6 decides sync-vs-lookup for 20k customers.
  - `loyalty_*` tables are global; entries carry `branch_id` for branch activity views.
  - Ledger entries carry `reference_number`/`occurred_at` so the POS can show offline
    history without joins (same contract as Phase 3 movements).
- No sync code is written in Phase 4; the schema and services are the contract.

## 7. Reused infrastructure (verified in codebase)

- `SETTING_DEFINITIONS` (settings.validation.ts) already holds `loyalty.earnPointsPerCedi`,
  `loyalty.pointsPerCedi`, `loyalty.expiryMonths`; the sequence mechanism (settings +
  `*Sequence` keys) is proven in staff IDs and inventory references.
- RBAC: `PERMISSIONS`/`ROLE_PERMISSIONS` in `packages/shared`; `resolveBranchFilter`,
  `assertBranchAccess`, `requirePermission` middleware in `api/src/http`.
- Audit (`writeAudit`) and the seven-file module layout are established; Phase 4 adds
  three modules following them, plus `api/src/jobs/` for infrastructure.
- The API test suite runs against a migrated Postgres (`db:test:prepare`); ledger
  reconciliation and concurrency tests follow the Phase 3 style.
