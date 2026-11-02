# 19 — Verification

Goal-backward map from the roadmap's eight criteria to a command, a test or a human step.

| # | Criterion | Evidence |
|---|---|---|
| 1 | A 250–1,000-row file previews with new/existing classification, on-hand, delta, value and errors, and writes nothing | `openings.api.test.ts` — "previews new, existing, duplicate and invalid rows without writing anything"; asserts the opening table is empty after the preview. The client preview renders the server's rows in `OpeningPreviewTable`. |
| 2 | A clean draft posts as one transaction: new products, `OPENING` movements, average seeded, audit | `openings.api.test.ts` — "creates a draft, posts it once, and seeds the branch average": two lines, one new product, level 12 at avg 1 000, new product level 7 at avg 3 000, two `OPENING` movements, both audit actions. |
| 3 | Posted immutable; draft deletable; negative delta refused; uncosted needs acknowledgement | `openings.api.test.ts` — "refuses a negative delta…", "requires an explicit acknowledgement… and deletes a draft"; the service refuses delete of a `POSTED` document. |
| 4 | Manager drafts own branch; only admin posts; foreign branch 403 | `openings.api.test.ts` — manager post 403, manager preview at branch B 403; route permissions `inventory.opening.draft` / `.post`; service re-checks the admin role. |
| 5 | Retry/post idempotency cannot double stock | `openings.api.test.ts` — the create replay returns the same id; the post retry leaves the movement count unchanged. |
| 6 | Proposal carries opening stock; approval creates both; rejection nothing | `openings.api.test.ts` — "stocks a product from an approved manager proposal" (level 4 at 2 500, one `OPENING` movement); "refuses a proposal that sends only one opening field". Rejection is covered by the approval decision handler returning before `createProductFromSubmission`. |
| 7 | Sale after opening uses the seeded average; pre-opening sales stay uncosted | The average assertions in criterion 2 and the existing Phase 17 sale-cost tests; the dashboard's `uncostedRevenueMinor` is unchanged and names pre-opening sales. |
| 8 | `OPENING` in the movement filter/report; gates green | The proposal test queries `/api/inventory/movements?...&type=OPENING` and gets one row. `check-types` 7/7, lint, build, modules, brand. |

## OWASP acceptance

| Control | How it is met |
|---|---|
| A01 Broken access control | Server-side permission on every route; manager branch scope in `getBranch`/`assertBranchAccess`; the service re-checks `ADMIN` for post; foreign branch is 403 even when the body names it. |
| A03/A05 Injection | Drizzle parameterised reads; strict Zod on every row, field lengths and integer ranges; the shared CSV parser is data-only, no eval; the server revalidates every row the browser parsed. |
| A04 Cryptographic | No secrets, tokens or PII in the document or logs; audit stores the actor label only. |
| A08 Integrity | One transaction for product creation + movements; idempotency key per branch; append-only movements; `posted_at`/`posted_by` stamped. |
| A09 Logging | `stock_opening.created`, `.posted`, `.deleted` audit rows with branch, totals and movement count. |
| A10 Exceptional conditions | A row error refuses the draft/preview; post fails closed and rolls back; no partial go-live. |

## Gaps named, not hidden

- No browser-driven walkthrough with screenshots in this pass; the console is proven by
  typecheck and a production build.
- `test:counter` (Electron + PowerSync) was not run. The opening is server-side and reaches
  the till through the existing `stock_level` bucket; no sync table or config changed.
- The full API suite must run on a fresh `sceptre_drive_test`; a shared database accumulates
  fixtures and breaks the analytics catalogue-wide aggregates (the Phase 14/18 note).
