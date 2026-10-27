# Phase 14 — Decisions

**Date:** 2026-10-27
**Status:** locked for planning
**Supersedes:** `00-CONTEXT.md` where the two disagree. The context's D1–D11 are the
frame; this file refines them, and the numbered notes at the end record every place the
frame was wrong.

Forty-seven decisions. Each is a choice this phase will be judged against, not a
suggestion. Where a decision closes a defect in the locked context, the note after the
table says which.

**Three were put to the operator and answered on 2026-10-27:** no approval threshold for
supplier transfers (D32); a reversal never un-posts a payment, a manager voids it (D46);
feature flags are typed boolean settings, not a second store (D41). The rest are
engineering decisions within the locked frame.

---

## A. Scope and boundaries

| # | Decision | Choice |
|---|---|---|
| P14-D1 | Scope | The locked D1 list stands — POS oversight, conflict resolution, the four remaining reports, supplier Paystack transfers, E-VAT with a mock, and users/settings/audit. **Terminals, devices and enrolment are not rebuilt**: they exist and are tested (`org/terminals.routes.ts`, `admin/src/modules/terminals/`), so this phase proves them with the permission matrix instead. **Phase 9's dashboard, sales, tax and product reports are not rebuilt.** Two Phase 13 carry-forwards are taken: the printed Z's drawer itemisation and the till's `NOT_OWNER` close. |
| P14-D2 | Two different questions | The analytics screens answer *how much and how many*; oversight answers *which document*. The oversight lists never aggregate, and the analytics sales tab gains one link per row to the oversight detail rather than a second table. |
| P14-D3 | Where oversight lives | `api/src/modules/pos/` grows `pos.oversight.repository.ts` and `pos.oversight.service.ts` behind new routes in `pos.routes.ts`. **No new API module.** `pos.schema.ts` owns every table an oversight read needs, and a second module reading and writing those tables would break the one-owner rule for `sync_conflict`. |
| P14-D4 | Where oversight lives, client | A twentieth admin module, `pos-oversight`, deferred from Phase 8 (`08-admin-modules-shell/13-PLAN.md:171`). One nav section `/pos` with a `tab` search param for sales, refunds, shifts and conflicts — four top-level entries for one domain is noise. |

## B. Permissions and authority

| # | Decision | Choice |
|---|---|---|
| P14-D5 | New permissions | Six: `pos.oversight.read`, `conflict.read`, `conflict.resolve`, `payable.transfer`, `evat.read`, `evat.retry`. All but `evat.retry` go to ADMIN and MANAGER. `CASHIER` stays an empty array, unchanged. |
| P14-D6 | Reports permissions | Report and export routes reuse the owning module's permission — `inventory.read`, `credit.read`, `payable.read`, `loyalty.read`, `audit.read`. A `report.read` would be a second gate on data the role already holds, and the first thing to drift out of sync. |
| P14-D7 | Conflict authority | A manager resolves conflicts on their own branch only; an admin resolves any. `resolveBranchFilter` decides, and a cross-branch id is a 403, not a 404 that leaks existence. |
| P14-D8 | Transfer authority | Initiating, finalising and creating a recipient all need `payable.transfer`. Manual payments keep `payable.payment` and are unchanged. The two are separate because a transfer moves money out of the Paystack balance and can be revoked without disabling the fallback. |
| P14-D9 | No admin TOTP reset | The locked D7 names password and PIN resets. It does **not** gain an admin-driven TOTP reset: the only safe recovery for a lost second factor is a supported self-service path plus a documented operator procedure. Writing one that disables 2FA for someone else is a privilege-escalation surface with no v1 need. |

## C. Oversight

| # | Decision | Choice |
|---|---|---|
| P14-D10 | What "receipt reprint" means | `GET /api/pos/oversight/sales/:id/receipt` renders a **server-side copy** from server columns; the console displays it in an 80 mm-shaped component and the browser prints it. A paper reprint from the till's thermal printer stays where it is (`print-sale.ts`, `reprint_count`). The console copy is labelled *Copy of receipt — not a till reprint*, because the server does not know the till's print status and must not pretend to. |
| P14-D11 | Customer PII on the copy | Name and a masked phone (`••••1234`), never the full number. The same rule covers every oversight screen. CSV never carries either. |
| P14-D12 | Shift oversight | A closed shift shows the **stored Z** and refuses to rebuild it (Phase 13's rule, now reachable by a session). An open shift shows a **live X**. Both come from one arithmetic function with two gates — the existing device route and a new session route — so a manager and a cashier cannot read two different drawers. |
| P14-D13 | Conflict resolution is a record, not a repair | `PATCH /api/pos/oversight/conflicts/:id` writes `status`, `resolution_code`, `resolution_note`, `resolved_by`, `resolved_at` and one audit row. It never touches `sale`, `refund`, `stock_movement`, `credit_ledger_entry` or `loyalty_ledger_entry`. A correction is a new document, in this phase as in every other. |
| P14-D14 | Resolution vocabulary | A new enum `conflict_resolution_code`: `CONFIRMED`, `CORRECTED_ELSEWHERE`, `ACCEPTED_RISK`, `TILL_INSTRUCTION`, `DUPLICATE`. `RESOLVED` requires a code; `DISMISSED` requires a code **and** a note. A resolution with no code is a shrug with a timestamp. |
| P14-D15 | Orphaned payments | A `PAYMENT_LATE_SETTLEMENT` conflict is resolved with a note that names the till action; the money is **claimed on the terminal that owns the payment** (`POST /api/pos/payments/:id/claim`, already built and device-gated). The console does not gain a claim button: claiming a payment from a different terminal than the one that created it is how a payment gets applied twice. |

## D. Reports

| # | Decision | Choice |
|---|---|---|
| P14-D16 | Stock report is a snapshot plus a period | On-hand and value at average cost come from the `stock_level` projection **now**; movements, transfers and counts are filtered by the period. There is no historical valuation. A past-dated valuation would have to replay the ledger's integer rounding and would disagree with the projection by a few pesewas — a report that quietly disagrees with the dashboard is worse than one that says "as at now". |
| P14-D17 | Branch scope | An admin may run any report across all branches; rows carry the branch. A manager is scoped to their own branch and a cross-branch id is a 403. **No export collapses to a `TOTAL` row** — that is the Phase 9 defect (`analytics.service.ts:927-959`) and this phase does not reproduce it. |
| P14-D18 | Movement filter | `inventory.validation.ts`'s movement `type` filter gains `SALE`, `WRITE_OFF`, `SUPPLIER_RETURN` and `RETURN`. A movement report that cannot show the largest outflow is not a report. |
| P14-D19 | Export ownership | Each module exports its own read through `GET /api/<domain>/<report>/export`, using `packages/shared/src/csv.ts`. 50 000 rows, `no-store`, `text/csv; charset=utf-8`, filename `sceptre-<report>-<branch|all-branches>-<from>-<to>.csv`. |
| P14-D20 | Print | Browser print only — `window.print()` and a print-only sheet. No PDF generator, no headless renderer. Every printed page states its period, branch, as-of (where relevant), generation time and who generated it, because a printed report outlives the tab it came from. |
| P14-D21 | Loyalty liability is as-of-now | Outstanding points are a live projection; an `asOf` would have to model which lots had expired by then, and a wrong liability figure is a tax problem. The report carries its timestamp and says so. `from`/`to` continues to filter the *activity* section only. |

## E. Supplier transfers

| # | Decision | Choice |
|---|---|---|
| P14-D22 | The provider intent is a new entity | A new `supplier_transfer` (plus `supplier_transfer_allocation`) records what we asked Paystack to pay. **`supplier_payment` keeps its shape and stays the only ledger fact.** A supplier is marked paid when `transfer.success` posts a `supplier_payment` through the same allocation core the manual form uses — not at initiation. |
| P14-D23 | Why not a `PENDING` supplier payment | Reusing `supplier_payment` with a new `PENDING` status would put un-moved money into the invoice projection, the aging buckets and `reconcilePayables`, all of which derive status from allocations. A failed transfer would leave a supplier paid in our books. The split mirrors Phase 13's `payment` (intent) versus `sale_tender` (money), on purpose. |
| P14-D24 | Statuses | `PENDING`, `AWAITING_OTP`, `SUCCESS`, `FAILED`, `REVERSED`, `BLOCKED`, `REJECTED`. Paystack's `otp` is a real state, not an error: with "Confirm transfers before sending" enabled, **every** transfer starts there. `POST /api/payables/transfers/:id/finalize` accepts the OTP and calls `/transfer/finalize_transfer`. |
| P14-D25 | Settlement is idempotent twice over | The transfer reference is server-minted (`sdt-<uuid>`, 16–50 chars, Paystack's alphabet) and the settled payment's `idempotency_key` is `transfer:<transferId>`, which the existing `unique(branch_id, idempotency_key)` already enforces. A replayed webhook inserts one `payment_event` and changes nothing else. |
| P14-D26 | Allocation shortfall | Settlement re-reads each invoice's remaining balance. What still fits is allocated; the remainder is on account; the difference between the plan and the posting is written to the audit row and shown in the reconciliation view as `unallocatedMinor`. A succeeded transfer never fails to post because an invoice was paid by hand meanwhile — but nobody may believe the plan was the outcome. |
| P14-D27 | Recipients are per payment detail and go stale | The `recipient_code` is stored on `supplier_payment_detail` and created on demand. **Any change to `method`, `account_number`, `bank_code`, `bank_name`, `momo_network` or `phone` clears it**, forcing a new recipient. A stale recipient code is money sent to an account the supplier has closed. |
| P14-D28 | Secrets and recipient codes | The recipient code is never returned by the supplier API (the existing view already omits it), never logged, and never in a CSV. Logging stays `{ provider, endpoint, status, durationMs }`. |
| P14-D29 | Balance and fees | `GET /balance` is read before a transfer and shown in the console; an insufficient balance refuses **before** creating a transfer row. Fees are Paystack's, not the supplier's: the reconciliation compares `transfer.amount` to `payment.amountMinor` and never nets a fee into either. |
| P14-D30 | Events | The webhook route gains `transfer.success`, `transfer.failed`, `transfer.reversed`. They reuse `payment_event` (the provider-event ledger) with a new nullable `supplier_transfer_id`. Unknown events stay `IGNORED` with a 200. |
| P14-D31 | Manual stays the fallback | No manual path gains a Paystack dependency. The catch-up sweep verifies any transfer older than 10 minutes through the same `verify` call a poll would use — one state machine, two callers. |
| P14-D32 | No approval threshold | A supplier transfer needs the permission, a recipient, an idempotency key and an audit row — the same guard as a manual payment, which managers already hold. A threshold would be a new money policy, and this phase stops and asks rather than inventing one. |
| P14-D46 | A reversal never un-posts a payment | `transfer.reversed` marks the transfer and raises an attention item in the reconciliation; the posted `supplier_payment` stays. Voiding it is a manager's act through the existing `voidPayment` path, with a reason and an audit row. A webhook is not an authority to reverse a ledger entry, and a reversed transfer whose payment silently disappeared would be indistinguishable from a payment that never existed. |
| P14-D47 | The sweep verifies, it never finalises | A 15-minute job verifies every `PENDING` or `AWAITING_OTP` transfer older than 10 minutes through the same `verify` call a poll uses. It **never** calls `finalize_transfer`: an OTP is a human's second factor, and a job that guesses it is a job that can drain the balance. |

## F. E-VAT

| # | Decision | Choice |
|---|---|---|
| P14-D33 | The adapter is a seam, not an integration | `EInvoicingProvider` has `healthCheck()` and `certify(document)` returning either a certification or a coded refusal. A `MockEInvoicingProvider` ships. No GRA HTTP client is written: the published integration document is behind an onboarding portal and changes between versions, and an untestable client is worse than a named gap. |
| P14-D34 | Certification never touches the document | Certificates live in `evat_submission`, never as columns on `sale` or `refund`. After certification `sale` and `refund` are byte-identical — the same invariant Phase 13 proved for refunds, now provable for certification. |
| P14-D35 | The certificate contract | The fields GRA returns are stored under our names: `provider_invoice_number`, `sdc_id`, `serial`, `signature`, `internal_data`, `machine_code`, `stamped_at`, `qr_payload`. The API's receipt copy composes `qr_payload` only from those bytes — it never invents a URL. |
| P14-D36 | State machine and retry | `QUEUED → SUBMITTING → CERTIFIED`, with `RETRY` (attempt > 0, `next_attempt_at` set) and `ATTENTION` (refused with a code, or the ladder exhausted). Backoff 1, 2, 5, 15, 60, 240, 720 minutes, capped at 8 attempts. **The 24-hour deadline is never a status**: `due_at` is the boundary and `overdue` is derived from it, so a row can be retrying and overdue at the same time — which is exactly the state an operator needs to see. |
| P14-D37 | Refunds depend on their sale | A refund submission waits for its sale's certification (`WAITING_FOR_INVOICE`) rather than failing. A `REFUND` naming an uncertified invoice is GRA error `E701`; retrying it forever would be a self-inflicted outage. |
| P14-D38 | Seller identity | Two global settings, `tax.sellerTin` and `tax.sellerVatNumber`; the branch's `code`, `name`, `city`, `area`, `address` and `phone` are the location. No TIN column on `branch`: the company holds one TIN, and a per-branch copy is a number that goes stale in one place. |
| P14-D39 | The paper waits | The receipt contract gains seller TIN/VAT and the E-VAT block, and prints them **only when present**. No QR is printed in this phase: the till prints before any submission exists, so a QR at the counter would be a placeholder masquerading as a certificate. ESC/POS QR support exists in the printer library and will be wired at GRA onboarding (Phase 15), not before. |
| P14-D40 | Failure never blocks trade | Submissions are enqueued **after commit**; a submission failure writes no conflict and no rejection. The console lists every submission with attempts, code and deadline, and an admin retries by hand. A document past 24 hours is flagged `overdue: true` and stays visible; the clock alone never moves it to `ATTENTION` — only a refusal or an exhausted ladder does. |

## G. Identity, flags and audit

| # | Decision | Choice |
|---|---|---|
| P14-D41 | Feature flags are typed settings | One registry, `packages/shared/src/flags.ts`, whose keys are `flag.*` entries in `SETTING_DEFINITIONS`: `flag.supplierTransfers`, `flag.evatSubmission`, `flag.posConflictResolution`. Boolean, global, admin-writable, audited by the settings path that already exists. A second boolean store with its own table, permission and audit trail is duplication, not architecture. |
| P14-D42 | The settings surface is generated | The console renders every key the API returns — all 46 today plus this phase's — grouped, searchable, with the effective value, its source (`branch`/`global`/`default`) and who may write it. No reset-to-default: writing the default value is not the same as having no row, and deleting the row destroys provenance. |
| P14-D43 | A global override is explicit | A branch-scoped key can still be set globally (that is what `source: global` means), but the console only offers it behind an explicit "all branches" confirmation and never because the branch switcher happened to be on "all". |
| P14-D44 | Audit export carries no payload | The CSV exports time, actor, action, entity, entity id, branch, request id and terminal — never `before`/`after`. Historic audit rows already contain customer email and phone (`staff.created`, `customer.created`, `customer.updated`); an export that fans that out is a data-protection incident with a download button. |
| P14-D45 | Mask going forward, never rewrite | The writers of the customer and staff audit payloads store a masked phone/email from this phase on. Rows written before it are left exactly as they are, and the limitation is recorded: mutating history to tidy it is the opposite of an audit log. |

---

## The thirteen defects this file resolves

Each is a place where implementing the locked context literally would have produced a
wrong system, a duplicated one, or a test that proves nothing.

1. **D2's "receipt reprint" has no server receipt to reprint.** The receipt is a desktop
   renderer over the local sale row (`render.ts:121-183`), and `print_status`,
   `reprint_count` and the physical printer exist only on the till. → **D10**: a
   server-rendered *copy*, browser-printed, labelled as a copy.
2. **D3's "the conflict snapshot before and after" does not exist.** `sync_conflict` has
   one `details` jsonb of ids and amounts, no before/after, and no `resolution_code`
   column at all. → **D13/D14**: the "before" is the row as found, the "after" is status
   + code + note, and the code gets a real column and a real enum.
3. **D5's "webhook-driven status" omits `otp`.** Paystack's own transfer docs: with
   "Confirm transfers before sending" enabled, the initiate response is
   `data.status: "otp"` and nothing moves until `finalize_transfer`. A phase that only
   listens for `transfer.success` would strand every transfer. → **D24**.
4. **D5 implies a transfer becomes a supplier payment when it is initiated.** That is the
   shape of `createPayment` today, and it would mark a supplier paid on a transfer that
   later fails or reverses, because `supplier_payment.status` is `COMPLETED | VOID`.
   → **D22/D23**: the intent is a separate entity and the ledger fact is written on
   success.
5. **D6's "receipts carry the reserved QR … fields" cannot be true at print time.** The
   till prints immediately after the sale, before any submission exists. → **D39**: the
   contract gains the fields; the paper prints them only when they are real.
6. **D4's "each reconciled to its ledger" is false for the exports that exist.** The
   inventory, credit, loyalty and payables CSVs are built from `byBranch`, which is empty
   for a manager, so a manager's export is a single `TOTAL` row. → **D17**.
7. **D2 re-plans the terminal and device inventory.** It is built, tested and gated
   (`org/terminals.routes.ts`, `admin/src/modules/terminals/**`). → **D1**: prove it, do
   not rebuild it.
8. **D7's "feature flags" has no store, and adding one duplicates settings.** →
   **D41**.
9. **D8's "every typed setting is editable" is not what the console does.** It renders 19
   of 46 keys, and an admin with no branch selected silently writes a *global* row for a
   branch-scoped key. → **D42/D43**.
10. **The stock report cannot filter sales movements.** `inventory.validation.ts:59-61`
    omits `SALE`, `WRITE_OFF`, `SUPPLIER_RETURN` and `RETURN` from the movement type enum
    even though the table has them. → **D18**.
11. **The printed Z does not itemise cash refunds, and there is no column to itemise
    them from.** `shift_report` has `refund_minor` (all refunds) and no cash figure, so
    the print cannot show the subtraction its expected-cash line performs. → the schema
    plan adds a nullable `cash_refund_minor`; **D1** takes the desktop fix.
12. **D11's "conflict resolution leaves the sale untouched" is only half of the
    invariant.** E-VAT certification is the other half: a certificate must not be a
    column on the sale. → **D34**.
13. **`00-CONTEXT.md`'s frontmatter lists Phase 9 as a dependency** while the roadmap
    lists Phases 5 and 13. Harmless, but it is what invites rebuilding the dashboard. →
    **D1**.

## Invariants this phase must not break

- Oversight reads; it never rewrites a sale, a refund, a shift, a movement or a ledger.
- A conflict resolution is an audit record with a code; the underlying fact is corrected
  by a new document or not at all.
- A supplier is paid when the money moved, not when we asked for it.
- A certificate is added beside a document, never inside it.
- Manual supplier payment works with Paystack unreachable, and a failed transfer never
  blocks one.
- A report reconciles to its ledger or it says which basis it uses.
- No secret, token, PIN, recipient code or customer phone leaves the system in a log, a
  CSV or a printed page.

## Security acceptance criteria (OWASP Top 10:2025)

| Risk | This phase's control |
|---|---|
| A01 Broken access control | Six new permissions, every route gated server-side, `resolveBranchFilter` on every read, cross-branch id → 403, and an IDOR leg per new endpoint in the walkthrough. |
| A02 Security misconfiguration | `EVAT_*` and transfer settings fail closed; the mock settle route stays mounted only when `PAYSTACK_MODE=mock`. |
| A04 Cryptographic failures | The webhook keeps HMAC-SHA512 over raw bytes; the E-VAT security key is env-only, never stored in a row the console can read. |
| A05 Injection | Zod `.strict()` on every body and query; CSV through `csvCell`; no SQL string interpolation, including the report's filters. |
| A08 Integrity | Webhook replay is idempotent by body hash and by `transfer:<id>`; a settlement cannot post twice. |
| A09 Logging | Every resolution, transfer transition, retry and export is audited with actor, branch and before/after where a before exists; PII is masked going forward. |
| A10 Exceptional conditions | A failed provider call leaves a `PENDING` intent with a retry, never a paid supplier; a failed submission never blocks a sale and never disappears. |
