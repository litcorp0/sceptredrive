---
phase: 13-pos-payments-returns
name: POS Payments, Returns & Shifts
depends_on: [06-pos-offline-core, 10-desktop-pos-redesign, 12-branch-ops-approvals]
requirements: [POS-10, POS-11, POS-12, POS-13, POS-15, POS-16, PAY-01, PAY-02, PAY-03, PAY-07]
status: context-locked
created: 2026-10-24
---

# Phase 13 — POS Payments, Returns & Shifts — Locked Context

**Goal:** A cashier can take cash, MoMo, card, or a split of them at the counter, refund a
sale, take a credit repayment, and close a shift with a Z-report that matches the drawer —
without the network deciding whether trade continues.

## Problem

Phase 6 sells cash and credit only (`sale_tender_method` is `CASH | CREDIT`, one tender per
sale). There is no refund, no repayment at the till, and no X/Z report. Everything electronic
is still ahead, and the roadmap previously implied refunds would flow through the Phase 12
approval queue — which cannot be true for a cash refund at an offline terminal.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Tender model | Extend `sale_tender_method` with `MOMO`, `CARD`, `BANK_TRANSFER`. Relax the unique `(sale_id, method)` index to `(sale_id, method, sequence)` so a sale can carry several tenders of the same method | Split tender is the operator requirement; the current index was written for single tender |
| D2 | Payment state | Electronic tenders carry `PENDING → PAID \| FAILED \| ABANDONED \| EXPIRED`. A sale is final only when tenders cover the total; the sale row is written once, at completion | A pending tender is not money. Writing a sale before settlement would make the outbox ambiguous |
| D3 | Failed charge | The sale stays **open** with an unpaid balance. The cashier retries, switches to cash, or abandons. Nothing is committed and no debt is created by a technical fault | Operator decision. Once the customer has walked out, a technical failure must not become a receivable |
| D4 | Paystack flow | Server-side charge initialisation, webhook as the **source of truth**, verify as fallback, idempotent event storage keyed on the Paystack reference, HMAC signature verification, `PAY-07` mock provider for development. The client never asserts success | PAY-01…03; never trust a client-side callback |
| D5 | Refund authority | Cash and card refunds are authorised by the **Phase 6 manager PIN proof at the terminal** and work offline. When the refund value is at or above `pos.refundApprovalThresholdMinor` (default **20_000** pesewas, GHS 200, admin-only setting) **and** the terminal is online, a `REFUND` approval is created in the Phase 12 queue **after** the refund completes, for retrospective review. Offline, the same refund completes on the PIN alone and raises the approval on the next sync | Operator decision 2026-10-24. Resolves the contradiction between "cash refunds work offline" and "large refunds need head office": the till never blocks, and oversight happens after the fact |
| D6 | Refund restock | Per line and explicit: `RESALABLE` returns to stock; `DAMAGED` records a write-off reason and posts the stock write-off path from Phase 12; `NOT_RETURNED` leaves stock untouched | Operator decision. Silent restocking of damaged goods is how stock figures rot |
| D7 | Refund scope | A refund references the original sale and line, capped at `quantity − already_refunded`. Partial refunds are the normal case. A refund is a new document (`refund` + `refund_line`), never an edit to the sale | Append-only. The original sale keeps the money it actually took |
| D8 | Split tender rules | A sale may carry **cash, one or more electronic tenders, and a credit tender** in any combination. Cash is allowed offline; electronic tenders require connectivity; credit is bounded by the customer's remaining limit at the quoted price and revalidated on sync. Change is computed **only** from the cash tender; neither a card nor credit can produce change. The `(sale_id, method)` unique index becomes `(sale_id, method, sequence)` | Operator decision 2026-10-24. Part-cash-part-credit is the normal counter case in Ghanaian parts retail, and the Phase 6 index already anticipated a relaxation |
| D9 | Credit repayment | A repayment at the till posts a credit ledger entry through the Phase 4 `postEntry` path and prints a receipt. Cash works offline; MoMo/card require connectivity. It reduces the branch balance and appears on the statement | POS-12; reuses the existing ledger, no new money path |
| D10 | X/Z reports | A **Z-report** is generated automatically inside the shift-close transaction and stored as an immutable snapshot. An **X-report** is generated on demand and never stored. Totals come from local sale/tender/movement rows; the server recomputes expected cash on sync and Phase 12 reviews any variance above tolerance | Two different questions: "how are we doing?" (X) and "this shift is closed" (Z) |
| D11 | Receipt | The receipt shows each tender with its amount, the paid total, change, and for a refund the original receipt number and reason. The E-VAT fields stay reserved and unprinted | Phase 6 D27 contract continuity |
| D12 | Offline boundary | Cash sale, cash refund, cash repayment, shift open/close, and printing work with no network. Electronic tenders, card checkout, and electronic refunds require it. The till never queues an electronic tender for later settlement | AGENTS.md: cash and credit work offline; MoMo/card/bank require internet |
| D13 | Money | Integer pesewas end to end. Paystack receives `amountMinor` directly. No float in any tender, change, or report calculation | AGENTS.md rule 4 |
| D14 | Security | Webhook HMAC verified before parsing, events idempotent, no key or token in logs, no card data in our systems (Paystack checkout owns the card form), refunds require a valid PIN binding, replay protection on the mock provider | OWASP A02/A04/A08; keeps PCI scope out of the POS |
| D15 | Verification | Unit tests for tender arithmetic, change, refund caps, repayment; API walkthrough with the mock provider (success, failure, webhook replay, verify fallback, refund, repayment, Z-report); Electron E2E offline cash refund and online MoMo sale; reconciliation: Σ tenders = total, refunds reduce net but never rewrite the sale, Z-report matches drawer | Goal-backward |
| D16 | Held carts | Local table `held_cart` (label, held_at, held_by, shift_id, payload). Up to **10 per terminal**, refused beyond that with a clear message. A hold requires a non-empty label (≤ 60 chars). Holds are **terminal-scoped, visible to any cashier**, and survive a restart; they are not synced and carry no money. `cart_draft` keeps its single ACTIVE draft per shift | Operator decisions. A hold is a counter convenience, not a business fact, so it stays local; ten is enough to clear a queue without turning the till into a filing cabinet |
| D17 | Recall | Recalling loads the held cart as the active draft, re-prices every line against the current catalogue and branch price, recomputes discounts and loyalty, and shows an explicit notice listing lines whose price moved. A held cart whose product was archived is flagged and the line must be removed or replaced before completion | A price quoted at 10am is not the price at 4pm. Silent repricing is worse than a visible change |
| D18 | Cart void | `cart_void` local row plus outbox type `CART_VOID`, uploaded through the existing outbox path. Server stores `cart_void` (branch, terminal, device, shift, cashier, occurredAt, receivedAt, reasonCode, note, itemCount, grossMinor, label, lines jsonb snapshot). Reason codes: `CUSTOMER_CHANGED_MIND`, `WRONG_ITEM`, `PRICE_DISPUTE`, `DUPLICATE_SCAN`, `CUSTOMER_LEFT`, `OTHER`; `OTHER` requires a note. No PIN. Voiding a held cart uses the same path with its label | Operator decision. A cart with no money attached is a lighter event than a voided sale, but silence is how a shrink problem hides. The data is captured here and reported in Phase 14 oversight |
| D19 | Shift boundary | Held carts are terminal-scoped rather than shift-scoped. Shift close warns if holds exist and requires an explicit choice: keep them for the next shift, or void them (which records one `CART_VOID` per hold with reason `CUSTOMER_LEFT` and a note). Closing a shift never silently deletes a held cart | A hold can outlive a shift; deleting it on close would lose a customer's basket |

## Invariants

- A sale is written once, when it is complete. A pending tender is not a sale.
- A refund is a new document; the original sale is never edited.
- Cash paths never wait on the network.
- The drawer figure is arithmetic on movements, not a typed number.
- No card data, key, or token reaches logs, the local database, or the audit trail.

## Open Items

- GRA E-VAT submission stays in Phase 14; this phase reserves the receipt fields only.
- Returns that arrive from an online order (not POS) are out of scope — there is no online store in v1.
- Refund approval above the cap is retrospective by design; if the operator later wants a hard block, it is a Phase 14 policy change, not a Phase 13 rewrite.

## Planned Plans

1. Schema: refund, refund lines, tender sequence, payment state, `held_cart`, `cart_void`, settings, permissions.
2. Tender engine in `@sceptre/shared`: multi-tender arithmetic including credit, change from cash only.
3. Paystack provider, mock provider, webhook, verify, idempotency.
4. Sale completion rework: multi-tender, credit split, pending electronic states.
5. Refund flow with PIN authority, cap, restock choice, retrospective approval.
6. Credit repayment at the POS.
7. Held carts, recall with re-pricing, and cart void with reason codes.
8. X/Z reports, drawer reconciliation, shift variance hand-off to Phase 12 review.
9. UI: tender panel, holds tray, void dialog, refund, repayment, shift close and report.
10. Verification, evidence, state update.
