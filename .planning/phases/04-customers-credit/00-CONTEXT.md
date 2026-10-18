---
phase: 04-customers-credit
name: Customers, Credit & Loyalty
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers]
requirements: [CUS-01..06, LOY-01..06, ADM-05]
status: planned
created: 2026-10-18
---

# Phase 4 — Customers, Credit & Loyalty — Locked Context

**Goal:** One customer identity across the business, branch-local credit with limits and
ledgers, and a global loyalty program with earning, redemption, and expiry.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Customer identity | One global `customer` table: full name (single field), phone (required, E.164, unique), optional email, optional free-text address, `created_branch_id` attribution, `status` ACTIVE/ARCHIVED, `anonymized_at`. Created at a branch, found everywhere by phone | CUS-01; criterion 1. Ghana stores sell by phone, not customer numbers |
| D2 | Phone normalization | `libphonenumber-js` (official libphonenumber port), region GH; accept `0XX XXX XXXX` and `+233…` input; store E.164. Unique index partial: `WHERE anonymized_at IS NULL` so a recycled number can be re-registered after erasure | Ghana numbering plan: 9-digit NSN, trunk prefix 0, +233 |
| D3 | Customer search | Phone match on normalized digits (suffix ≥ 4) OR name trigram (`pg_trgm` GIN index), archived hidden by default (admin toggle); result limit 20 | CUS-01 "searchable by phone/name"; pg_trgm GIN accelerates ILIKE '%…%' |
| D4 | Credit profile | Per customer+branch (`credit_profile`, unique pair): `limit_minor` (≥ 0, default 0), `hold`, `payment_term_days` (≥ 0, default 0 = due on demand), `notes`, `balance_minor` projection. Owned by the branch that granted it; never merged across branches | CUS-02; PROJECT locked decision (branch-local limit/balance) |
| D5 | Credit ledger | Append-only `credit_ledger_entry`, signed `amount_minor` (never 0): CHARGE +, REPAYMENT −, REFUND −, ADJUSTMENT ±. Each row: customer, branch, reason code, note, `due_date` (charge date + terms at posting), reference, idempotency key, actor, `occurred_at`. Balance is a projection | CUS-03; Phase 3 ledger pattern |
| D6 | Repayment settlement | Oldest charge first, **derived on read** from the signed ledger (nothing extra stored); per-charge outstanding feeds statements and aging | Operator decision; append-only truth, no allocation state to corrupt |
| D7 | Overpayments | Allowed: a negative branch balance is customer credit at that branch, shown clearly. Balances are **never netted across branches** | Operator decision; branch-local money |
| D8 | Credit enforcement & override | New CHARGE blocked (409) when `hold` is set, or when resulting balance would exceed `limit_minor` — unless overridden: `credit.override` permission, reason code required, audited, recorded on the entry. Applies to one entry only | CUS-04; POS layers manager PIN offline in Phase 6/7 |
| D9 | Limit authority | Managers set limits, terms, and holds for their own branch; admin anywhere; fully audited | Operator decision; branch entitlement |
| D10 | Manual charges & opening balances | Managers can post a manual CHARGE (reference + reason `OPENING_BALANCE` / `CORRECTION` / `OTHER`) — the v1 path for onboarding existing debts. No import | Operator decision |
| D11 | Aging buckets | Fixed: Current (not yet due) / 1–30 / 31–60 / 61–90 / 90+ days past due, measured from `due_date`; as-of date parameter; per customer+branch and per-branch report | Operator decision; standard AR aging |
| D12 | Statements | Per customer+branch: date range, opening balance, entries (kind, reference, due date, description, signed amount), closing balance, aging summary. Printable A4 page via browser print; CSV/PDF export is Phase 8 | CUS-06 "printable"; operator decision |
| D13 | Loyalty account | One global account per customer (1:1, created with the customer): `balance_points` projection. Earn and redeem at any branch | LOY-01; PROJECT locked decision |
| D14 | Loyalty ledger & lots | Append-only `loyalty_ledger_entry`: EARN +, REDEEM −, CLAWBACK − (returns), ADJUST ± (reason code), EXPIRE − (job). Every EARN creates `loyalty_lot` (points, remaining, `expires_at` = earn + expiry months). Redemption consumes lots **earliest-expiry first** (FEFO), per-lot consumption rows are append-only. Lots never go negative | LOY-02; operator decision (lot-based, earliest-expiry first) |
| D15 | Earn rule | `loyalty.earnPointsPerCedi` points per full GHS of net merchandise **paid**, excluding tax and redemption; **floor per sale, no carry** | LOY-03; operator decision |
| D16 | Redemption | `loyalty.pointsPerCedi` (default 100 points = GHS 1) and new `loyalty.minimumRedeemPoints` (default 100); whole points ≥ minimum; applied as a discount before tax (POS, Phase 6/7). Engine and rates live in Phase 4 | LOY-04; operator decision |
| D17 | Expiry | Lot-based, default 12 months (`loyalty.expiryMonths`). Daily pg-boss job (Africa/Accra, `missed: 'once'`) writes EXPIRE entries for lots past expiry. Changing the setting never alters existing lots. Admin-triggerable run for operations and verification | LOY-05; operator decision; pg-boss cron docs |
| D18 | Liability report | Outstanding points = sum of lot remainders, valued at the redemption rate (pointsPerCedi → GHS), plus point activity (earned/redeemed/expired/adjusted/clawed back) for a date range. Admin all branches; manager own branch, read-only; negative balances listed for review | LOY-05; operator decision |
| D19 | Returns clawback | Returns post CLAWBACK for the returned merchandise's points (proportional to amount paid). Clawback consumes lots FEFO up to what remains; any shortfall makes `balance_points` negative and is flagged (admin review queue). No buy-return farming | Operator decision; POS return flow is Phase 7 |
| D20 | Permissions (new) | `customer.read`, `customer.create`, `customer.update`, `customer.archive`, `customer.anonymize` (admin only), `credit.read`, `credit.profile.manage`, `credit.repayment`, `credit.adjust`, `credit.override`, `loyalty.read`, `loyalty.adjust`, `loyalty.settings` (admin only). Manager: all except the two admin-only ones, branch-scoped; admin: all; cashier: none in Phase 4 (POS sync in Phase 6) | Mirrors Phase 3 D8; operator decisions on authority |
| D21 | Jobs infrastructure | pg-boss v12 installed in Phase 4 (`api/src/jobs/`): boss instance + worker in the API process, `pgboss` schema auto-installed at boot; first queue `loyalty-expiry` scheduled daily; manual admin trigger endpoint. Reused by later phases | Operator decision; locked stack; pg-boss docs |
| D22 | Module layout | Three API modules in the seven-file layout: `customers` (identity, search, archive/anonymize), `credit` (profiles, ledger, enforcement, repayments, statements, aging), `loyalty` (accounts, ledger/lots, engine, expiry, liability). Dependency direction (acyclic): `credit → customers`, `customers → loyalty` (account bootstrap on customer create), `jobs → loyalty.service` | Matches AGENTS.md; mirrors Phases 2–3 |
| D23 | Concurrency & idempotency | Credit postings lock the profile row (`SELECT … FOR UPDATE`) before computing balance and enforcement; loyalty postings lock the account row; lot consumption sorted by `(expires_at, earn_entry_id)` to avoid deadlocks; computation in TypeScript. Every entry carries a client idempotency key, unique per branch; replays return the existing entry | Phase 3 D16 pattern; POS outbox contract |
| D24 | Repayment references | Repayment entries get sequenced references (`credit.repaymentPrefix` default `REP`, pad 5) through the settings-sequence mechanism; other kinds carry the operator/POS reference | Mirrors Phase 3 D11; statements need human references |
| D25 | Settings additions | `loyalty.minimumRedeemPoints` (int ≥ 1, default 100); `credit.repaymentPrefix` (default `REP`) + `credit.repaymentSequence`; tighten `loyalty.earnPointsPerCedi` to integer ≥ 1. Existing loyalty keys reused | LOY-04; Phase 3 D11 pattern |
| D26 | Demo seed | `db:seed --demo` gains idempotently: three customers (one with an ACC-SPX credit profile + opening charge + repayment, one with loyalty points and a lot, one plain). Verification creates the rest | Phase 3 D18 pattern |
| D27 | DPA handling | Ghana DPC obligations: register as data controller (operator gate), purpose limitation, minimization, security. **Archive** (admin) hides the customer and blocks new charges; repayments still allowed to collect debt. **Anonymize** (admin, `customer.anonymize`) requires zero balance across all branches, scrubs name/phone/email/address, keeps both ledgers intact; audited. No PII in logs | Ghana Data Protection Act 2012 (Act 843); operator decision |

## Refinements to approved answers (flagged for operator review)

Two mechanics were pinned during planning; intent is unchanged:

1. **D14/D19 lot mechanics:** clawback consumes live lots FEFO like a redemption; when
   the lot balance cannot cover it, the ledger balance goes negative (the approved
   "flagged for admin review") while lots clamp at zero. The balance is always the sum
   of the ledger; lots track expiry, not debt.
2. **D17 tie-break:** lots expiring on the same day consume oldest-earned first
   (`expires_at`, then `earn_entry_id`) so consumption is deterministic.

## Architectural Invariants (do not violate)

- **Append-only credit and loyalty truth.** No repository function updates or deletes a
  ledger entry; corrections are compensating entries with reason codes.
- **Balances are projections.** `credit_profile.balance_minor = SUM(amount_minor)` per
  customer+branch; `loyalty_account.balance_points = SUM(points_delta)`.
  `loyalty_lot.remaining_points` is derived from append-only consumption rows. All three
  are provable by reconciliation functions and tests.
- **Integer everything.** Money is integer pesewas; points are integers; no floats in
  money or points math.
- **Server is authoritative.** Limits, holds, enforcement, points math, expiry, and
  permissions are decided in the API; the console only renders.
- **Audit in the same transaction** as every mutation (customer changes, profile
  changes, every ledger entry, overrides, expiry runs), exactly like Phases 1–3.
- **Fail closed.** Managers act only on their branch's credit and their own activity;
  customer identity and loyalty are global to read; anonymize and loyalty settings are
  admin-only.
- **No PII beyond the customer record.** Logs, audit entries, and list responses carry
  identifiers, never phone/name payloads. Anonymized customers keep financial history
  without PII.

## Verified Research (see 01-RESEARCH.md)

- Ghana's numbering plan: +233, 9-digit national numbers, trunk 0 (`024…`); mobiles on
  020/023–028/050/053–059 — parse and validate with `libphonenumber-js`, store E.164.
- `pg_trgm` GIN indexes make name/phone substring search fast without left-anchoring
  (PostgreSQL 17 docs).
- pg-boss v12: `boss.schedule()` cron/RRULE, minute precision, `missed: 'once'` catch-up
  for missed nightly runs, `pgboss` schema auto-install, Drizzle adapter available.
- PowerSync Sync Streams: subscription/auth parameters enable branch-scoped sync — the
  Phase 6 POS filters `credit_profile.branch_id` and uses a global customer table with
  `created_branch_id`; loyalty is global. Column shapes chosen now for that contract.
- Ledger + disposable projection, oldest-first settlement, and lot FEFO consumption are
  the settled patterns (extension of Phase 3 research to AR and loyalty).

## Bootstrap Order

1. Schema, migration, settings, permissions, phone helper, demo seed (Plan 01).
2. Customers module: create, search, read, update, archive, anonymize (Plan 02).
3. Credit module: profiles, ledger engine, enforcement + override, repayments,
   adjustments, aging, statements (Plan 03).
4. Loyalty module: account, ledger/lots engine, earn/redeem/clawback/adjust, liability
   (Plan 04).
5. pg-boss infrastructure + expiry job + manual trigger (Plan 05).
6. Console: customers list/profile + credit (ledger, repayments, limits, statements,
   aging) (Plan 06).
7. Console: loyalty tab, adjustments, liability report, settings; evidence script
   groundwork (Plan 07).
8. Phase verification: walkthrough, browser smokes, evidence, state update (Plan 08).

## Open Items (carry into later phases)

- Phase 6: POS sync scope for customers/credit/loyalty (sync streams config), offline
  customer creation by phone with idempotency, cached limit and points, conflict flags
  for oversell-over-limit and loyalty double-spend.
- Phase 7: POS repayment flow (CUS-05), Paystack-verified electronic repayments, refund
  payouts.
- Phase 8: statements/reports CSV+PDF exports, aging and liability report presentation,
  negative-loyalty-balance review queue.
- Phase 9: DPC registration and retention policy review (operator gates).
