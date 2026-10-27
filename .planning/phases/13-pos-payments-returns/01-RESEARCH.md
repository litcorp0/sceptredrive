# Phase 13 — Research

Read once, do not repeat. Two halves: **§1–2 are external** (the official docs this phase is
built on, with the exact facts that constrain the plans), **§3–4 are the repository** (verified
against the tree on 2026-10-27, with paths and line ranges so a plan can point at a contract
rather than a memory).

`00-CONTEXT.md` is locked; `00-DECISIONS.md` refines it and wins where they disagree.

---

## 1. Official sources

| # | Source | What it settles |
|---|---|---|
| S1 | [Paystack — Accept Payments](https://paystack.com/docs/payments/accept-payments/) | Charge API vs Checkout; the `data.status` state machine; the client never asserts success |
| S2 | [Paystack — Charge API reference](https://paystack.com/docs/api/charge/) | `/charge`, `submit_pin`, `submit_otp`, `submit_phone`, `submit_birthday`, `submit_address`, `GET /charge/:reference`; `mobile_money{phone,provider}`; `bank_transfer{account_expires_at}` |
| S3 | [Paystack — Payment Channels](https://paystack.com/docs/payments/payment-channels/) | Ghana MoMo provider codes `mtn`/`atl`/`vod`; `pay_offline` + 180 s; Pay-with-Transfer in Ghana; the Card API needs PCI-DSS |
| S4 | [Paystack — Webhooks](https://paystack.com/docs/payments/webhooks/) | `x-paystack-signature` = HMAC-SHA512 of the raw body keyed with the secret key; 200 fast; retry schedule; IP allowlist |
| S5 | [Paystack — Verify Payments](https://paystack.com/docs/payments/verify-payments/) | Transaction statuses; `GET /transaction/verify/:reference`; verify the amount as well as the status |
| S6 | [Paystack — Transactions API](https://paystack.com/docs/api/transaction/) | `POST /transaction/initialize` with `channels`, `reference`, `metadata`, `callback_url`; `authorization_url` + `access_code`; transaction id is an unsigned 64-bit integer |
| S7 | [Paystack — Refunds](https://paystack.com/docs/payments/refunds/) | `POST /refund` with `transaction` + optional `amount`; refund statuses and their transaction-status pairing; `refund.*` events; `needs-attention` retry |
| S8 | [Paystack — Test Payments](https://paystack.com/docs/payments/test-payments/) | MTN test number `0551234987` (no PIN/OTP); card fixtures; refund-outcome cards |
| S9 | [Paystack — API introduction](https://paystack.com/docs/api/) | GHS subunit is the pesewa, minimum GHS 0.10; the `{status,message,data}` envelope; test and live keys select the environment |
| S10 | [PowerSync — Local-Only Usage](https://docs.powersync.com/client-sdks/advanced/local-only-usage) | `localOnly: true` tables are not enqueued for upload; changing a local-only table to synced (or renaming/removing it) **deletes its data** when the schema is applied |
| S11 | [PowerSync — Custom backend](https://docs.powersync.com/configuration/app-backend/setup) (skill reference `references/custom-backend.md`) | The upload endpoint must apply writes synchronously and return **2xx even for validation errors**; 4xx blocks the queue permanently; `transaction.complete()` is mandatory |
| S12 | [Electron — Security](https://www.electronjs.org/docs/latest/tutorial/security) | Remote content (the Paystack checkout) must be in a window with `sandbox`, `contextIsolation`, no `nodeIntegration`, no preload, navigation limited, `setWindowOpenHandler` denying; never `shell.openExternal` with untrusted input; validate every IPC `sender` |

### 1.1 The facts that change the design

1. **Ghana MoMo is asynchronous by construction.** `POST /charge` returns
   `data.status = "pay_offline"` and a `display_text`; the customer authorises on the handset;
   the network kills the attempt after **180 seconds**; settlement arrives as `charge.success` on
   the webhook, and the documented fallback is `GET /transaction/verify/:reference` (S3, S5).
   A tender therefore has a real expiry, not just a spinner.
2. **The Charge API's status set is not a boolean.** `pending`, `timeout`, `success`,
   `send_otp`, `send_birthday`, `send_phone`, `send_address`, `pay_offline`, `failed`,
   `pending_bank_transfer` (S2). `pending` explicitly instructs "wait 10 seconds or more, then
   `GET /charge/:reference`". Any client that maps `status !== 'success'` to "failed" will cancel
   live money.
3. **Card cannot use `/charge`.** The Card API is gated on PCI-DSS AOC/RoC (S3). Card must go
   through Paystack Checkout: `POST /transaction/initialize` with `channels: ['card']` returns an
   `authorization_url`; the customer pays there; our server learns the outcome from
   `charge.success` or `GET /transaction/verify/:reference` (S6, S5). No card field is ever
   rendered by our code, and no card data reaches any of our stores.
4. **Bank transfer is "Pay with Transfer", and it is available in Ghana.** `POST /charge` with
   `bank_transfer.account_expires_at` returns `pending_bank_transfer` plus an `account_number`,
   `account_name` and `bank` to show the customer; the account expires in 15 min–8 h, clamped by
   Paystack (S3). The customer's transfer is confirmed by `charge.success`, and a wrong amount
   sends `bank.transfer.rejected` (S3).
5. **The webhook signature is over the raw bytes.** `HMAC-SHA512(rawBody, secretKey)` compared to
   `x-paystack-signature` (S4). Parsing first and re-serialising breaks the comparison — this is
   the single most common integration defect, and the route must read `c.req.text()` once.
6. **A webhook must be acknowledged before it is processed.** Paystack retries every 3 minutes
   for the first four attempts, then hourly for 72 hours; a slow handler is an automatic failure
   (S4). Our handler therefore verifies the signature, persists the event idempotently, and
   returns 200 — settlement is applied in the same transaction, not queued behind it, because
   the upload path is what the till is waiting on.
7. **Refunds have five states, not two.** `pending`, `processing`, `needs-attention`, `failed`,
   `processed`, and the transaction moves to "reversal pending" / "reversed" with them (S7).
   `failed` means Paystack credited **our** account; `needs-attention` needs bank details we do
   not collect. A refund row is therefore a state machine, and "refunded" must not be written at
   request time.
8. **Refund amount is capped by the original transaction** and a partial refund passes `amount`
   (S7). Per-tender refund tracking is ours to enforce; Paystack only knows the transaction total.
9. **Amounts are integer subunits, GHS minimum 0.10, transaction ids are u64** (S9, S6). We send
   `amountMinor` unchanged and store the Paystack id as a string or a u64 column, never a JS
   `number` in a `jsonb` round-trip that could lose precision.
10. **A local-only PowerSync table is the right home for held carts, and it is fragile in one
    specific way**: if it later becomes synced, its data is deleted on schema application (S10).
    That is a reason to decide the shape once — and D16 already decided it.
11. **The upload endpoint must return 2xx for data errors** (S11). A refund that the server
    refuses must still advance the till's outbox; the refusal is recorded as a `sync_conflict`,
    not as an HTTP 400. This is Phase 6's existing rule and it applies unchanged to the new
    outbox types.

### 1.2 What the external docs do **not** answer

- Paystack has no customer identity we can reuse: `email` is **required** on every charge and
  initialize call (S2, S6), and a walk-in customer has none. P13-D7 resolves this with a
  terminal-scoped placeholder address; it is a routing label, never a contact channel.
- There is no documented "cancel this charge" endpoint. A tender that the cashier abandons is
  abandoned **on our side** (status `ABANDONED`), and if the customer later approves on the
  handset the `charge.success` webhook arrives against a sale that no longer waits for it. That
  is the one genuinely new conflict class this phase introduces (P13-D9).
- Paystack does not say which MoMo provider a number belongs to. The cashier picks `mtn`, `atl`
  or `vod` explicitly; guessing from a prefix is not in the docs and is not reliable across
  ported numbers.

---

## 2. Terminology this phase fixes

| Term | Meaning here |
|---|---|
| **Tender** | One payment instrument applied to one sale: `CASH`, `CREDIT`, `MOMO`, `CARD`, `BANK_TRANSFER`. A sale may carry several, and may carry two of the same method. |
| **Tender intent** | The client's request to apply amount X by method M. Not money until the tender is `PAID` (or `PENDING` for an electronic method). |
| **Settled** | `PAID` and irreversible from our side. Cash is settled on completion; electronic is settled on webhook/verify. |
| **Unpaid balance** | `sale.total − Σ settled tenders`. A sale is final only at zero. D2/D3. |
| **Refund** | A new document against a sale, capped per line at `quantity − already_refunded` (D7). |
| **Refundable remainder** | Per tender: the tender's `amountMinor` minus refunds already booked against that tender. |
| **Z-report** | Immutable snapshot written inside shift close (D10). |
| **X-report** | On-demand, never stored (D10). |
| **Held cart** | A terminal-local parked cart with a label (D16). Never synced, carries no money. |
| **Cart void** | An unsigned, reason-coded record of an abandoned cart, uploaded as a business fact (D18). |

---

## 3. Repository facts — shared, sync and brand

Verified 2026-10-27. These are the contracts the plans must build on, not change casually.

1. **`packages/shared/src/pos.ts` has no tender arithmetic.** It exports
   `allocateProportionally(amountMinor, weights): number[]` (largest-remainder, sums exactly) and
   `priceCart(lines, options): PricedCart` (gross → line discounts → sale discount pro-rata →
   loyalty pre-tax pro-rata → per-line tax). There is **no** change calculation, no credit check,
   no tender model in shared. `PricedLine` already separates `netMinor` (before loyalty) from
   `taxableMinor` (the tax base).
2. **`packages/shared/src/money.ts` exports exactly one function**, `averageBasketMinor`. There is
   no shared `formatGhs` or `parseGhsToMinor`; every client has its own in `lib/format.ts`, and
   the two differ (the admin one is integer-only; the desktop one divides by 100 through `Intl`).
   A new shared money helper is a change to both clients' display paths — Plan 01 must not do it
   casually.
3. **`tax.ts` is the only tax authority**: `taxBreakdown(amountMinor, category, mode)`, integer
   basis points, residual absorbed by VAT so `base + vat + nhil + getfund === total` exactly,
   rates 15% / 2.5% / 2.5% on one base. A refund's tax reversal must be computed through this
   function, never by multiplying a total by 0.2.
4. **`packages/shared/src/pin.ts` is policy only.** `isValidPinShape`, `isTrivialPin`,
   `pinProblem`. The offline proof lives in `desktop/src/main/ipc/pin.ts`
   (`hashPin`/`verifyPin`, Argon2id t=3 m=64 MiB p=4, 16-byte salt **also used as the pepper**) and
   `desktop/src/renderer/lib/auth/bindings.ts` (`verifyOfflinePin`, `unlockWithManagerPin`,
   `BindingError` codes `INVALID|LOCKED|INACTIVE|EXPIRED|OFFLINE|NOT_FOUND`). The proof object a
   sale already ships is `CartOverrideProof { approverUserId, approverStaffId, approverRole,
   bindingId, pinVersion, reasonCode, note, approvedAt }`.
5. **`APPROVAL_TYPES` already contains `REFUND`**, mapped by `APPROVAL_DECIDER_ROLE` to `ADMIN`,
   and `canDecideApproval` is the only authority function. `api/.../approvals.service.ts` maps
   `REFUND` to the `other` subject and `approvals.registry.test.ts` treats it as the honest
   *unregistered* type — Phase 13 is the commit that registers it, and the boot list in
   `api/src/app.ts` grows with it.
6. **`PERMISSIONS` has 59 entries and no payment, refund or tender permission.**
   `CASHIER` has an **empty** permission array by design ("Cashiers authenticate on the POS ...
   and never call the admin API"). A `pos.refund`-style permission would be granted to nobody who
   uses the till; refund authority on the till is the manager PIN proof, and the server-side
   permission belongs to whoever reviews the retrospective approval.
7. **`powersync/sync-config.yaml` syncs eight tables, all downward**: `product`, `barcode`,
   `product_price`, `stock_level`, `customer`, `credit_profile`, `loyalty_account`, `loyalty_lot`.
   Sales, shifts, tenders, ledgers and audit are deliberately **not** synced; the file says so.
   `powersync/init/powersync.sql` scopes the publication to the same eight. Adding a synced table
   requires both files plus `ALTER PUBLICATION`.
8. **The POS schema is `localOnly` for every write table** —
   `desktop/src/renderer/lib/powersync/schema.ts` lists the eight mirror tables in `SYNCED_TABLES`
   and marks `sale`, `sale_line`, `sale_tender`, `cart_draft`, `cart_draft_line`, `shift`,
   `cash_movement`, `outbox`, `local_*_delta` as `{ localOnly: true }`. The header states why:
   PowerSync would put row writes in its CRUD queue, "which is not our atomic unit (a sale is)".
9. **The outbox is the only write path.** `desktop/src/renderer/lib/outbox/outbox-types.ts`:
   `OUTBOX_TYPES = ['SALE','SHIFT_OPEN','CASH_MOVEMENT','SHIFT_CLOSE']`, statuses
   `pending|in_flight|acked|conflict|dead_letter`, idempotency `(terminal_id,
   client_transaction_id)` enforced by `sale_terminal_client_transaction_unique`. The upload route
   is `POST /api/pos/sync/upload` behind `requireDeviceJwt`, 60/min per device.
10. **`sale_tender_method` is `['CASH','CREDIT']` and `sale_tender` carries
    `uniqueIndex('sale_tender_sale_method_unique').on(sale_id, method)`** — one row per method per
    sale. Split tender needs the enum extended **and** the index relaxed to include a sequence
    (D1/D8). `sale` already has `changeMinor`, `tenderTotalMinor`, `creditAmountMinor`.
11. **Local sale completion is one transaction**: `completeSale` validates tenders
    (zero total → amount 0; credit → customer + amount = total; cash → amount ≥ total), writes
    sale + lines + tenders + stock/credit/loyalty deltas + the outbox row, and clears the draft.
    `TenderMethod = 'CASH' | 'CREDIT'` is declared separately in
    `desktop/.../sale/sale-draft.ts` and must move to shared when the enum grows.
12. **Credit headroom already models pending offline commitments**:
    `creditHeadroom(snapshot) = limit − (balance + pendingMinor)` where `pendingMinor` is the sum
    of unacked `local_credit_delta` rows. A credit tender in a split sale must go through the same
    helper, not a new subtraction.
13. **`packages/brand` chart tokens 6 and 7 exist for exactly this phase** —
    `--chart-6 #5b6ea8`, `--chart-7 #8c5a8f`, with the comment that they "extend it so a tender
    mix stays honest once Phase 13 adds MoMo, card, and bank". No new palette work is needed for a
    five-way tender mix.
14. **Dates**: `packages/shared/src/dates.ts` is the only formatter set; Africa/Accra is UTC+0
    with no DST so no timezone library is used; `accraDayBounds` is half-open `[from,to)`;
    `formatAccraDateTime` is the receipt formatter. A Z-report's day boundary must use these.
15. **`desktop/src/renderer/lib/powersync/schema.ts` mirrors `print_status`, `printed_at`,
    `print_error`, `reprint_count`** on the local sale but the server table does not carry them.
    A server-side reprint (Phase 14, ADM-07) therefore renders from server columns; the till's
    reprint of a local sale is unaffected by this phase.

## 4. Repository facts — API, schema and jobs

16. **`applySale(context, payload, executor = db)` never opens a transaction.** It threads
    `executor` through every repository call; the one `db.transaction` per client transaction is
    `sync.service.ts:applyUpload` → `applyTransaction` (line 375). `openShift`, `recordCashMovement`
    and `closeShift` follow the same rule — "the caller owns the transaction and idempotency".
    Every new POS write path must slot in beside them, not open its own.
17. **`applySale` explicitly rejects split tender today**: `tenders.length > 1` throws
    `INVALID_TENDER` at `pos.service.ts:1025-1027`, while the wire schema already permits
    `.max(2)` (`sync.validation.ts:130-140`). The two are deliberately out of step and Plan 04
    closes the gap.
18. **`sale_tender.reference` is hard-written `null`** (`pos.service.ts:1357-1365`), and the table
    has `uniqueIndex('sale_tender_sale_method_unique').on(sale_id, method)` with **no ordinal
    column** (`pos.schema.ts:215-231`). Two tenders of the same method are structurally impossible
    today, and there is nowhere to put a provider reference.
19. **The upload union is closed in four files** and TypeScript exhaustiveness makes a fifth silent:
    `api/src/modules/sync/sync.types.ts:59` (`UploadTransactionType`),
    `desktop/src/renderer/lib/outbox/outbox-types.ts:15` (`OUTBOX_TYPES`),
    `desktop/src/renderer/lib/api/types.ts:100`,
    `desktop/src/renderer/lib/shift/shift-repository.ts:270`. `dispatchTransaction`
    (`sync.service.ts:295-360`) has no `default` arm, so a new member is a compile error there —
    which is the tripwire working.
20. **`pos_sync_transaction` is the idempotency ledger**: `unique(terminal_id,
    client_transaction_id)`, `status` is free `text` (`APPLIED|REJECTED`), `result` is `jsonb`.
    `applyTransaction` reserves in one transaction, dispatches, then stores the result; an
    `AppError` with `statusCode < 500` is caught, **re-reserved, and stored as `REJECTED` with the
    error**, and only a 5xx escapes to make the client retry (`sync.service.ts:367-441`). That is
    the model for every new type: a refusal is data, not an HTTP error.
21. **`pos_transaction_type` is `['SALE','SHIFT_OPEN','CASH_MOVEMENT','SHIFT_CLOSE']`** and
    `pos.routes.ts` exposes exactly **one** authenticated route (`GET /api/pos/reconciliation`).
    Every other POS endpoint is device-facing and lives in `sync.routes.ts` behind
    `requireDeviceJwt` plus a per-device `rateLimit`. New device endpoints belong there.
22. **No payment code exists.** `grep -rni paystack api/ admin/ desktop/ packages/` returns
    **zero** application hits; `.env.example` declares `PAYSTACK_MODE`, `PAYSTACK_SECRET_KEY` and
    `PAYSTACK_WEBHOOK_SECRET` but `api/src/config/env.ts` never reads them; there is no `payment`,
    `payment_event`, `refund` or `webhook_event` table, no provider interface, no HMAC helper, no
    pg-boss queue. Phase 13 starts from zero on this axis and must add the env keys to the Zod
    schema before anything reads them.
23. **Settings are declared once** in `api/src/modules/platform/settings.validation.ts` as
    `SETTING_DEFINITIONS` `{ schema, defaultValue, branchScoped, writableBy? }`; `writableBy`
    derives as *branch-scoped ⇒ manager, otherwise admin*, and only an explicit `writableBy` can
    make a key both branch-overridable and admin-writable. `getSettingValue(key, { branchId },
    executor)` is the typed read. There is no refund, tender or payment key today.
24. **The approvals registry is three edits plus the owning service**: `APPROVAL_TYPES` and
    `APPROVAL_DECIDER_ROLE` (shared), the `approval_type` pgEnum, `SUBJECT_KIND`, an
    `ApprovalSubject` arm, a `registerDecisionHandler` + `registerSubjectLoader` pair at module
    load, and one append to **both** `assertDecisionHandlersRegistered` and
    `assertSubjectLoadersRegistered` in `api/src/app.ts`. `REFUND` already exists in the enum, the
    role map (`ADMIN`) and the pgEnum — it is absent from `SUBJECT_KIND`'s real arms (`'other'`),
    from `ApprovalSubject`, from both boot lists, and from every service. The registry test uses it
    as the honest unregistered type; Plan 05 is the commit that retires that use.
25. **`document_sequence` is `(branch_id, kind, period='YYYY-MM', value)`** with
    `unique(branch_id, kind, period)`; `allocateFromSequence(kind, tx)` is the server allocator and
    `credit.repaymentSequence` is already a sequence key. The desktop has its own
    `document_sequence(terminal_id, scope, day)` in SQLite, allocated **inside** the sale
    transaction so a rolled-back sale never burns a number.
26. **`stock_movement_type = ['RECEIPT','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN',
    'COUNT_VARIANCE','SALE','SUPPLIER_RETURN','WRITE_OFF']`** and `stock_movement_reference =
    ['RECEIPT','ADJUSTMENT','TRANSFER','COUNT','SALE','SUPPLIER_RETURN','WRITE_OFF']`. Neither has
    a customer-return value; a resalable refund restock needs both extended in the enum-only
    migration.
27. **`sync_conflict_type` has 14 values** (`pos.types.ts:180-194`) and `pos.schema.ts:41-56`
    mirrors them. The doc comment on `stock_write_off` records the design rule a refund must
    follow: a document is raised complete and decided as one unit, and `APPROVED` means **posted**
    — there is no state that can drift from the ledger.
28. **`credit.postEntryInTransaction` is the only credit write path** and `REPAYMENT` must be
    **negative** with `method ∈ CASH|MOMO|BANK`; `credit_ledger_entry` has
    `unique(branch_id, idempotency_key)`, so a replay is free. `createRepayment` requires a
    `SessionUser` — there is no device-authenticated repayment path and no upload arm for one.
29. **`shift` already carries the close arithmetic**: `counted_cash_minor`,
    `client_expected_cash_minor`, `server_expected_cash_minor`, `variance_minor`, and the Phase 12
    review columns. `closeShift` computes `expected = float + cashTenders − change + cashIn −
    cashOut`, writes the variance, raises `SHIFT_VARIANCE_REVIEW` strictly above
    `pos.shiftVarianceToleranceMinor`, and returns `ShiftApplyResult` unchanged so the till never
    learns about the approval. There is **no** shift-report table and no X-report.
30. **`selectShiftCashTotals` is the only cash arithmetic** (`pos.repository.ts:260-296`): three
    independent sub-selects (cash tenders, change, cash in/out) joined by the shift id. A Z-report
    must compose this, not re-derive it.
31. **The local shift row has no report fields**: `shift` in SQLite carries `counted_cash_minor`
    and `client_expected_cash_minor` only. There is no Z-report, no printable shift summary and no
    ESC/POS builder other than `buildReceiptBytes` / `buildDrawerBytes` (`src/main/printing/escpos.ts`).
32. **`sale.print_status` is the print queue** (`PENDING|PRINTING|PRINTED|FAILED`), the receipt is
    rendered from the **local sale row** (`buildReceiptModel`), E-VAT fields are hard `null`, and
    `ReceiptModel.tender` is a single object read from `tenders[0]`. A split receipt needs a
    `tenders[]` shape and a refund block; the ESC/POS line builder is the only change.
33. **`TenderMethod` is declared twice** — `desktop/.../sale/sale-draft.ts:16` and implicitly in
    `sale-repository.ts` — and `toTender` coerces anything that is not `CREDIT` to `CASH`
    (`sale-repository.ts:256`). That coercion must be deleted, not extended.
34. **The local cart is single-draft by construction**: `cart_draft.id` is the future sale id,
    `writeDraft` deletes every other draft row, `loadCartDraft` prunes drafts from another shift,
    and a zero-line draft is deleted. Held carts therefore cannot reuse `cart_draft` — they need
    their own tables, and they must **not** be pruned by shift (D16/D19).
35. **`cart_draft` has no tender table**, so a pending electronic tender has nowhere to live across
    a restart today. The 150 ms draft write (`DRAFT_WRITE_DELAY_MS`) is the only persistence seam.
36. **Manager authority offline is `approveOverride`** (`desktop/.../overrides/override-service.ts`):
    role must be MANAGER/ADMIN, `can(role, permission)`, reason code in
    `reasonCodesFor(permission)`, then `verifyOfflinePin`. Its `OverridePermission` union is
    `Extract<Permission, 'credit.override' | 'pos.discount'>` — a refund authority has to be added
    to both the permission list and that extract.
37. **A test suite per module, one shared test database, `fileParallelism: false`.** POS tests
    either insert a terminal+device directly (`pos.test.ts:65-87`) or enrol through the real API
    (`sync.upload.test.ts:160-175`). Every suite tracks the ids it created and deletes them in
    `afterAll`, child-first. Current baseline: **API 596 tests / 45 files, shared 239, desktop
    427**, brand gate over 1 035 files.
38. **The enum rule is architectural, not stylistic**: `drizzle-kit migrate` wraps each file in a
    transaction, and PostgreSQL 17 refuses to *use* a value added in that same transaction. Every
    enum addition in this repository has its own `NNNN_enum_<slug>.sql` (0009, 0011) and the DDL
    that writes the value lives in the next file.
