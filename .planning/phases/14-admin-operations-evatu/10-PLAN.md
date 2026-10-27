---
phase: 14-admin-operations-evatu
plan: 10
title: Console — supplier transfers, the reconciliation view, the E-VAT surface
lane: admin
depends_on: [06, 07]
requirements: [PAY-04, PAY-06, EVAT-03]
---

# Plan 10 — Money out, and what happened to it

## Goal

A manager can start a supplier transfer from the payables screens, see whether the account
is ready, handle the OTP when Paystack asks for one, and read a reconciliation that
separates manual payments, settled transfers and money that left but did not post. An admin
can see every E-VAT submission, its attempts, its GRA code and whether it is overdue, and
retry one.

## Read first

- `00-DECISIONS.md` P14-D8, D22–D32, D36–D40, D46, D47.
- `01-RESEARCH.md` facts 35–47.
- `admin/src/modules/payables/**` — `pages/payments-page.tsx`, `pages/payment-detail-page.tsx`,
  `components/payment-form-dialog.tsx` (the allocation editor it reuses),
  `components/allocation-editor.tsx`, `components/payment-method-badge.tsx`,
  `api/payables.ts`, `types/index.ts:22`.
- `admin/src/modules/suppliers/components/payment-details-panel.tsx`,
  `payment-detail-dialog.tsx:220` — where `recipientReady` surfaces.
- `admin/src/modules/suppliers/pages/suppliers-layout.tsx` — the nested-route pattern.
- `admin/src/components/layout/sidebar.tsx:71-172`.
- `admin/src/lib/api.ts`, `admin/src/lib/toast.ts:8-29`.
- `packages/shared/src/transfers.ts`, `evat.ts` (Plan 01).

## Tasks

### 1. The transfer dialog

`payables/components/transfer-dialog.tsx`, opened from the payments page header and from a
supplier's payment detail row:

- supplier (fixed when opened from a supplier), branch, amount, payment detail limited to
  active `BANK`/`MOMO` rows with a `recipientReady` badge, allocation editor reused
  verbatim, note, and a read-only provider balance line from
  `GET /api/payables/provider-balance`. The dialog refuses to submit a transfer above that
  balance and says so before the request; the server refuses it again.
- one idempotency key per dialog session, regenerated on success, exactly as
  `payment-form-dialog.tsx:83-89` does.
- on submit the dialog stays open and becomes a **status panel**: `PENDING`,
  `AWAITING_OTP` with an OTP field and a "Finalise" button, `SUCCESS` with a link to the
  posted payment, or the failure words with a "Try again" that opens a **new** dialog (a new
  idempotency key, a new reference).
- a 409 `INSUFFICIENT_PROVIDER_BALANCE` renders the two figures from the error details, not
  a generic toast.

### 2. The transfer list and detail

`/suppliers/transfers` — number (our reference), supplier, branch, amount, status badge,
created, settled, failure code. Filters: status, supplier, branch, period.

`/suppliers/transfers/$transferId` — the transfer, its plan (invoice, amount), the payment
it posted (link) or "not posted", `unallocatedMinor` when non-zero, the provider's own
`transferCode`, and the audit-style history (created → initiated → finalised → settled), all
from the API's detail payload.

`TransferStatusBadge` renders `TRANSFER_STATUS_LABELS` and treats `AWAITING_OTP` as
attention (not failure) and `REVERSED` as danger.

### 3. The reconciliation view

`/suppliers/reconciliation` — one table with a state column:

| State | Row |
|---|---|
| `manual` | a supplier payment in the period with no transfer — the fallback working |
| `settled` | a transfer with its payment, amount and posted amount side by side, `unallocatedMinor` |
| `unposted` | a succeeded transfer with no payment (should never exist) or a failed/blocked/rejected/reversed one |

Headline tiles: `settledMinor`, `manualMinor`, `unpostedMinor`, `failedCount`,
`reversedCount`. A `REVERSED` row that still has a payment says, in words: *"The money
returned. The payment stands until somebody voids it."* — and links to the payment's void
dialog, which already exists.

Period, branch and state come from the URL schema.

### 4. The recipient signal on the supplier

`suppliers/components/payment-details-panel.tsx` shows `recipientReady` as a badge on each
`BANK`/`MOMO` detail (*Paystack ready* / *Created on first transfer*). Changing the account
number, bank, network or phone shows a line under the field: *"Saving this forgets the
Paystack recipient; the next transfer creates a new one."* — the server clears it either
way; the copy just stops it being a surprise.

### 5. The E-VAT module

A twenty-first module, `admin/src/modules/evat/`, added to `REQUIRED_MODULES` by the
controller (another `NEEDS_LANE_CHANGE`), with one route `/evat`:

- **Summary tiles** from `GET /api/evat/summary`: queued, certified, retrying, attention,
  overdue with `oldestOverdueMinutes` rendered as "oldest 6 h 20 m".
- **List**: document kind, document number (link to the sale or refund detail), branch,
  occurred, status badge, attempts, next attempt, GRA code, overdue marker. Filters:
  status, kind, overdue, branch, period.
- **Detail sheet**: the certificate when `CERTIFIED` (serial, GRA receipt number, signature
  in four groups, internal data truncated with a copy button, machine code, stamped at, QR
  payload as text) and the verbatim failure code and message when not; a **Retry** button
  visible only to a role holding `evat.retry` (admin).
- **Provider health** from `GET /api/evat/health`, rendered as a quiet line, not a banner —
  the mock being up is not news.
- When `flag.evatSubmission` is false, a notice at the top: *"Submission is switched off in
  settings. Documents are not being queued."*

Nav: `/evat` in **System** beside Audit, permission `evat.read`.

### 6. Flag-gated entry points

`flag.supplierTransfers` false hides the transfer action and the transfers/reconciliation
nav entries and shows a one-line explanation on the payments page. `flag.posConflictResolution`
false hides the conflict tab's resolve control but keeps the list readable. The flags are
read from `GET /api/settings` (Plan 11 renders them; this plan only consumes the values).

### 7. Walkthrough

Add `/suppliers/transfers`, `/suppliers/reconciliation` and `/evat` to
`walkthrough-sections.mjs`, plus one assertion that the transfer dialog opens with the
balance line and refuses to submit a zero amount. The OTP path is not driven in the browser
walkthrough (the mock's OTP hook is a test-only lever); it is proven by
`payables.transfer.test.ts` and named as not-driven in the evidence.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin build
bun run modules:check:strict     # 21/21
bun run lint
```

By hand against the mock: start a 500 GHS transfer, watch it settle, open the payment it
posted, then open the reconciliation and find the same pair in `settled`; start a second,
fail it, and find it in `unposted` with the supplier balance unchanged.

## Commits

1. `feat(admin): start a supplier transfer from the payments screen`
2. `feat(admin): transfers have a list, a detail and a status that names the OTP`
3. `feat(admin): the reconciliation separates manual, settled and unposted money`
4. `feat(admin): the supplier says whether the recipient exists`
5. `feat(admin): the E-VAT submission surface, its codes and its retry`
6. `test(admin): transfer, reconciliation and E-VAT walkthrough sections`

## Done when

- No screen suggests a supplier is paid before the settlement exists.
- Every transfer that did not become a payment can be found by a person in one place.
- An overdue E-VAT submission is visible without opening a database client.
