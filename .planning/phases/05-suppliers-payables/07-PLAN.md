---
phase: 05-suppliers-payables
plan: 07
wave: 7
title: Phase 5 verification and state update
requirements: [SUP-01..05, ADM-06]
depends_on: [06]
status: planned
created: 2026-10-19
---

# Plan 07 — Phase 5 Verification

**Goal:** Prove the phase goal on a fresh database — suppliers, invoices, payments, and
balances reconcile; duplicates, over-allocation, and unauthorized access are impossible;
the console tells the whole story — then record the evidence and update the project
state.

## Task 1 — Fresh-database cycle and full test suite

**Files:** none (execution); evidence noted in
`.planning/phases/05-suppliers-payables/01-VERIFICATION.md`

- Stop the API; reset the dev volume (`docker compose down -v` → `bun run db:up`); wait
  for health; `bun run db:migrate`; `bun run db:seed`; `bun run db:seed --demo` **twice**
  (idempotency: second run creates nothing, counts unchanged); `bun run db:test:prepare`;
  `bun run lint`, `bun run check-types`, `bun run test`, `bun run build`.
- Restart the API and re-bootstrap the admin TOTP secret
  (`/tmp/opencode/admin-totp.json`) like Phase 4's cycle.
- Record the exact command list and outcomes in `01-VERIFICATION.md`.

**Verify:** every command green; `\dt` shows the new tables;
`SELECT count(*) FROM supplier_invoice` matches the seed both times.
**Commit:** `chore: record phase 5 verification setup` (only if incidental files change)

## Task 2 — API + SQL walkthrough

**Files:** `.planning/phases/05-suppliers-payables/evidence/walkthrough-payables.mjs`

- Fresh-DB-only script (asserts exact `SINV-00001`/`PAY-00001` values like Phase 4's
  walkthrough) driving `http://localhost:4000` with trusted `Origin` headers, then SQL
  assertions through `docker compose exec` psql. Sections and asserts:
  1. **Auth/permissions:** admin login; cashier token → 403 on suppliers/payables;
     manager → supplier.create/archive 403, own-branch invoice/payment ok,
     another branch → 403; admin-only settings write; archived supplier selection → 409.
  2. **Supplier master:** create (phone `024…` → `+233…`), list search by name fragment
     and code, update, payment details (bank + MoMo; default switch leaves exactly one
     active default; duplicate `(method, account)` 409; list payload shows masked
     numbers only), product mappings (duplicate 409; preferred switch; archived product
     409).
  3. **Receipt → invoice:** create a receipt with `supplierId` (snapshot name set);
     record the invoice with `copyFromReceipt`; assert `subtotal + vat + nhil + getfund
     === total === receipt total`; assert `receiptId`/`supplier_id` links both ways;
     second invoice on the same receipt → 409; duplicate supplier invoice number → 409
     returning the existing id; same idempotency key replay → same invoice id
     (and a parallel same-key race returns one row).
  4. **Standalone invoice:** description-only freight line, no tax, custom `dueDate`;
     invalid inputs (no lines, both product and description, due before invoice date)
     → 400.
  5. **Payments:** partial allocation (assert `amount_paid_minor`, status `PARTIAL`,
     outstanding math); over-allocation → 409 naming the invoice; cross-supplier and
     VOID-invoice allocations → 409; multi-invoice payment; on-account remainder
     (assert balances `onAccountMinor`); settle to `PAID`; two parallel payments on one
     invoice never over-allocate.
  6. **Voids:** payment void → RELEASE rows equal and opposite, invoice flips back,
     balances restore, re-void → 409; invoice void with allocations → 409; void an
     untouched invoice and re-enter its supplier number successfully.
  7. **Aging and reconciliation:** as-of date in the past buckets seeded invoices
     (assert each bucket); totals = sum of supplier rows; SQL proves per invoice
     `amount_paid_minor = SUM(signed allocations)`, VOID invoices at zero net, and per
     supplier+branch claimed balances equal an independent SQL sum; `SELECT` audit rows
     for every Phase 5 action kind.
- Output a pass/fail summary in the Phase 4 walkthrough style; save raw output under
  `evidence/`.

**Verify:** the script runs end-to-end on a fresh database with 0 failures; failures
during development are fixed by code changes, not by weakening asserts.
**Commit:** `test(api): add phase 5 payables walkthrough`

## Task 3 — Browser walkthrough

**Files:** `.planning/phases/05-suppliers-payables/evidence/smoke-console-suppliers.mjs`

- Playwright script (channel chromium, `SHOTS_DIR` → `evidence/`) run after Task 2 on
  the same fresh database; auto-handles forced TOTP like the Phase 4 script:
  1. Admin: Suppliers list → create supplier (invalid phone shows inline error; valid
     saves); search finds it; open detail; add a bank payment detail and a MoMo detail,
     switch default (assert the badge moves); add a product mapping; assert last cost
     renders `formatGhs`.
  2. Inventory: Receipts tab → receive stock with the supplier picker → open the receipt
     → "Record supplier invoice" → the form is pre-filled from the receipt (assert the
     totals card equals the receipt total and the derived tax split is non-zero).
  3. Save the invoice; assert the detail shows the linked receipt card and zero
     allocations.
  4. Record a partial payment with the allocation editor (assert the on-account
     remainder); assert the invoice flips to PARTIAL and the payment appears in the list
     with its allocation history.
  5. Void the payment (reason) → assert the invoice returns to OPEN and the detail shows
     the release rows.
  6. Aging page: assert the invoice outstanding appears in the expected bucket for an
     as-of date in the past.
  7. Archive guard: attempt to archive the supplier with debt → assert the readable 409;
     then void/settle and archive successfully.
  8. Settings: assert the Suppliers & Payables group exists for the admin; log in as a
     manager (seeded credentials) and assert the section is visible but create/archive
     controls are not.
- Screenshots at each step into `evidence/` with descriptive names.

**Verify:** all steps pass; screenshots readable; no console errors.
**Commit:** `test(admin): add phase 5 console walkthrough`

## Task 4 — Verification record and state update

**Files:** `.planning/phases/05-suppliers-payables/01-VERIFICATION.md`,
`.planning/STATE.md`, `.planning/ROADMAP.md`

- `01-VERIFICATION.md`: goal restated, the four roadmap success criteria each mapped to
  concrete evidence (commands, script outputs, SQL results, screenshots), the
  requirement trace (`SUP-01…05`, `ADM-06` → where implemented → how proven),
  deviations with justification, residual risks, and the human verification checklist
  (e.g. visual pass of the new screens, a real supplier invoice entry with a real
  product list).
- `STATE.md`: progress table (Phase 5 ✅ with plan count), "Phase 5 additions" section
  (schema, modules, sequences, console screens, seed story, verification numbers),
  decisions log entries for D1–D18 as implemented, updated Open Items (Phase 8 Paystack
  transfers consume `paystack_recipient_code` and the payment status enum;
  receipts/aging exports in Phase 8), session notes (walkthrough scripts are
  fresh-DB-only; payables invariants; how to rerun), and **Next action: plan Phase 6
  (POS Offline Core)**.
- `ROADMAP.md`: mark Phase 5 complete with the verification date.
- Commit the phase documents and evidence together (no secrets; screenshots only).

**Verify:** STATE/ROADMAP read correctly at a glance; every success criterion has a
citation; no lingering "planned" status for Phase 5.
**Commit:** `docs(phase-5): record verification and update state`

## Done When

A fresh database reproduces the whole AP story; the walkthroughs pass with 0 failures;
the four roadmap success criteria are each backed by a command output or screenshot; and
`.planning/` points at Phase 6 as the next step.
