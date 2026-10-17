# Research — Ghana E-VAT / GRA

**Researched:** 2026-10-17
**Sources:** Ghana Revenue Authority e-invoicing guidance (Act 1151, effective January 2026),
VAT registration context, and the earlier prototype's receiving-contract notes

## What is known

- Ghana's VAT is composite: VAT 15% + NHIL 2.5% + GETFund 2.5% = **20%** on one base.
- GRA E-VAT/e-invoicing obligations (Act 1151) began applying from **January 2026** for
  VAT-registered businesses.
- E-VAT-compliant invoices/receipts need: seller TIN/VAT registration, a unique invoice
  serial, issue date/time, line items, tax breakdown, and typically a QR code or machine
  code plus a signature or cryptographic check value.
- The earlier prototype concluded that offline generation is permitted for a limited
  window (commonly cited as up to 24 hours) with submission on reconnect, and it modelled
  this as a provider adapter with a mock until onboarding.

## What is not yet verified (open questions)

- The exact GRA onboarding process, credentials, and API endpoints.
- The precise QR payload encoding and signing algorithm required by GRA.
- Whether POS receipts must be submitted individually, batched, or rolled into invoices.
- The exact offline grace window for this business's VAT status.
- Whether GRA requires a special series of invoice numbers per terminal or branch.

## Decision for v1

- Build the **receipt contract now**: serial, terminal, branch, seller tax identifiers,
  tax breakdown, QR payload field, signature field, and submission status.
- Implement an `EInvoicingProvider` interface with two implementations:
  - `MockEInvoicingProvider` (development and staging until onboarding).
  - `GraEvatProvider` (activated when credentials and API details are confirmed).
- Generate receipts offline with terminal-scoped numbering and `evat_status = LOCAL`.
- Submit on reconnect within the permitted window with a retry state machine
  (`PENDING → SUBMITTED → FAILED → RETRYING`), visible in the admin console.
- Choose `EVAT_PROVIDER=mock` in `.env` until onboarding completes; no code changes are
  needed to switch to live.

## Action before Phase 8

Confirm the open questions with GRA onboarding documentation or a tax adviser, then update
this file with the confirmed API contract.
