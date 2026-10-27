---
phase: 13-pos-payments-returns
plan: 03
title: Payments — provider interface, Paystack, mock, intents, webhook, verify
lane: api
depends_on: [02]
requirements: [POS-11, PAY-01, PAY-02, PAY-07]
---

# Plan 03 — The only place a card or a MoMo prompt is ever created

## Goal

A terminal can ask the server to charge GH₵50 by MoMo, card or bank transfer; the server records a
`payment`, asks the provider, and learns the outcome from the provider — never from the till. The
webhook is verified, idempotent and fast. With `PAYSTACK_MODE=mock` the whole flow runs with no
credentials and no network.

## Read first

- `00-DECISIONS.md` P13-D6, D7, D8, D9, D10, D11, D12, D13, D14, D15.
- `01-RESEARCH.md` §1.1 items 1–9 and §4 items 21–23.
- `api/src/modules/sync/sync.routes.ts:14-60` — the device middleware and per-device rate-limit idiom.
- `api/src/http/device-auth.ts:28` — `requireDeviceJwt`, and what it puts on `c.get('device')`.
- `api/src/http/rate-limit.ts` — the `keyForRequest` option.
- `api/src/app.ts:1-120` — where a router is mounted and where the unauthenticated route must sit.
- `api/src/modules/pos/pos.repository.ts:228` — `findShiftByIdForUpdate`.
- `packages/shared/src/phone.ts` — the Ghana phone normaliser and its result type.

## Tasks

### 1. The provider interface — `payments.provider.ts`

```ts
export interface ChargeInput {
  reference: string
  amountMinor: number
  email: string
  currency: 'GHS'
  metadata: { paymentId: string; terminalId: string; branchId: string }
  mobileMoney?: { provider: 'mtn' | 'atl' | 'vod'; phone: string }
  bankTransfer?: { accountExpiresAt: string }
}

export type ProviderChargeStatus =
  | 'PENDING' | 'PAY_OFFLINE' | 'PENDING_BANK_TRANSFER' | 'SUCCESS' | 'FAILED'

export interface ProviderChargeResult {
  reference: string
  status: ProviderChargeStatus
  displayText: string | null
  authorizationUrl: string | null
  accountNumber: string | null
  accountName: string | null
  accountBank: string | null
  expiresAt: string | null
  transactionId: string | null
  failureCode: string | null
  failureMessage: string | null
}

export interface ProviderVerification {
  reference: string
  status: 'success' | 'failed' | 'abandoned' | 'pending' | 'ongoing' | 'reversed'
  amountMinor: number
  currency: string
  channel: string | null
  paidAt: string | null
  gatewayResponse: string | null
}

export interface ProviderRefund {
  reference: string
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'needs-attention'
  refundReference: string | null
  expectedAt: string | null
}

export interface PaymentProvider {
  readonly name: 'PAYSTACK' | 'MOCK'
  createMobileMoneyCharge(input: ChargeInput): Promise<ProviderChargeResult>
  createCardCheckout(input: ChargeInput): Promise<ProviderChargeResult>
  createBankTransferCharge(input: ChargeInput): Promise<ProviderChargeResult>
  verify(reference: string): Promise<ProviderVerification>
  refund(input: { reference: string; amountMinor: number; note: string }): Promise<ProviderRefund>
}
```

Every method returns a **result**, and the only exception it may throw is
`ProviderUnavailableError` (network, 5xx, timeout). Any other failure is a result with
`status: 'FAILED'` and a message. That split is what lets the service say "pending" for a timeout and
"failed" for a decline.

### 2. `payments.paystack.provider.ts`

`fetch` only — no SDK, no new dependency.

| Method | Call | Mapping |
|---|---|---|
| `createMobileMoneyCharge` | `POST /charge` `{ amount, email, currency: 'GHS', reference, mobile_money: { phone, provider }, metadata }` | `pay_offline` → `PAY_OFFLINE`; `success` → `SUCCESS`; `failed`/`timeout` → `FAILED`; `pending` → `PENDING` |
| `createCardCheckout` | `POST /transaction/initialize` `{ amount, email, currency, reference, channels: ['card'], callback_url, metadata }` | `authorization_url` + `access_code`; status `PENDING` |
| `createBankTransferCharge` | `POST /charge` with `bank_transfer: { account_expires_at }` | `pending_bank_transfer` → `PENDING_BANK_TRANSFER` with account fields |
| `verify` | `GET /transaction/verify/:reference` | `data.status` mapped; `amount` → `amountMinor` |
| `refund` | `POST /refund` `{ transaction: reference, amount, merchant_note }` | `pending\|processing\|processed\|failed\|needs-attention` |

Headers: `Authorization: Bearer <PAYSTACK_SECRET_KEY>`, `Content-Type: application/json`,
`Cache-Control: no-cache`. Timeout 20 s via `AbortSignal.timeout(20_000)`. A non-2xx or a body with
`status: false` becomes `FAILED` with the provider's `message`, **except** 5xx and network errors,
which throw `ProviderUnavailableError`.

A single private `request()` logs `{ provider, endpoint, status, durationMs }` and **never** the
body, the headers or the key.

### 3. `payments.mock.provider.ts`

State in a module-level `Map<reference, MockPayment>` — process-local on purpose: a mock has no
business surviving a restart, and a test can reset it (`resetMockProvider()` exported for tests).

- MoMo charge → `PAY_OFFLINE`, `display_text: 'Approve the prompt on 055…'`, `expiresAt = now + 180 s`.
- Card → `authorizationUrl: 'https://checkout.paystack.com/mock/<reference>'`.
- Bank transfer → account `1234567890`, bank `Test Bank`, `expiresAt = now + 15 min`.
- `verify` reports whatever the mock record says.
- `refund` reports `pending` until `settleMockRefund` is called.

`settleMockPayment(reference, outcome: 'PAID'|'FAILED'|'EXPIRED')` is the harness hook.

### 4. `payments.service.ts`

```ts
export interface CreatePaymentInput {
  method: 'MOMO' | 'CARD' | 'BANK_TRANSFER'
  amountMinor: number
  clientPaymentId: string
  shiftId: string
  mobileMoney?: { provider: 'mtn' | 'atl' | 'vod'; phone: string }
}

export async function createPayment(device: DeviceAuthContext, input: CreatePaymentInput): Promise<PaymentView>
export async function getPayment(device: DeviceAuthContext, id: string, opts: { refresh: boolean }): Promise<PaymentView>
export async function abandonPayment(device: DeviceAuthContext, id: string): Promise<PaymentView>
export async function claimPayment(device: DeviceAuthContext, id: string, saleId: string): Promise<PaymentView>
export async function applyProviderCharge(tx, payment, result): Promise<void>          // webhook + verify
export async function applyProviderRefund(tx, refundTender, providerRefund): Promise<void>
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean
```

Rules:

- **Idempotent creation is the first thing that happens.** If `(terminal_id, client_payment_id)`
  exists, return it unchanged and **do not** call the provider. A retried POST from a till on a bad
  link must never create a second charge.
- `amountMinor` is validated by the route (1 … 10 000 000) and never taken from the sale.
- `shiftId` is locked with `findShiftByIdForUpdate`; a closed or foreign shift is a 409
  `SHIFT_CLOSED` / a 403.
- `method = 'MOMO'` requires `mobileMoney`; `method = 'BANK_TRANSFER'` and `'CARD'` reject it.
- `expires_at`: MoMo `+180 s`, bank transfer `+15 min`, card `+30 min`.
- `provider_email` is built here from `PAYSTACK_EMAIL_DOMAIN` and the terminal code (P13-D7).
- `provider_reference` is `` `sd-${clientPaymentId}` `` — allowed by Paystack's reference charset,
  39 characters, and traceable to our row in one glance.
- The provider's response is projected onto the row through an **allowlist**: status, display text,
  authorization url, the three bank-transfer fields, expiry, transaction id, failure code/message.
  Nothing else is written, and the raw response is discarded (P13-D15).
- `getPayment(..., { refresh: true })` calls `provider.verify` only when
  `status === 'PENDING' && now − last_verified_at ≥ 5 s`, and sets `last_verified_at` **before** the
  call.
- `abandonPayment`: `PENDING → EXPIRED`, then one verify; a `success` inside that verify wins and
  applies `PAID`. `PAID` is never downgraded, and the call is idempotent.
- `applyProviderCharge` is the single state writer used by both the webhook and verify:
  - `paid` → `PAID`, `paid_at`; if the row was `ABANDONED`/`EXPIRED`, also `orphaned = true` and a
    HIGH `PAYMENT_LATE_SETTLEMENT` conflict (P13-D9);
  - `failed` → `FAILED` with code/message;
  - `abandoned` → `FAILED` with `gatewayResponse`;
  - amount ≠ `payment.amount_minor` or currency ≠ `GHS` → `PAYMENT_AMOUNT_MISMATCH` (HIGH) and the
    status is **not** changed;
  - already `PAID` → an audit-free no-op.

### 5. `payments.repository.ts`

`findByClientId(terminalId, clientPaymentId)`, `findById(id)`, `findByIdForUpdate(id)`,
`findByReference(reference)`, `findByReferenceForUpdate(reference)`, `insertPayment`,
`updatePaymentStatus`, `insertEvent`, `findEventByHash`, `markEventProcessed`,
`findStalePending(olderThan, limit)`, `countOrphanPaid(branchId)`.

### 6. Routes

`payments.routes.ts` — device routes, mounted in `app.ts` at `/api/pos/payments`:

| Route | Middleware |
|---|---|
| `POST /` | `requireDeviceJwt`, `rateLimit({ 60_000, max: 30, keyPrefix: 'pos:payment:create', keyForRequest: perDevice })`, `validateCreatePayment` |
| `GET /:id` | `requireDeviceJwt`, `rateLimit({ 60_000, max: 120, keyPrefix: 'pos:payment:get', keyForRequest: perDevice })` |
| `POST /:id/abandon` | `requireDeviceJwt`, `rateLimit({ 60_000, max: 30, … })` |
| `POST /:id/claim` | `requireDeviceJwt`, `rateLimit({ 60_000, max: 30, … })` |

`payments.webhook.routes.ts` — **one** route, and the only sessionless mutating route in the API:

```
POST /api/payments/webhook/paystack
```

It reads `c.req.text()`, verifies the signature, inserts `payment_event` by body hash, applies the
allowlisted event, and returns `200 { received: true }`. It must be mounted **before** any router
that applies a body parser or an auth middleware. A bad signature returns **401** with no detail.
An unknown `event` type is stored as `IGNORED` and still returns 200.

Mock-only harness route, mounted only when `PAYSTACK_MODE === 'mock'`:

```
POST /api/payments/mock/settle   → { reference, outcome }
```

guarded by `requireSession` + `requirePermission('settings.update')` (admin), so it can never exist
in `test` or `live` mode, and the route is not registered at all outside `mock`.

### 7. `app.ts`

Mount `paymentsRoutes` under `/api/pos/payments`, the webhook route, and the mock route behind the
mode check. Add nothing to the approvals boot lists.

### 8. Tests (`payments.test.ts`, `payments.webhook.test.ts`)

Use `PAYSTACK_MODE=mock` with `resetMockProvider()` per test. Create a branch, terminal, device and
open shift with the `pos.test.ts:65-87` helper pattern, then:

- create a MoMo payment → `PENDING`, one row, `provider_reference = sd-<clientPaymentId>`, `expires_at`
  ≈ +180 s;
- create the **same** `clientPaymentId` twice → one row, one provider call (assert the mock's call
  counter), identical response;
- settle it through the mock harness → `PAID`, `paid_at` set;
- the same `charge.success` delivered twice (same body) → `200`, one `payment_event`, one transition,
  `payment_event.status = 'PROCESSED'` then unchanged;
- a body with a bad signature → `401`, zero rows in `payment_event`;
- a body whose `amount` differs → `PAYMENT_AMOUNT_MISMATCH`, HIGH, status still `PENDING`;
- abandon a pending payment → `EXPIRED`; settle it afterwards → `PAID` + `orphaned` + one
  `PAYMENT_LATE_SETTLEMENT` conflict;
- abandon twice → idempotent, no second conflict;
- `GET` a payment from another terminal's device → **404** (not 403; the row is not theirs);
- the refresh path calls `verify` at most once per 5 s (assert with an injected clock);
- card → `authorization_url` present and begins `https://`;
- bank transfer → the three account fields present and `expires_at` ≈ +15 min;
- the mock route is absent when `PAYSTACK_MODE=test` (boot the app factory with the env overridden).

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API **596 → ~625**. No `desktop/**` or `admin/**` change.

Also grep the log fixture in the test for `PAYSTACK_SECRET_KEY`, `sk_` and `Bearer`: zero hits.

## Commits

1. `feat(api): payment provider interface with a Paystack implementation`
2. `feat(api): a mock provider that cannot exist outside mock mode`
3. `feat(api): payment intents, idempotent creation and the verify fallback`
4. `feat(api): signature-verified, replay-proof Paystack webhook`
5. `feat(api): abandoned payments and late settlement become a named conflict`
6. `test(api): idempotency, replay, amount mismatch and the sessionless route`

## Done when

- Two POSTs for one `clientPaymentId` create one charge.
- A webhook replay returns 200 and changes nothing.
- A signature that does not match is a 401 with no row written.
- A payment that settles after the cashier gave up is paid, orphaned, and visible — not refunded.
- `PAYSTACK_MODE=mock` runs the whole flow, and `test` cannot reach the mock endpoint.
