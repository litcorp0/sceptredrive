# Phase 13 — Verification

**Phase:** POS Payments, Returns & Shifts
**Verified:** 2026-10-27
**Plans:** 13/13 complete
**Gates:** `evidence/suites.txt` — **ONE OR MORE SUITES FAILED**, on one line: `bun run lint`
reports a single unsorted-import diagnostic in `desktop/src/renderer/modules/shift/pages/shift-page.tsx`,
a file the module move touched (the one command that clears it is in §5). Every other gate is green
— including **`modules:check:strict` at 16/16 POS** — the walkthrough reports **0 failures**, and
**8/8** mutations were caught.

The phase's goal was that electronic money, split tenders, refunds, repayments and the full
drawer reconcile end to end, offline where the product promises offline and online where only
the provider can move the money. This document proves that goal from the outside: every roadmap
criterion, every requirement and every OWASP line in P13-D39 points at a numbered leg of
`evidence/walkthrough-payments.mjs` (transcript `evidence/walkthrough-payments.txt`), a named
committed test, a grep — and names in §6 the two artifacts this pass did not produce.

| Gate | Result |
|---|---|
| migrations from zero (scratch database) | exit 0 — **16** migrations, including `0013_enum_phase13` before the DDL that uses its values |
| `bun run check-types` | 6/6 workspaces, exit 0 |
| `bun run lint` | **exit 1** — one `assist/source/organizeImports` diagnostic in `shift-page.tsx` (biome's summary prints `Found 2 errors`), 19 warnings (§5) |
| `@sceptre/shared` | 20 files, **318** tests |
| `api` | 54 files, **710** tests |
| `desktop` | 67 files, **593** tests |
| `admin check-types` / `admin build` | exit 0 / exit 0 |
| `modules:check:strict` | **exit 0** — 19/19 admin, **16/16 POS** migrated, zero violations |
| `brand:check` | OK over **1 112** tracked files |
| `tokens:check` | OK |
| `desktop test:print` (Electron) | **21/21** checks |
| `desktop test:e2e` (Electron) | **42/42** checks after the preload-allowlist update (§5) |
| `desktop test:counter` (Electron) | run by hand — **149/150**; the one failure is the sync badge's `action` state, unchanged by both fixes and not this phase's (§6) |
| API walkthrough | **55 assertions**, 0 failures, 1 leg not driven (leg 14), **28/29** legs with a driven check — leg 27.4 now passes |
| Mutation proofs | **8/8 caught** |
| `powersync/` | unchanged since `b21c60f` — empty `git diff --stat` |

---

## 1. Roadmap success criteria

Each of the nine criteria from `ROADMAP.md` is proved by a numbered leg of
`evidence/walkthrough-payments.mjs`, by a named committed test, or by both. Leg numbers refer to
that script.

| # | Criterion | Proof |
|---|---|---|
| 1 | A MoMo charge returns `pay_offline`, the customer approves, the webhook settles the tender, and the receipt shows paid; the verify fallback works | Legs 5.1 (the till receives 201 `PENDING` with the provider's prompt text and a 180 s expiry; the provider's own `pay_offline` maps to `PAY_OFFLINE` in `payments.paystack.provider.ts:67` and is not a field the till is trusted with), 6.1/6.2 (one payment per `clientPaymentId`), 7.1 (mock settle, then the poll — the verify fallback — reads it back `PAID` with `paidAt`), 15.1/15.2 (abandon, then a verification that wins), 10.1–10.3 (a signed body delivered twice is 200 twice and one `payment_event`). The receipt's tender block is `desktop/src/renderer/lib/receipt/render.test.ts` and the 42-column print in `test:print`. **Leg 14** (a settlement one pesewa too large) is the one leg the mock mode cannot drive; see §5 and `payments.webhook.test.ts`. |
| 2 | A card payment completes in the Paystack checkout and is verified server-side | Leg 12.1 (`authorizationUrl` begins `https://checkout.paystack.com`, `PENDING`); the locked-down window is `desktop/src/main/payments/checkout-policy.test.ts` plus the security smoke's new assertion that the preload exposes `payments.checkout` **only**, with `open`/`close` **only**; the settlement is the same server-side `applyProviderCharge` proven by legs 7.1 and 15.2 and by `payments.test.ts`. The renderer never asserts success — `payments-client.test.ts` polls. |
| 3 | A split cash + electronic tender computes the remaining balance and change correctly | Legs 8.2/8.3 (SQL: `Σ tenders − change = total`, two ordered tenders 40 000 cash then 60 000 MoMo) and 16.2 (three tenders in one sale). `packages/shared/src/tender.test.ts` owns the arithmetic, including `OVERPAID_BY_ELECTRONIC`; mutation 3 proves that guard is load-bearing. |
| 4 | A cash refund completes offline on a manager PIN; a refund at or above the cap raises a retrospective approval, and a MoMo refund completes online through Paystack | Legs 18.1–18.3 (a 20 000 cash refund applies, the sale is byte-identical, the resalable line posts `RETURN +2`), 22.1 (exactly 20 000 raises one `PENDING` approval, `deciderRole ADMIN`), 23.1/23.2 (decided, money columns identical), 20.1/20.2 (a credit refund pays no cash), 21.2 (`REFUND_EXCEEDS_TENDER`). The offline till path is `refund-service.test.ts` (the number, documents, stock delta and outbox row commit together) and `override-service.test.ts` (a manager's own PIN, and a cashier cannot approve). The electronic portion is written `PENDING` and dispatched by `pos-refund-dispatch`: `payments.refund.test.ts` proves the state machine; no live provider was called in this pass. |
| 5 | Shift close produces a Z-report whose totals and variance match the local transactions | Legs 26.1 (close applies, shift `CLOSED`, one snapshot), 26.2 (the X report equals the Z snapshot except `kind` and `generatedAt`), 27.1 (every figure equals a recomputation from `sale`, `sale_tender`, `refund`, `cart_void` and `cash_movement`), 27.2/27.3 (net and tax identities, no tender lost), 28.1 (a deleted snapshot is a 500 `SHIFT_REPORT_MISSING`, never a rebuild). The till's own close is `modules/shift/utils/close-shift.test.ts` and `shift-report.test.ts`; the printed Z is `report-render.test.ts` and `test:print`. **Leg 27.4 now passes**: it originally found that expected cash omitted cash refunds; the defect is described in §4 and fixed, and 26.1's variance is 0 on a shift that refunded GHS 500.00 in cash. |
| 6 | A credit repayment at the POS reduces the branch balance and prints a receipt | Legs 24.1 (the balance drops by exactly 50 000) and 24.2 (SQL: one `REPAYMENT` ledger row of −50 000 carrying the till's own reference number). `desktop/src/renderer/lib/refund/repayment.test.ts` covers the till's receipt and outbox; `pos.repayment.test.ts` covers the server. |
| 7 | A cashier holds three labelled carts, serves a fourth customer, recalls any held cart after restarting the application, and sees a notice where a held line's price changed | `desktop/src/renderer/lib/hold/hold-service.test.ts` — the eleventh hold is refused, a blank label is refused, a recall writes the draft and deletes the hold in one transaction, a price that rose is listed and must be acknowledged, an archived product blocks the cart, a redemption shrinks with a notice, and a hold survives a draft load for a different shift. `packages/shared/src/hold.test.ts` owns `repriceHold`. The tables are `localOnly` in `schema.ts` (see §7). **Not driven by a process restart** this pass — §6. |
| 8 | A cart is voided with a reason code; the void is recorded against the shift and cashier and reaches the server without blocking selling | Legs 25.1 (`OTHER` with no note is `REJECTED CART_VOID_NOTE_REQUIRED`) and 25.2 (with a note it applies and is stored with reason, note, items and gross). `void-service.test.ts` writes the local fact and its outbox row with no PIN; `pos.cart-void.test.ts` proves the server side, including the replay. |
| 9 | One sale takes GHS 100 cash, GHS 50 MoMo, and GHS 200 on credit against the remaining limit; change comes only from the cash tender and the credit ledger receives exactly GHS 200 | Leg 16 runs the same shape at the fixture's own scale — a GHS 100.00 line in ten GHS 10.00 units, tendered **30 000 cash / 30 000 credit / 40 000 card** — and proves the three tenders are stored in order (16.2) and that the credit ledger receives **exactly** the credit tender, once (16.3). Leg 8 is the cash + MoMo half at 40/60. Change-from-cash-only is `tender.test.ts`; the roadmap's 100/50/200 split is the same arithmetic and is not separately scripted. |

---

## 2. Requirements

| Requirement | Proof |
|---|---|
| **POS-10** returns/refunds with per-line restock, cash offline, retrospective approval | Legs 18–23; `applyRefund` caps under a `FOR UPDATE` lock on the sale (`pos.refund.test.ts`); `DAMAGED` posts no movement (leg 19.2, mutation 5); the approval is raised server-side on upload (leg 22.1) and decided without touching money (leg 23.2, mutation 8). |
| **POS-11** electronic tenders: MoMo, card, bank transfer, split with credit bounded by headroom, change only from cash | Legs 5–13 (all three methods), 16 (split with credit), 8.2 (identity), 17 (one payment, one tender); `tender.test.ts`; `credit/headroom.test.ts` on the till. |
| **POS-12** credit repayment at the POS, cash offline, MoMo online, with a receipt | Leg 24; `pos.repayment.test.ts` (a MoMo repayment must cite the settled payment and may not reuse it); `repayment.test.ts` (till). |
| **POS-13** X and Z reports, drawer reconciliation, receipt reprint | Legs 26–28; `report-render.test.ts` and `test:print` (a reprint is marked). The drawer reconciles: leg 27.4 and the close's zero variance on a shift that refunded cash prove the refund term, and `pos.test.ts` pins it across the X, the Z and the after-close X. |
| **POS-15** held carts: ten per terminal, required label, survive restart and shift change, terminal-local, recall re-prices with a notice | `hold-service.test.ts`, `hold.test.ts`, and the local-only `held_cart`/`held_cart_line` tables. The wording correction (terminal-scoped, not "any terminal") is P13-D29 and `REQUIREMENTS.md` carries it. |
| **POS-16** cart void with a reason code, recorded against shift/cashier/lines/value, uploaded, never blocking, no PIN | Legs 25.1/25.2; `void-service.test.ts`; `pos.cart-void.test.ts`; `CART_VOID` is in both mutation-tested boot lists. |
| **PAY-01** charge: mtn/atl/vod, card, bank transfer, pesewas | Legs 5.1 (mtn), 12.1 (card), 13.1 (bank transfer); `payments.validation.ts` normalises the Ghana phone; the provider client is `payments.paystack.provider.ts`. |
| **PAY-02** webhook and verify are the source of truth: HMAC, idempotent storage, verify fallback, never trust the client | Legs 10.1–10.3 and 11.1/11.2 (signed delivery, one event per body hash, a wrong key is 401 with no row), 7.1 and 15.2 (verify is the fallback); mutation 6. The route reads the raw body once and uses `timingSafeEqual`. |
| **PAY-03** refunds and partial refunds via Paystack with status tracking | Legs 20.1/20.2 and 21.2; `refund_tender` starts `PENDING` for electronic money and follows `refund.*` events (`payments.refund.test.ts`). |
| **PAY-07** a mock provider for development, the same interface for live | Legs 5–15 run entirely on `MockPaymentProvider` with `PAYSTACK_MODE=mock`; `PaystackPaymentProvider` implements the same `PaymentProvider` interface; `env.ts` refuses to boot a non-mock mode without a key (`phase13-schema.test.ts`, grep 1). |

---

## 3. OWASP Top 10:2025 (P13-D39 reproduced)

| OWASP 2025 | How this phase answers it | Proof |
|---|---|---|
| **A01 Broken access control** | Every device route resolves branch/terminal/shift from the token, never the body; payment and refund reads are scoped to the device's own terminal; a sale tender may reference only a payment from the same terminal; the webhook is the single sessionless route. | Legs 16.1/17.1 (a payment reused across sales is refused), 29.2 (a manager cannot decide their own close, 403); `payments.test.ts` (another terminal's payment is a 404, not a 403 that confirms it exists); `applyRefund` refuses a sale another terminal recorded (`REFUND_SALE_FOREIGN`, `pos.service.ts:2042–2049`) — the till-side equivalent is `refund-service.test.ts`, "refuses a refund against another terminal's sale"; **the API guard itself has no test** (§6). |
| **A02 Misconfiguration** | `PAYSTACK_MODE=mock` boots with no key; a non-mock mode without a key refuses to start; no card channel is opened in our renderer; the checkout window has `sandbox`, `contextIsolation`, no preload and an allowlist. | `phase13-schema.test.ts` (the env refinement, by name); `checkout-policy.test.ts`; the security smoke's navigation legs and the new `payments.checkout` shape assertions. |
| **A03 Supply chain** | No new runtime dependency for HMAC (`node:crypto`) or HTTP (`fetch`). | `api/package.json` unchanged by this phase; `payments.provider.ts` imports only the platform. |
| **A04 Cryptographic failures** | HMAC-SHA512 over the **raw** body, `timingSafeEqual` on equal-length buffers, no secret in a log, Argon2id for the PIN proof (unchanged), https base URL enforced. | Legs 11.1/11.2; mutation 6; `payments.webhook.test.ts` asserts the body is read once. |
| **A05 Injection** | Zod on every body and query, Drizzle parameters only, the webhook body never interpolated into SQL, `event_type` allowlisted rather than free text. | Every route in `payments.routes.ts` carries a validator; the event projection is `projectProviderDetail` (an allowlist, asserted in `payments.webhook.test.ts`). |
| **A06 Insecure design** | Money never leaves on a client assertion; refunds are capped per tender under a row lock; an orphan payment is a conflict, never an automatic refund. | Legs 15.2/15.3 (orphaned + HIGH conflict, zero refunds), 16.3, 21.2; mutation 4. |
| **A07 Auth failures** | Device JWT plus per-device rate limits on every new endpoint; the webhook is signature-only and its failures are 401, not 500. | `payments.routes.ts` (four device routes, each with its own bucket keyed on the device); legs 11.1, 29.2. |
| **A08 Integrity failures** | Idempotency by `(terminal_id, client_transaction_id)`, `(terminal_id, client_payment_id)`, `provider_reference` and webhook body hash. | Legs 6.1/6.2, 9.1 (REPLAYED, one sale), 10.2 (one event for two deliveries), 25.2 (the second identical void is a replay), 20.1/23.2 (immutable money). |
| **A09 Logging failures** | No secret, token, card field or full webhook body in logs; audit rows for refund, repayment and void. | Leg 10.3 (`payment_event.detail` is the allowlist; the body's `authorization`/`customer` never reach it); `payments.webhook.test.ts` asserts `authorization`, `customer`, `bin`, `last4` are absent from `detail`; audit rows `pos.refund.applied`, `pos.refund.override`, `pos.repayment.received`, `pos.cart.voided`. |
| **A10 Exceptional conditions** | A provider timeout is `PENDING`, not `FAILED`; a refund whose provider call fails stays `PENDING` and visible; a rejected upload is stored `REJECTED` and still answers 200. | Leg 15.1 (abandon leaves no money and no conflict), 21.2 (`REJECTED` with a code), 25.1 (`REJECTED`); `payments.refund.test.ts` (a failed refund is visible, never retried into `SETTLED`). |

### The two OWASP greps

```bash
grep -rn "PAYSTACK_SECRET_KEY\|sk_live\|sk_test\|Bearer " api/src --include='*.ts' \
  | grep -v "env.ts\|payments.paystack.provider.ts"
```

**28 matches, and none of them is a secret.** Broken down honestly, because the plan's expected
result ("only the provider client and its env declaration") is not what a codebase that uses the
`Bearer` scheme returns:

- `Bearer ` — 24 matches, every one of them the **authorization scheme** of a device JWT: the
  parser that defines it (`api/src/http/device-auth.ts:8`) and the tests that send a device token.
  No token literal, no credential.
- `PAYSTACK_SECRET_KEY` — 4 matches: `payments.provider.ts` (the factory that reads it from
  `env`), and `phase13-schema.test.ts` (three assertions that a non-mock mode without it refuses
  to boot, using the dummy `sk_live_test`).
- `sk_live`/`sk_test` — 2 matches, both the same test dummy. **No real key is in the tree**, and
  `.env` is ignored with `.env.example` as the template.

```bash
grep -rn "last4\|authorization_code\|\"bin\"" api/src admin/src desktop/src
```

**7 matches, all of them tests or a comment.** `payments.schema.ts:44` is the comment that says
no card data is stored; the rest are the webhook test's deliberately hostile body and its
assertion that those keys never reach `detail`, the schema test that asserts the columns do not
exist, and an unrelated customer-search test using the last four digits of a phone number. **No
DTO, no log line, no local table, no admin or desktop field.** This is P13-D15 proved by grep.

---

## 4. Mutation proofs — 8/8 caught (`evidence/mutations.txt`)

Each mutation was applied, the named suite run, the failure recorded, and the file restored with
`git checkout --`. The run ends with `git status --porcelain -- api desktop packages` empty.

| # | Mutation | Caught by |
|---|---|---|
| 1 | `refundApprovalRequired` `>=` → `>` | `packages/shared/src/refund.test.ts` — the 20 000 boundary |
| 2 | `applySale` drops the `payment.status === 'PAID'` check | `api/src/modules/pos/pos.tender.test.ts` — a pending payment cannot tender |
| 3 | `tenderBalance` lets change exceed the cash tender | `packages/shared/src/tender.test.ts` — `OVERPAID_BY_ELECTRONIC` |
| 4 | `applyRefund` stops checking per-tender remainders | `api/src/modules/pos/pos.refund.test.ts` — `REFUND_EXCEEDS_TENDER` |
| 5 | `DAMAGED` starts posting a movement (`movesStockBack` widened) | `api/src/modules/pos/pos.refund.test.ts` — the zero-movement test |
| 6 | the webhook accepts a body without verifying the signature | `api/src/modules/payments/payments.webhook.test.ts` — the 401 leg |
| 7 | a late settlement stops setting `orphaned` | `api/src/modules/payments/payments.test.ts` — the `PAYMENT_LATE_SETTLEMENT` case |
| 8 | the `REFUND` decision handler stamps `refunded_minor` | `api/src/modules/pos/pos.refund.test.ts` — the immutable-money test |

No mutation was missed, so no test gap had to be repaired in this pass. The set was **re-run on
2026-10-27 after the drawer fix** — which changed `pos.refund.test.ts`, one of the suites that
catches three of the eight — with the same result: **8/8**, and the tree was clean afterwards
(`git status --porcelain -- api desktop packages scripts` shows only the fix's own files).

### Defects this pass found — and that are fixed since

Two were found by this verification and one by a gate; all three are closed. Each names the
files, the test that now pins it, and the leg or check that found it.

| # | Found by | Defect | Fixed in | Pinned by |
|---|---|---|---|---|
| 1 | **leg 27.4**, first run: `expected=GHS 1 800.00 the drawer actually holds=GHS 1 300.00` | **Cash refunds were missing from expected cash.** `selectShiftCashTotals` summed float + cash tenders − change + cash in − cash out and never subtracted a settled `CASH` `refund_tender`, on the server **and** on the till, and `reconcileShifts` verified the same incomplete formula. A cashier who refunded GHS 500.00 in cash closed "short" by exactly that, and a manager would have investigated a drawer that was right. Electronic refunds never move the drawer and were correctly untouched. | `api/src/modules/pos/pos.repository.ts` (`selectShiftCashTotals` gaining `cashRefundsMinor` through `ShiftDrawerTotals`), `computeExpectedCash` in `pos.service.ts`, `pos.reconciliation.ts`, and the till's `lib/shift/shift-repository.ts` + `shift-service.ts`. A refund counts against the **refund's own shift**, not the sale's, and only a `SETTLED` `CASH` tender is subtracted. | `api/src/modules/pos/pos.test.ts` — *"takes cash refunds out of expected cash and ignores electronic ones"*: it asserts the term, that a `PENDING`/card refund does **not** move it, the X before the close, the stored Z, and the X after it; plus `pos.report.test.ts`'s oracle and the till's `shift-repository.test.ts` (*"subtracts only this shift's settled cash refunds"*, *"joins the refund to its own shift and filters cash, settled tenders"*, *"treats a missing row as zero refunds rather than undefined money"*) and `shift-service.test.ts`. |
| 2 | `modules:check:strict`, exit 1 with five violations | The gate's module allowlist was Phase 10's: `modules/refund` and `modules/repayment` were "not a module named by Phase 10's context", and `close-shift.ts`, `close-shift.test.ts` and `print-report.ts` sat at the root of `modules/shift/`. Both folders and files are what Plans 10 and 11 specified. | `scripts/check-desktop-modules.mjs` now lists `refund` and `repayment`; the three shift files moved to `modules/shift/utils/`. | `modules:check:strict` — **19/19 admin, 16/16 POS, exit 0**. |
| 3 | a matrix run (1 of 708) and 25 repeats of the file (4 failures) | `api/src/modules/sync/sync.jwt.test.ts`'s *"rejects a tampered signature"* verified a mutated token about one run in six. It flipped the **last two** base64url characters of the signature, and a tail position carries padding bits, so the replacement does not reliably change the decoded bytes. | the assertion now flips a character **mid-signature**, which always changes the decoded bytes. | **25/25** standalone runs, and the full API suite green (710/710). |

**The walkthrough leg that found the drawer defect now passes**, and the transcript prints the
arithmetic it proves:

```
     drawer: float GHS 500.00 + cash GHS 1300.00 − change GHS 0.00 − cash refunds GHS 500.00 = GHS 1300.00
PASS 26.1  closing the shift applies, the shift is CLOSED, and a Z snapshot exists
PASS 27.1  every Z figure equals a recomputation from sale, sale_tender, refund, cart_void and cash_movement
PASS 27.4  the expected cash equals what the drawer holds after cash refunds (and the refund term is exercised)
```

Leg 27.4 is no longer a `FINDING` channel: it is a check that fails if the report's expected cash
ever disagrees with an independently computed drawer truth, and it also asserts the refund term is
non-zero in this fixture, so it cannot pass vacuously.

---

## 5. Deviations, each with a reason

1. **A scratch database, not `docker compose down -v`.** Plan §1 asks for the dev database to be
   destroyed and migrated from zero. The API, PowerSync and the demo dataset were live and the
   walkthrough needed them, so `run-suites.sh` creates `sceptre_drive_phase13_migrate_check`,
   applies every migration to it, records the result, and drops it. The ordering being proved —
   `0013_enum_phase13` before the DDL that uses its values — is identical, and it now also records
   that **16** migrations apply, not the 14 the plan wrote.
2. **`modules:check:strict` was red when this pass ran; it is green now, and this lane did not
   fix it.** The gate's module allowlist was Phase 10's, so Plans 10 and 11's `modules/refund/**`
   and `modules/repayment/**` and the three files at the root of `modules/shift/`
   (`close-shift.ts`, `close-shift.test.ts`, `print-report.ts`) were rejected with five
   violations. The verification lane reported it rather than editing a controller-owned script;
   `scripts/check-desktop-modules.mjs` now lists both modules and the three files moved to
   `modules/shift/utils/`. The matrix now prints **`modules:check:pos OK — 16/16 modules
   migrated`** and exits 0. §4 defect 2.
3. **`bun run lint` is the transcript's one red line, and this lane may not clear it.**
   `desktop/src/renderer/modules/shift/pages/shift-page.tsx` is the only file named, with one
   `assist/source/organizeImports` diagnostic introduced by the module move (the two imports it
   rewrote are no longer in sorted order); biome's summary line prints `Found 2 errors` for that one
   diagnostic. One command fixes it —
   `bunx biome check --write desktop/src/renderer/modules/shift/pages/shift-page.tsx` — and every
   other gate in the matrix is green. Reordering an import is still a change to application code,
   which this pass is not permitted to make, so it is reported with the exact command instead of
   being done quietly.
4. **`desktop/test/e2e/security-smoke.mjs` was updated, and tightened.** Plan 09 added a
   `payments` bridge (open/close the checkout window), so the gate's hard-coded
   `app,pin,printer,secure` list could no longer pass. The script now expects
   `app,payments,pin,printer,secure` **and** asserts two new exact shapes — `payments` exposes
   `checkout` only, and `checkout` exposes `close,open` only. That is one more constraint on the
   new surface, not a looser gate: **42/42** checks pass after the change (39 passing of 40 before it).
5. **`test:counter` is run by hand, not in the matrix.** It runs in this environment, but the
   matrix already contains two Electron suites and the rule is one at a time. Result **149/150**;
   the single failure and what is known about its cause are in §6, and the transcript is
   `evidence/counter-audit.txt`. It is not added to `suites.txt` because it is not green.
6. **Leg 14 is `NOT-DRIVEN`, not failed.** The webhook applies a settlement only to a payment whose
   `provider` is `PAYSTACK` (`findByReferenceForUpdate`), and `PAYSTACK_MODE=mock` never creates
   one. A fixture payment inserted with SQL would be exactly the thing this repository's evidence
   scripts refuse to do. `payments.webhook.test.ts` covers the leg with a real signed body against
   a `PAYSTACK` row: amount one pesewa larger → `PAYMENT_AMOUNT_MISMATCH` HIGH, status unchanged.
7. **Leg 15 is driven in the only order mock mode exposes.** The plan writes "abandon → EXPIRED;
   then settle → PAID + orphaned". A mock payment that has reached `EXPIRED` can only be revived by
   the webhook, which ignores `MOCK` rows, so the script settles at the provider first and then
   abandons: `abandon` expires the row and its own verify call wins, producing the same
   `PAID` + `orphaned` + `PAYMENT_LATE_SETTLEMENT` facts (legs 15.2/15.3) — and leg 15.1 proves the
   `EXPIRED` outcome separately on a payment the provider never settled.
8. **The API was restarted with a throwaway webhook secret for the walkthrough, then restored.**
   `.env` has `PAYSTACK_MODE=mock` with empty `PAYSTACK_SECRET_KEY`/`PAYSTACK_WEBHOOK_SECRET`, so
   `env.paystackWebhookSecret` resolves to `null` and the route fails closed with 401 for every
   body — correctly, but it makes legs 10 and 11 unprovable. The walkthrough therefore requires
   `PAYSTACK_WEBHOOK_SECRET` in its own environment (the same value the API was started with), and
   prints NOT-DRIVEN when it is absent. This is a real developer-experience gap: a plain
   `bun dev:api` cannot exercise the webhook at all.
9. **One stale demo-database row was removed so a gate measured the product.** `test:counter`
   asserts the cart total equals the **seeded** catalogue price. `product.price` override
   `GIK-00001 → 50 626` on `ACC-SPX` made every basket 431.26 too large; it was created at
   00:00 and updated at 01:05 on 2026-10-27 by **Phase 12's console walkthrough**, which drove the
   price-change request and its approval against the demo branch (an `APPROVED` `PRICE_CHANGE`
   approval to 50 626 exists). Removing that one override restored the seeded price. Two more
   Phase 12 leftovers (`GIK-00004 → 121 500`, `GIK-00006 → 41 625`) are still there and are named
   for the controller: they do not affect any gate, but they mean the demo catalogue is not the
   seeded one.
10. **`suites.txt` has been regenerated twice, and the reason each time is recorded.** The first
    transcript was discarded because `run-suites.sh` was edited while it was running (bash reads a
    script by byte offset), which made the desktop suite appear twice. The second recorded the
    drawer finding; this one is from the final script and the corrected code. The walkthrough's
    fixture arithmetic was also updated once, for the same reason the product was: its counted cash
    and its SQL recomputation encoded the **defective** formula that leg 27.4 reported, and both
    now include the refund term. No assertion was weakened — 26.1 still requires a zero variance,
    and 27.4 is a stricter check than the finding it replaces.

---

## 6. What is not proven, named

- **The printed Z's DRAWER section does not itemise cash refunds.** The expected figure is now
  correct, but the block prints Opening float, Cash in, Cash out, Expected, Counted and Variance
  and nothing else (`desktop/src/renderer/lib/receipt/report-render.ts:199–215`), so a cashier
  adding the visible rows on a shift that refunded cash cannot arrive at Expected — the deduction
  is real but invisible. The REFUNDS block above it shows the refund total, which is the only
  place the money appears. Making the drawer block self-explaining is a receipt-layout change, not
  an arithmetic one.
- **Refunds are terminal-scoped.** A sale taken on another till is not refundable at this one
  (`REFUND_SALE_FOREIGN`), by P13-D25. The console path is Phase 14's.
- **A refund approval is retrospective by design.** The money has already gone back when an admin
  reads it; the decision writes an audit row and no money column (legs 23.1/23.2, mutation 8).
- **An orphaned payment needs a person.** Nothing auto-refunds; the till shows the banner and a
  manager attaches or records it (legs 15.2/15.3).
- **`DAMAGED` refunds are reported but not inventoried.** The line carries `damage_reason` and
  posts no movement (leg 19.2); the shrinkage report is Phase 14's.
- **Approval expiry is still unimplemented.** Age is displayed; nothing expires.
- **The console has no refund list.** Phase 14 owns the list; the detail exists
  (`admin/src/modules/approvals/components/subject/refund-subject.tsx`) and is fed by the same
  subject the API walkthrough exercises through `GET /api/approvals/:id`.
- **A manager still cannot close a cashier's drawer at the till.** The server honours `closedBy`
  (leg 29.1: the review's requester and `payload.closed_by` are the manager, `closed_by` is the
  manager) and refuses the manager's own decision (leg 29.2, 403). But
  `desktop/src/renderer/lib/shift/shift-service.ts:closeShift` calls `openShiftOrThrow`, which
  throws `NOT_OWNER` unless the signed-in staff member **is** the shift's cashier
  (`openShiftOrThrow`, line 104). The payload can carry a closer proof (`input.closedBy`), and
  nothing on the till can reach that path for someone else's shift: the manager would have to be
  the shift's own cashier, or close a shift they opened themselves. This is the remaining half of Phase 12's
  carry-forward, and it is a till-side authorisation change.
- **No console walkthrough and no payment drill were produced in this pass.** Plan §4's
  `refund-approval-*.png` screenshots and Plan §5's `desktop/test/e2e/payment-drill.mjs` are absent
  from `evidence/`. The console's refund detail is mapped to its component and to the API legs that
  feed it; the till's offline sale and offline refund are mapped to `test:counter`'s offline
  section and to `refund-service.test.ts`/`void-service.test.ts` rather than to one scripted
  drill. That is a weaker proof than the plan asked for, and it is the largest gap in this
  evidence set.
- **"Survives a restart" is structural, not scripted.** Holds and the Z snapshot are rows in the
  local SQLite file with no shift-scoped pruning (`schema.ts`, `localOnly`), and the counter audit
  relaunches the app offline and lands on the shift home — but no scripted run parks three carts,
  kills the process and recalls them.
- **The mock provider cannot revive an `EXPIRED` payment.** Its only revival path in production is
  the webhook, and the webhook refuses `MOCK` rows. A mock-mode environment can show a late
  settlement only through `abandon`'s own verify (deviation 6).
- **`REFUND_SALE_FOREIGN` has no API test.** `applyRefund` refuses a sale recorded by another
  terminal (`pos.service.ts:2042–2049`, P13-D25), and only the till-side rule is tested
  (`refund-service.test.ts`, "refuses a refund against another terminal's sale"). The API guard is
  five lines of scope check that no test drives; a mutation there would go unnoticed. Named, not
  patched, because no mutation in this pass exposed it.
- **The counter audit is 149/150, and the one failure is not this phase's.** The audit sets the
  renderer offline and expects the sync badge to read `offline`; it reads `action`. From
  `components/layout/sync-badge.tsx:54`, `action` comes from `outbox.failed > 0 || highOpen > 0 ||
  upload.deadLetters > 0`, checked before `offline`. It is not conflicts: the audit's terminals
  carry **zero** rows in `sync_conflict` (SQL), and the device's local conflict cache is refreshed
  from that terminal-scoped endpoint. That leaves one of the audit's own uploads recorded as
  `dead_letter`, which is the only non-acked terminal status anything writes. Which row, and why,
  is not recoverable: the audit deletes its `--user-data-dir` tree at exit and does not print the
  badge's `title`/`detail`. It is unchanged by the drawer fix (the audit makes no refunds) and by
  the module move (a rename), and it failed identically, on the same check, before both landed.
  Closing it needs the audit to keep its userData or print the badge detail on failure.
- **The demo catalogue is not the seeded catalogue.** Two Phase 12 price overrides remain on
  `ACC-SPX` (deviation 8). Any future counter-audit run uses `GIK-00001`, `GIK-00002` and
  `GIK-00005`, so it is unaffected — but the demo data no longer matches the seed.

---

## 7. Numbers

| | Before Phase 13 | After |
|---|---|---|
| shared tests | 239 | **318** (+79) |
| API tests | 596 | **710** (+114) |
| desktop tests | 427 | **593** (+166) |
| admin modules (`modules:check`) | 19 | **19/19** |
| POS modules (`modules:check:pos`) | 14 | **16/16** migrated, zero violations |
| brand-gated files | 1 035 | **1 112** |
| packaged print checks | 21 | **21/21** |
| packaged security smoke | 39/40 (a stale bridge list) | **42/42** (the `payments` surface is now asserted, not ignored) |
| counter audit | 150/150 | **149/150** (the sync badge; §6) |

The desktop count moved by +166 because this phase is the first to touch the till since Phase 10:
**sixteen** new test files (tender arithmetic, electronic tenders, refunds, repayments, holds,
voids, close-shift, the Z report, the receipt's report block, the payments client, the checkout
policy, the payment attention strip, refund search, the sale repository's new seams, and — with the
drawer fix — `shift-repository.test.ts` and `shift-service.test.ts`). The API's +2 are the drawer
test and the report oracle's refund term; its 710 is the number after the tampered-signature test
was made deterministic.

### The sync contract did not change

```bash
git diff --stat b21c60f..HEAD -- powersync/
```

is **empty** (`b21c60f` is Phase 13's first commit, `docs(planning): phase 13 payments, returns and
shifts`). No synced table was added, and `powersync/sync-config.yaml`'s header still describes the
tables it did before.

The till gained **eight** local-only tables, not the five the plans counted — Plans 09–11 added
`refund`, `refund_line` and `refund_tender` alongside `cart_tender`, `held_cart`, `held_cart_line`,
`cart_void` and `shift_report`:

```
git diff b21c60f..HEAD -- desktop/src/renderer/lib/powersync/schema.ts | grep '^+export const'
+export const cartTender …
+export const heldCart …
+export const heldCartLine …
+export const cartVoid …
+export const refund …
+export const refundLine …
+export const refundTender …
+export const shiftReport …
```

Every one is declared `localOnly: true`, so the PowerSync client never asks the service for it.

---

## 8. Evidence index

| File | What it is |
|---|---|
| `evidence/suites.txt` | The whole gate matrix in one transcript — migrations from zero and every gate, with `bun run lint` the only red line and `modules:check:strict` at 16/16 |
| `evidence/run-suites.sh` | The script that produced it |
| `evidence/walkthrough-payments.mjs` | 29 legs, fixtures through the API, three figures re-derived from SQL, one hand-delete |
| `evidence/walkthrough-payments.txt` | `PASS 55 / FAIL 0 / NOT-DRIVEN 1` — leg 27.4 now passes |
| `evidence/mutations.sh` | The eight mutations, apply → run → revert, then a clean-tree assertion |
| `evidence/mutations.txt` | **8/8 caught** |
| `evidence/counter-audit.txt` | The till's counter audit, run by hand — **149/150**, the blocker named and bounded in its header |
