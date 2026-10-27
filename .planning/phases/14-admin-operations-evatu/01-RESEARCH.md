# Phase 14 — Research

Read once, do not repeat. §1–2 are external (the official documents this phase is built
on, with the facts that constrain the plans). §3–7 are the repository, verified against
the tree on 2026-10-27 with paths and line ranges so a plan can point at a contract
instead of a memory.

`00-CONTEXT.md` is locked; `00-DECISIONS.md` refines it and wins where they disagree.

**Baseline at planning time:** shared **318** tests, API **710** tests / 45 files,
desktop **593**, admin modules **19/19**, POS modules **16/16**, brand gate over **1 112**
files, packaged print **21/21**, packaged shell **42/42**.

---

## 1. Official sources

| # | Source | What it settles |
|---|---|---|
| S1 | [Paystack — Creating transfer recipients](https://paystack.com/docs/transfers/creating-transfer-recipients/) | Ghana recipient types `ghipss` (bank) and `mobile_money`; `bank_code` is the GHIPSS bank code or the telco code (`MTN`, `VOD`, `ATL`); `recipient_code` is what you save |
| S2 | [Paystack — Single transfers](https://paystack.com/docs/transfers/single-transfers/) | The four steps; reference alphabet and 16–50 length; test transfers return success immediately; `transfer.success` / `transfer.failed` / `transfer.reversed` |
| S3 | [Paystack — Transfer API reference](https://paystack.com/docs/api/transfer/) | `POST /transfer` (`source: balance`, amount in **pesewas**), `POST /transfer/finalize_transfer`, `GET /transfer/:id_or_code`, `GET /transfer/verify/:reference`, `GET /transfer`; the initiate response status is `pending` **or `otp`** |
| S4 | [Paystack — Managing transfers](https://paystack.com/docs/transfers/managing-transfers/) | Balance is checked before a transfer (`Your balance is not enough to fulfill this request`); `data.status: "otp"` + `Finalize Transfer`; the server-approval URL's `blocked`/`rejected` outcomes |
| S5 | [Paystack — Transfers control](https://paystack.com/docs/api/transfer-control/) | `GET /balance` returns per-currency balances in subunits |
| S6 | [Paystack — Webhooks](https://paystack.com/docs/payments/webhooks/) | `x-paystack-signature` = HMAC-SHA512 of the raw body keyed with the secret key; retries for 72 hours; 200 fast (already implemented in Phase 13) |
| S7 | [GRA — E-VAT](https://gra.gov.gh/e-services/e-vat/) | Effective 20% = NHIL 2.5% + GETFund 2.5% + VAT 15% on one base under Act 1151 (1 Jan 2026); receipts generate online **or offline for up to 24 hours**; a certified receipt carries the Commissioner-General's signature, a QR code, an unalterable receipt signature, a timestamp, a serial number, a receipt number and the machine registration code |
| S8 | [GRA E-VAT Help Centre — integrating a sales system](https://evatgra.zendesk.com/hc/en-us/articles/10990923915549-How-do-I-integrate-my-existing-sales-system-with-EVAT) | The integration is a web API with online and offline modes; the SDC fields are `ysdcnum`, `ysdcintdata`, `ysdcmrc`, `ysdcmrctim`, `ysdcredsig`, `ysdcid`; the QR encodes the GRA verification URL plus TIN, signature, total, taxes and date/time; reporting to GRA needs the internet every 24 hours or **stamping stops**; requests include invoice, refund, signature, items, purchase, inventory, TIN validator and Z-report |
| S9 | [GRA E-VAT API integration document](https://documenter.getpostman.com/view/29809098/2sBXVeGCzK) | The current published integration document. It is a JavaScript-rendered portal behind GRA's onboarding, versioned (public copies exist at 6.0, 7.0, 8.1), and not machine-readable here — which is why this phase ships a mock and not a client |
| S10 | [Koolbase — Ghana (GRA E-VAT)](https://docs.koolbase.com/fiscal/ghana) (third-party, built against the same spec) | Independent confirmation of the shape: document kinds `INVOICE`, `REFUND`, `PARTIAL_REFUND`, `REFUND_CANCELATION`; `levy_a` = NHIL, `levy_b` = GETFund, `calculation_type` INCLUSIVE/EXCLUSIVE; returned `num`, `ysdcid`, `ysdcrecnum`, `ysdcregsig`, `ysdcintdata`, `ysdcmrc`, `ysdcmrctim`, `ysdctime`, `qr_code`; error codes `E700` (already signed), `E701` (invoice not found), `E727` (already refunded), `E900` (invalid security key); QR readable at ≥2.5 cm × 2.5 cm (GRA says 3 cm) |
| S11 | [GRA — VAT](https://gra.gov.gh/domestic-tax/tax-types/vat/) | The 2026 rate structure the tax module already implements |
| S12 | [Drizzle — migrations](https://orm.drizzle.team/docs/migrations) and `node_modules/drizzle-kit/bin.cjs` | `drizzle-kit migrate` wraps each file in a transaction; PostgreSQL 17 cannot use an enum value added in the same transaction (already proven in Phases 11–13) |
| S13 | [TanStack Start — search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params) | URL state is validated by the route's `validateSearch`; the console's convention is `.catch(undefined)` rather than `.default()` so a hand-edited link renders |
| S14 | [Hono — middleware](https://hono.dev/docs/guides/middleware) | Route-level `use` ordering and per-route rate limits, as the existing modules already do |

### 1.1 The external facts that change the design

1. **Ghana has exactly two recipient types and we already store both sets of fields.**
   `ghipss` needs `account_number`, `bank_code` (GHIPSS code), `name`, `currency: GHS`;
   `mobile_money` needs the phone as `account_number` and the telco as `bank_code`.
   `supplier_payment_detail` already carries `account_number`, `bank_code`, `bank_name`,
   `momo_network` (`MTN|VOD|ATL`) and `phone` — the mapping is direct, and no schema
   change is needed to create a recipient (S1).
2. **A transfer reference is not free-form.** 16–50 characters, lowercase letters,
   digits, `-` and `_`. `sd-<uuid>` (Phase 13's charge reference) is 39 characters and
   legal; `sdt-<uuid>` is 40 and legal. Do not invent a format with uppercase.
3. **`otp` is a status, not an error.** With "Confirm transfers before sending" enabled
   (the default on many accounts), `POST /transfer` returns `data.status: "otp"` and
   `message: "Transfer requires OTP to continue"`. Nothing moves until
   `POST /transfer/finalize_transfer` with the business owner's OTP. A design that waits
   only for `transfer.success` hangs on every transfer (S3, S4).
4. **Test mode lies about timing.** "Test transfers always return success, because there
   is no processing involved" (S2). The real provider therefore returns `SUCCESS` in the
   initiate response on test keys while production returns `pending` and settles by
   webhook. The mock must model the *delayed* path, or the webhook arm is never exercised
   in development.
5. **Balance is a precondition with a specific failure message.** Paystack checks the
   balance before creating the transfer and fails with
   `Your balance is not enough to fulfill this request` (S4). A console that lets a
   manager submit a 20 000 GHS transfer against a 200 GHS balance has produced a support
   ticket, so the balance is read first and shown.
6. **The transfer's HTTP status is not the transfer's status.** `GET /transfer/verify`
   returns 200 for a failed transfer; only `data.status` is authoritative (S3). This is
   the same rule Phase 13 applied to charges and it must not be re-learned.
7. **`fee_charged` is ours, `amount` is the supplier's.** The verify payload carries
   `amount` (what the recipient receives) and `fee_charged`. Reconciling a payment
   against `amount` is correct; netting the fee into it would show every supplier
   underpaid by the transfer fee.
8. **GRA's 24 hours is a hard stop, not a target.** "The process of reporting the data to
   the GRA portal requires the internet every 24 hours, otherwise EVAT stop stamping"
   (S8). Offline generation is limited to 24 hours (S7). Our queue deadline is therefore
   a statutory boundary and `overdue` must be visible, not a colour.
9. **A certified invoice is never edited.** The correction is a `REFUND` naming the
   certified invoice; GRA refuses a refund against an unknown invoice (`E701`) and one
   that exceeds the remaining refundable amount (`E727`) (S8, S10). Our refunds already
   reference `sale_id`, so the join exists.
10. **`E700` (already signed) is recoverable, everything else is not.** A retry of a
    document GRA already stamped must adopt the existing certificate rather than create a
    second one. That is an idempotency rule, not an error message.
11. **The GRA API document is gated and versioned.** Public copies exist at 6.0, 7.0, 8.1
    and third-party integrations target 8.2; field names differ between them. Writing a
    client against a document we cannot fetch or test would be guesswork with a
    statutory deadline attached. Hence the interface plus a mock (D33).
12. **The tax arithmetic is already right.** 20% = 15% VAT + 2.5% NHIL + 2.5% GETFund on
    one base, Act 1151, effective 1 January 2026 (S7, S11). `packages/shared/src/tax.ts`
    already computes exactly this and `taxBreakdown` absorbs the residual in VAT, so the
    E-VAT payload's `levy_a`/`levy_b` map straight onto `nhilMinor`/`getfundMinor`.

### 1.2 What the external documents do **not** answer

- **Where the QR verification URL lives.** GRA's page says the QR is scanned at a
  verification page; the help centre describes its contents; none of the public material
  fixes the production host. Hence `qr_payload` is stored as returned and never composed
  by us (D35).
- **Whether a Z-report submission is mandatory in the same 24-hour window.** The
  integration request list includes a Z-report (S8) but the reporting obligation is
  described per transaction. Out of scope for the mock; named as a limit.
- **What an OTP-enabled transfer does after 72 hours.** Paystack documents retries for
  webhooks, not the lifetime of an `otp` transfer. The phase treats `AWAITING_OTP` as
  needing a person and never auto-finalises.
- **Whether supplier transfers attract a different fee schedule in Ghana.** The docs give
  `fee_charged` per transfer and a balance check; there is no published table to model.
  The reconciliation reports the fee it is told, and computes nothing.

---

## 2. Terminology this phase fixes

| Term | Meaning here |
|---|---|
| **Oversight document** | A sale, refund, shift or conflict read for review. Never an aggregate. |
| **Receipt copy** | A server-rendered reconstruction of a receipt, printed by a browser. Not a thermal reprint. |
| **Conflict resolution** | A status, a code, a note, an actor and a time, recorded against a `sync_conflict`. Never an edit to the fact. |
| **Stock report** | Current on-hand and value at average cost, plus the period's movements, transfers and counts. |
| **Supplier transfer** | Our instruction to Paystack to pay a supplier. Not a payment. |
| **Settled transfer** | A transfer whose `transfer.success` arrived and whose `supplier_payment` exists. |
| **Unposted transfer** | A succeeded transfer that could not become a payment. Needs a person. |
| **Certification** | GRA's stamp on a document: serial, receipt number, signature, internal data, machine code, time, QR payload. |
| **Submission** | Our queued attempt to obtain a certification. |
| **Certificate deadline** | `occurred_at + 24h`. Derived, never stored twice. |
| **Feature flag** | A typed boolean setting with a `flag.` key. There is no other kind. |

---

## 3. Repository facts — shared

1. **`PERMISSIONS` has 60 entries, `ADMIN` is all 60, `MANAGER` 49, `CASHIER` 0.**
   `packages/shared/src/permissions.ts:3-69`, `:73`, `:75-125`, `:127-128`;
   `permissions.test.ts:134-137` pins the three counts and `:182` pins
   `ADMIN === PERMISSIONS`. Six new permissions make the counts 66/54/0, and the test must
   be updated in the same commit as the permission or the suite fails (which is the
   tripwire working).
2. **The permission list's tail is procurement.** `permissions.ts:56-69` ends
   `payable.void`, `approval.read`, `approval.decide`, `procurement.read/create/receive/return`.
   There is no `conflict.*`, `report.*`, `evat.*`, `transfer.*` or `pos.oversight.*`.
3. **`packages/shared/src/csv.ts` is the only CSV writer.** `csvCell` (`:33-52`) prefixes
   `= + - @ TAB CR LF` and the full-width equivalents with `'`, throws on a non-safe-integer
   number, and quotes when needed; `toCsv` (`:58-73`) emits a BOM and CRLF. `csv.test.ts:9-79`
   pins it. Reports must go through it and must pass money as integers.
4. **`packages/shared/src/tax.ts` is the only tax authority.** `taxBreakdown(amountMinor,
   category, mode)` with integer basis points and the residual absorbed by VAT so
   `base + vat + nhil + getfund === total`. The E-VAT payload's levy fields come from here,
   never from `total * 0.2`.
5. **`packages/shared/src/dates.ts` is the only formatter set.** Africa/Accra is UTC+0 with
   no DST; `accraDayBounds` is half-open; `formatAccraDateTime` is the receipt formatter.
   Report periods and the 24-hour deadline use these, not `toLocaleString`.
6. **`packages/shared/src/refund.ts` shows the pattern this phase copies for labels.**
   `REFUND_REASON_LABELS`, `REFUND_RESTOCK_LABELS` and `refundApprovalRequired` live in
   shared so the console, the API and the till cannot disagree. Conflict codes, transfer
   statuses and E-VAT statuses get the same treatment.
7. **`packages/shared/src/inventory.ts` owns `averageCostAfterReceipt`** (`:16-37`), the
   weighted moving average. A stock report must read the projection, not recompute this.
8. **`packages/shared/src/pos.ts` has no report or oversight types.** `allocateProportionally`
   and `priceCart` only. Nothing to extend; oversight read models are API types.

## 4. Repository facts — API: POS data and oversight

9. **`api/src/modules/pos/pos.routes.ts` is 15 lines and exposes one route:**
   `GET /api/pos/reconciliation` behind `requireSession` +
   `requirePermission('inventory.read')` (`:9-15`). There is no session route for a sale,
   refund, shift or conflict.
10. **Every other POS route is device-facing** in `sync.routes.ts:37-134` behind
    `requireDeviceJwt` plus a per-device rate limit: session, PowerSync token, staff
    authorize/change-pin/binding-validate, upload, conflicts, state, and
    `GET /api/pos/shifts/:id/report?kind=X|Z` (`:127-134`).
11. **`sale` carries every figure a receipt needs** (`pos.schema.ts:142-195`):
    `receiptNumber`, `branchId`, `terminalId`, `deviceId`, `shiftId`,
    `clientTransactionId`, `cashierUserId/StaffId`, `customerId`, `occurredAt`,
    `receivedAt`, `subtotalMinor`, the three discount columns, loyalty points/discount,
    `vat/nhil/getfund/taxTotal`, `totalMinor`, `tenderTotalMinor`, `changeMinor`,
    `creditAmountMinor`, `taxMode`, `conflictCount`. **No status or void column** — a sale
    is never cancelled, only refunded.
12. **`sale_line` carries the full per-line tax split** (`pos.schema.ts:200-228`):
    `netMinor`, `taxableMinor`, `baseMinor`, `vat/nhil/getfund/taxTotal`,
    `totalMinor`, `taxCategory`, `unitCostMinor`, `priceSource`. A server receipt can
    print the same tax rows the till does.
13. **`sale_tender` is ordered and carries the provider reference** (`pos.schema.ts:245-259`):
    `sequence`, `method`, `amountMinor`, `paymentId`, `reference`; unique
    `(saleId, sequence)` and a partial unique on `paymentId` (`:263-269`).
14. **`refund`, `refund_line` and `refund_tender` already hold the whole document**
    (`pos.schema.ts:452-575`) including `number`, `reasonCode`, `note`, the tax split,
    `approvedByUserId/StaffId`, `approvalId`, and per-tender `status`, `settledAt`,
    `providerRefundReference`. An oversight refund list needs no new table.
15. **`shift` has the variance and the Phase 12 review columns** (`pos.schema.ts:89-135`):
    `status`, `openedAt`, `closedAt`, `openingFloatMinor`, `countedCashMinor`,
    `clientExpectedCashMinor`, `serverExpectedCashMinor`, `varianceMinor`,
    `reviewStatus`, `reviewedBy`, `reviewedAt`, `reviewNote`, `closeNote`, `openedBy`,
    `closedBy`.
16. **`shift_report` is the immutable Z snapshot** (`pos.schema.ts:624-679`) with unique
    `shiftId` and `(branchId, closedAt)`, no update or delete path, and every money column
    the print needs — **but no `cash_refund_minor`**. That absence is why the printed
    drawer block cannot itemise cash refunds (D1, defect 11).
17. **`sync_conflict` has a status and no way to set it.** Columns
    (`pos.schema.ts:333-357`): `branchId`, `terminalId`, `deviceId`, `saleId`, `shiftId`,
    `type`, `severity`, `status` (`OPEN|RESOLVED|DISMISSED`, default `OPEN`), `details`
    jsonb, `resolvedBy` text, `resolvedAt`, `resolutionNote`, `createdAt`. **No
    `resolution_code`, no `updated_at`.** The only writer that sets a non-`OPEN` status is
    the seed (`seed/helpers.ts:1591-1603`).
18. **`sync_conflict.details` is PII-free by construction.** `pos.conflicts.ts:15` states
    the rule — "Ids and amounts only: never customer names, phones, tokens, or PIN
    material" — and the 16 types' payloads obey it (`pos.service.ts` call sites tabled in
    the Phase 14 audit). An oversight detail can render it verbatim.
19. **There are four conflict read shapes today and none for a session:** the device list
    `GET /api/pos/sync/conflicts` (`sync.routes.ts:104-115`, `since`/`limit`, filtered by
    the JWT's terminal), the device count (`countOpenConflicts`), the dashboard severity
    counts (`analytics.repository.ts:393-401`) and the nightly oversell scan
    (`counts.repository.ts:698-723`). No resolution route, validator, service or
    permission exists anywhere.
20. **`cart_void` has no read path at all** (`pos.schema.ts:582-617`); it is written
    (`pos.service.ts:2801-2851`) and aggregated into the Z's `void_count`
    (`pos.repository.ts:1168-1174`). Oversight reads it through the shift detail, not a
    list (D4).
21. **`pos.repository.ts` already has the reads oversight needs, unrouted:**
    `findSaleById:634`, `selectSaleLinesForRefund:644`, `selectSaleTendersForRefund:655`,
    `findSaleByReceiptNumber:609`, `findShiftById:242`, `findShiftWithTerminal:389`,
    `findShiftReportByShiftId:1229`, `selectShiftReportFigures:1118`,
    `selectShiftCashTotals:288`, `countShiftSales:416`. The oversight repository composes
    these where they fit and adds paged/filtered selectors where they do not.
22. **`getXReport` computes and writes nothing; `getZReport` reads the snapshot and
    refuses to rebuild** (`pos.service.ts:932-1044`). Both are device-gated and refuse a
    shift outside the calling device's terminal/branch (`:914-922`). A session gate is a
    new caller of the same functions, not a second implementation.
23. **`refundApprovalRequired` is shared and the approval loader is registered**
    (`pos.service.ts:3069-3110`); the console renders the refund subject
    (`admin/src/modules/approvals/components/subject/refund-subject.tsx`). Oversight's
    refund detail links to it; it does not re-implement it.
24. **`sale.receiptNumber` is minted on the till**, not the server: `applySale` validates
    it (`pos.service.ts:1194`), rejects a replay by `findSaleByReceiptNumber` (`:1258`) and
    stores it (`:1762`). The desktop's `document_sequence` allocates it inside the sale
    transaction. A server receipt copy therefore prints the till's number verbatim.
25. **The dashboard's conflict tile links to `/audit`** (`admin/src/modules/dashboard/components/needs-attention.tsx:61-71`)
    because no conflict screen existed. Its `to` union (`:14`) is the list of screens to
    extend.

## 5. Repository facts — API: reports, payments, settings, audit

26. **The analytics reports exist and are reconciled, and this phase does not rebuild
    them.** `getOverview`, `getSales`, `getProducts`, `getTax`, `getInventory`, `getCredit`,
    `getLoyalty`, `getPayables` (`analytics.service.ts:188-905`) with reconciliation tests
    at `analytics.test.ts:455,625,668,1347,1381,1419,1465,1515`. They are aggregates; none
    returns a document.
27. **The four non-sales analytics exports are branch-level and empty for a manager.**
    `getInventory/getCredit/getLoyalty` populate `byBranch` only for an admin
    (`analytics.service.ts:692`, `:737`, `:792`) and `exportInventory/credit/loyalty` build
    rows from `report.byBranch` (`:931`, `:963`, `:995`); `exportPayables` exports the top
    10 suppliers (`:1033-1038`). A manager's CSV is a `TOTAL` row. That is the defect D17
    refuses to reproduce.
28. **`sendCsv` is the response contract to copy** (`analytics.controller.ts:58-63`):
    `text/csv; charset=utf-8`, `content-disposition: attachment; filename="…"`,
    `no-store, private`, buffered body. 50 000-row cap (`analytics.service.ts:546`).
29. **Credit ageing is complete at customer and charge level** —
    `credit.service.ts:719-806`, `AGING_BUCKET_KEYS`, `settleCharges`'s FIFO settlement,
    branch totals and `oldestDueDate`; route `GET /api/credit/aging` under `credit.read`
    (`credit.routes.ts:80-86`). No CSV.
30. **Payables ageing is complete at supplier and invoice level** —
    `payables.service.ts:1029-1112`, buckets by days past due, on-account and credit notes
    kept separate; `GET /api/payables/aging` under `payable.read`
    (`payables.routes.ts:94-100`, query `asOf`, `branchId`, `supplierId`). No CSV, no print.
31. **Loyalty liability is as-of-now and global** —
    `loyalty.service.ts:483-522`, `pointsToValueMinor = floor(points * 100 / pointsPerCedi)`
    (`:472-481`), `GET /api/loyalty/liability` under `loyalty.read`
    (`loyalty.routes.ts:29-35`) with `from`/`to` filtering the *activity*, not the balance.
    There is no `asOf` and this phase does not add one (D21).
32. **Stock valuation is the projection, and analytics already sums it** —
    `stock_level.quantity_on_hand × avg_cost_minor` (`analytics.repository.ts:1008-1036`),
    `inventory.service.toStockRow`'s `valueMinor` (`:545-563`), and the stock list requires a
    branch (`inventory.service.ts:573-600`) while low-stock may span branches
    (`:602-612`). An all-branch stock report needs a selector that takes `branchId: null`.
33. **The movement filter cannot name four movement types.**
    `inventory.validation.ts:59-61` allows `RECEIPT|ADJUSTMENT|TRANSFER_OUT|TRANSFER_IN|COUNT_VARIANCE`
    while `inventory.schema.ts:15-31` also stores `SALE`, `WRITE_OFF`, `SUPPLIER_RETURN`
    and `RETURN`. D18 fixes the filter, not the table.
34. **Transfers and counts have paged lists but no date range** —
    `transfers.validation.ts:80-100`, `counts.validation.ts:31-36`. A period report needs
    `from`/`to` on both, added backwards-compatibly.
35. **The payment provider seam has five methods and no transfer method** —
    `payments.provider.ts:69-76`: `createMobileMoneyCharge`, `createCardCheckout`,
    `createBankTransferCharge`, `verify`, `refund`, plus `ProviderUnavailableError` as the
    only retryable throw. `getPaymentProvider()` (`:86-110`) caches one instance chosen by
    `PAYSTACK_MODE`.
36. **The Paystack client's `request()` is the pattern a transfer client follows** —
    `payments.paystack.provider.ts:299-365`: 20 s timeout, socket/timeout → unavailable,
    `>=500` → unavailable, `status:false` → rejected result, and logs only
    `{ provider, endpoint, status, durationMs }`.
37. **`payment_event` is the provider-event ledger** (`payments.schema.ts:121-141`):
    `provider`, `eventType`, `bodySha256`, `providerReference`, `paymentId`, `status`,
    `detail` (allowlisted projection), `receivedAt`, `processedAt`; unique
    `(provider, bodySha256)`. `HANDLED_EVENTS` is `charge.success`, `charge.failed`,
    `bank.transfer.rejected` (`payments.service.ts:57`) plus the five `refund.*` names
    (`:237-245`). Nothing in it can name a supplier transfer today.
38. **Supplier payments are complete, manual and Paystack-free** —
    `payables.service.ts:612-770` (idempotency by `(branch_id, idempotency_key)`, invoice
    locks in sorted id order, `APPLY` allocations, invoice projection, audit with
    `onAccountMinor`) and `:772-854` (void via `RELEASE`). `supplier_payment.status` is
    `COMPLETED | VOID` (`payables.schema.ts:37`), method is `CASH | BANK | MOMO`
    (`:34-35`) with the comment "PAYSTACK joins this enum in Phase 8".
39. **`supplier_payment_detail.paystackRecipientCode` exists and is written by nothing**
    (`suppliers.schema.ts:77`), is absent from the view type
    (`suppliers.types.ts:51-66`) and from the mapper (`suppliers.service.ts:82-102`), and
    the account number is masked everywhere except the owning supplier's detail payload.
40. **`supplier_payment` has no provider column at all** — `number`, `supplier_id`,
    `branch_id`, `method`, `amount_minor`, `reference` (free text), `paid_at`,
    `payment_detail_id`, `status`, void columns, `note`, `idempotency_key`, `created_by`,
    timestamps (`payables.schema.ts:156-194`). A transfer cannot be matched to a payment
    today by anything but a string a human typed.
41. **`SETTING_DEFINITIONS` has 46 keys and derives `writableBy`** —
    `platform/settings.validation.ts:5-348`; `settings.service.ts:32-38` derives
    `branchScoped ? 'manager' : 'admin'` unless explicit. `resolveSetting` (`:40-81`)
    returns `{value, source}` and `listSettings` (`:110-118`) resolves every key.
    `updateSetting` (`:120-232`) audits before/after and enforces `writableBy`.
42. **The console's settings page renders 19 of the 46 keys** and drops the rest at
    `settings-page.tsx:236` because its local `SettingKey` union has no entry for them
    (`admin/src/modules/settings/types/index.ts:1-20`). The API already returns
    `writableBy` (`settings.types.ts:13-20`); the console type omits it.
43. **An admin with no branch writes a branch-scoped key globally.** The page sends
    `branchId = null` (`settings-page.tsx:238`) and the service writes a global row
    (`settings.service.ts:142`, returning `source: 'global'`). Silent, valid and a footgun.
44. **The audit log has one route and no export** — `GET /api/audit` under `audit.read`
    (`audit.routes.ts:9-15`) with filters `actorId`, `actorStaffId`, `action`, `entity`,
    `entityId`, `branchId`, `from`, `to`, paging (`audit.validation.ts:4-15`), newest first
    with a count. The console renders before/after as a field diff
    (`audit-page.tsx:202-288`) and has no CSV.
45. **Audit payloads carry customer PII.** `staff.created` includes email
    (`staff.service.ts:170-175`); `customer.created`/`customer.updated` include name and
    phone (`customers.service.ts:110-118`, `:174-182`, `:222-231`). Customer erasure
    scrubs the customer row in place (`customers.repository.ts:92-108`) but leaves the
    historic audit rows. There is no redaction layer at insert.
46. **There is no feature-flag anything.** A repo-wide search for
    `featureflag|feature_flag|feature-flags` returns nothing, and no `flag.*` setting key
    exists. FOUND-11 and the locked D7 both name it; nothing implements it.
47. **`pg-boss` queues are declared in one file** — `api/src/jobs/queues.ts`: six queues
    with Africa/Accra cron, `missed: 'once'`, idempotent `ensureQueue`, one worker each and
    one boot list (`:145-153`). `enqueueRefundDispatch` (`:71-80`) is the "enqueue after
    commit" pattern a submission queue and a transfer sweep copy.
48. **The enum rule is architectural.** Every enum addition in this repository has its own
    `NNNN_enum_<slug>.sql` before the DDL that writes it (0009, 0011, 0013), because
    `drizzle-kit migrate` wraps a file in a transaction and PostgreSQL 17 refuses to use a
    value added in that same transaction.

## 6. Repository facts — admin console

49. **`scripts/check-modules.mjs` hard-fails a wrong module shape and requires 19
    modules** (`:38-59`), route files ≤ 25 lines (`:98`) that import exactly one barrel and
    render only `*Page`/`*Layout` (`:164-169`). Adding `pos-oversight` means editing
    `REQUIRED_MODULES` — a root file, so the controller owns that edit (lane rule).
50. **No `pos-oversight` module exists and Phase 8 deferred it by name**
    (`08-admin-modules-shell/13-PLAN.md:171`). Admin has 19 modules, 35 authenticated
    route files, and no `/sales`, `/refunds`, `/shifts` or `/conflicts` route.
51. **The nav is one table** — `admin/src/components/layout/sidebar.tsx:71-131`
    (`NAV_GROUPS`), filtered by `visibleGroups(role)` (`:241-250`), with `NavPath` (`:42-57`)
    and `PAGE_LABELS` (`:150-172`) and a breadcrumb deriver (`:221-239`). A new section
    touches all four.
52. **URL state is Zod in the module's `utils/`, with `.catch(undefined)`** —
    `approvals/utils/approval.ts:232-259`, `analytics/utils/search.ts:17-38`. A `tab` param
    for `/pos` follows that shape, and a hand-edited link renders rather than throws.
53. **Tables, paging, empty and error states are shared primitives** —
    `components/ui/table.tsx`, `components/common/pagination.tsx:3-43`,
    `table-message.tsx:5-66`, `empty-state.tsx:17-39`, `status-badge.tsx:6-23`,
    `page-header.tsx:15-31`, `confirm-dialog.tsx:11-40`, `lib/toast.ts:8-29`.
54. **`apiDownload` already exists for CSV** (`admin/src/lib/api.ts:110-146`) and reads the
    filename from `content-disposition`; its only caller is the analytics export button
    (`admin/src/modules/analytics/components/export-button.tsx`). It is the export
    mechanism for every new report.
55. **Print is browser print and already styled** — `admin/src/styles.css:16-22` (`@page
    A4`, 16 mm margins), `app-shell.tsx:34,40,71` hide the chrome, and two screens call
    `window.print()` (`credit-statement-page.tsx:118`, `order-detail-page.tsx:120`). There
    is no PDF generator anywhere in the repo.
56. **The console has no unit tests; its gate is a browser walkthrough** —
    `admin/package.json` has no `test` script, and `admin/test/walkthrough-sections.mjs`
    (69 KB) drives `SECTIONS` (`:133-190`) and `SECTION_ASSERTIONS` (`:191-290`), failing
    on any console error or ≥ 400 response (`:302-334`). Phase 14 extends both lists.
57. **Role checks in the console are UX only** — `admin/src/lib/role.ts:9-13`
    (`hasPermission`), delegating to shared `can`; the API enforces. Every new screen uses
    it for visibility and nothing else.

## 7. Repository facts — desktop

58. **`ReceiptModel` is the receipt contract and the E-VAT fields are already declared
    null** — `desktop/src/renderer/lib/receipt/render.ts:65-109` with `evatSerial`,
    `qrPayload`, `signature` (`:106-108`), assigned `null` at `:179-181` and pinned by
    `render.test.ts:430-456`. `ReceiptContext` (`:37-44`) takes the seller string and the
    branch code from `pos.receiptHeader`.
59. **The printer contract has exactly two line kinds** — `PrintLine = { text, bold? }`
    (`desktop/src/shared/printing.ts:29-34`), `appendLine` (`escpos.ts:24-30`). No QR, no
    barcode, no image, no alignment. The printer library supports `qr()` and `barcode()`
    (`node_modules/@maxxuxx/node-printer/dist/index.d.ts:277-278`) but the job schema
    (`src/main/ipc/printer.ts:57-77`, `.strict()`) would reject a line kind it does not
    know. That is why D39 puts QR on Phase 15 rather than shipping an untestable path.
60. **The Z/X document is a separate builder with four line roles** —
    `report-render.ts:1-215`; `ShiftReportFigures` (`:24-68`) has `refundMinor` (all
    refunds) and no cash figure, and the DRAWER block (`:198-214`) prints float, cash in,
    cash out, expected, counted, variance. The subtraction the expected-cash formula
    performs (settled cash refunds) has no line, which is Phase 13's §6 carry-forward.
61. **`shift_report` is written inside the close transaction and is the only Z source**
    (`pos.service.ts:932-991`); the till's local `shift` row has no report fields. The
    desktop fix therefore reads a new column from the snapshot it already prints.
62. **The till's close is cashier-only, by name.** `lib/shift/shift-service.ts:closeShift`
    calls `openShiftOrThrow`, which throws `NOT_OWNER` unless the signed-in staff member is
    the shift's cashier, so a manager can only close their own drawer even though the
    server honours `closedBy` (`13-VERIFICATION.md` §6, STATE "carry-forwards").
63. **`reconcileShifts` and the till's expected cash already subtract settled cash refunds**
    (Phase 13's fix, commits `838ce19`, `242237b`); only the printed document is missing the
    line. No arithmetic changes in Phase 14.
64. **Package scripts and gates** — root `bun run test` (never bare `bun test`),
    `lint`, `check-types`, `modules:check:strict`, `modules:check:pos:strict`,
    `brand:check`, plus `test:counter` run by hand. `bun run db:test:prepare` is required
    after a fresh compose up.
