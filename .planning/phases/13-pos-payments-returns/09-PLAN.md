---
phase: 13-pos-payments-returns
plan: 09
title: Electronic tenders at the till — MoMo, bank transfer, card, recovery
lane: desktop
depends_on: [08, 03]
requirements: [POS-11, PAY-01, PAY-02, PAY-07]
---

# Plan 09 — The customer's phone, the bank, and a locked window

## Goal

A cashier can add a MoMo tender, read a Pay-with-Transfer account aloud, or send a card payment to
Paystack's own checkout window — and the tender becomes money only when the server says the payment
is `PAID`. A tender in flight survives a restart, an expired one is abandoned cleanly, and money that
settled after the cashier gave up appears on the shift home instead of disappearing.

## Read first

- `00-DECISIONS.md` P13-D6 … P13-D16, P13-D31.
- `01-RESEARCH.md` §1.1 items 1–6, 10; §2.
- Plan 03's routes and `PaymentView` DTO.
- `desktop/src/main/ipc/*.ts` and `desktop/src/shared/*.ts` — the zod-validated IPC contract idiom.
- `desktop/src/main/security-source.ts` and `desktop/src/main/csp.ts` — the window options already
  used by the shell, and the reasons recorded there.
- `desktop/src/renderer/lib/api/sync-client.ts` — the `fetch` + timeout idiom.
- `desktop/src/renderer/lib/powersync/schema.ts` — `cart_tender` from Plan 08.
- `desktop/src/renderer/modules/tender/pages/tender-page.tsx` — the builder from Plan 08.

## Tasks

### 1. `lib/api/payments-client.ts`

```ts
export type PaymentMethod = Extract<TenderMethod, 'MOMO' | 'CARD' | 'BANK_TRANSFER'>
export interface PaymentView {
  id: string; method: PaymentMethod; amountMinor: number
  status: 'PENDING' | 'PAID' | 'FAILED' | 'ABANDONED' | 'EXPIRED'
  displayText: string | null; authorizationUrl: string | null
  accountNumber: string | null; accountName: string | null; accountBank: string | null
  expiresAt: string | null; providerReference: string; orphaned: boolean
}
export function createPaymentClient(deps: { baseUrl; token(): Promise<string|null>; fetch? }): PaymentClient
export interface PaymentClient {
  create(input: { clientPaymentId; method; amountMinor; shiftId; mobileMoney? }): Promise<PaymentView>
  get(id: string, opts?: { refresh?: boolean }): Promise<PaymentView>
  abandon(id: string): Promise<PaymentView>
  claim(id: string, saleId: string): Promise<PaymentView>
}
```

Errors are typed (`PaymentClientError` with `code`), and a network failure is retryable — the till
treats it as "still pending", never as "failed".

### 2. The checkout window (main process)

`src/main/payments/checkout-window.ts`:

```ts
export const CHECKOUT_HOSTS = ['checkout.paystack.com', 'paystack.com', 'api.paystack.co']

export async function openCheckoutWindow(url: string, opts: { onClosed(): void }): Promise<void>
export function closeCheckoutWindow(): void
```

- Refuses any URL whose protocol is not `https:` or whose host is not in `CHECKOUT_HOSTS`; the
  failure is returned to the renderer as `{ ok: false, reason: 'UNTRUSTED_URL' }`.
- `new BrowserWindow({ width: 900, height: 760, parent: mainWindow, modal: false, autoHideMenuBar: true,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  partition: 'persist:paystack-checkout' } })` — **no preload**, so the checkout can reach no IPC.
- `setWindowOpenHandler(() => ({ action: 'deny' }))`; `will-navigate` allows only
  `https://checkout.paystack.com/*` and `https://paystack.com/*`.
- `session.fromPartition('persist:paystack-checkout').setPermissionRequestHandler((_, __, cb) => cb(false))`.
- A single module-level handle: opening a second checkout closes the first.
- IPC: `payments:checkout:open`, `payments:checkout:close`; both zod-validated, both `senderFrame`
  checked against `app://sceptre-drive` (the existing `validateSender` helper).

The renderer never learns what happened inside the window. It keeps polling the server.

### 3. The tender screen's electronic panel

`components/electronic-tender.tsx`:

- **Method picker**: MoMo (with `mtn | atl | vod` segmented control and a phone field normalised by
  `@sceptre/shared`'s phone helper), Bank transfer, Card.
- **Create**: `clientPaymentId = uuidv7()`, `amountMinor = remaining`, then `client.create`.
- **Pending**: shows the server's `displayText` verbatim (`"Approve the prompt on your phone"`), or
  the bank-transfer account block (number, name, bank, a countdown from `expiresAt`), or — for card —
  a "Open secure card window" button that calls `payments:checkout:open` with `authorizationUrl` and
  opens it automatically once.
- **Polling**: every 3 s while `PENDING`, with a 180 s hard stop at `expiresAt`. A `PAID` adds the
  tender line and clears the panel; `FAILED` shows the provider message with Retry / Switch to cash;
  `EXPIRED` calls `abandon` once and shows "That payment expired — try again or take cash".
- **Cancel**: closes the checkout window (main), calls `abandon`, and leaves the other tenders intact.
- The panel is **disabled** when the device is offline (`navigator.onLine` plus the sync badge's
  state), with the reason in words: "MoMo and card need a connection. Cash and credit do not."

### 4. Persistence and resume (P13-D31)

On create, write the `cart_tender` row in the same debounce as the draft; on every status change,
update it. On mount of the tender screen:

- load `cart_tender` for the draft;
- `PENDING` → resume polling with the remaining time;
- `PAID` → add the tender line silently and show "MoMo GH₵50.00 paid at 14:31";
- `FAILED`/`EXPIRED` → drop the row and say so once.

`completeSale` clears `cart_tender` in its transaction (Plan 08). A draft with a `PAID` cart tender
and no sale is the crash case, and it resumes exactly here.

### 5. The orphan banner

`modules/home/` gains a `PaymentAttention` card fed by a new local query: `payment` rows are not
local, so the till asks the server — `GET /api/pos/payments/orphans` (device-scoped, Plan 03's
`countOrphanPaid` already exists; this plan adds the list endpoint if the count alone is not enough).

- The banner shows "Payment received without a sale — GH₵50.00 MoMo, 14:32" with two actions:
  **Add to this sale** (only when the current cart's remaining balance equals the amount — calls
  `claim`) and **Tell a manager** (a modal with the provider reference to write down).
- The banner is `role="status"`, is not dismissible without an action, and disappears when the server
  stops reporting the orphan.
- No automatic refund anywhere.

### 6. Config

`PosRuntimeSettings` gains nothing. The electronic methods are always available **when online**;
`PAYSTACK_MODE` is a server fact, and the till learns a method is unavailable from the server's
`PAYMENT_PROVIDER_DISABLED` error code, shown as "Card payments are not enabled on this server."

### 7. Tests

Unit (`desktop`):

- `payments-client.test.ts`: retryable vs terminal error classification; a 401 is terminal.
- `tender/electronic.test.ts` (pure state machine extracted from the panel):
  `PENDING → PAID` adds a line; `PENDING → FAILED` shows the message and keeps the other lines;
  expiry at 180 s calls abandon exactly once; a resume with `PAID` adds the line and does not poll;
  a resume with `EXPIRED` drops it.
- `checkout-window.test.ts`: the URL guard rejects `http://`, `https://evil.example`,
  `app://sceptre-drive`; accepts the three hosts; the window options are exactly the six named
  security switches (asserted against the options object).
- `format`/`normalise`: a Ghana phone in local form becomes `+233…` for the provider.

E2E deferred to Plan 13 (`counter-audit` gains the MoMo leg against the mock provider).

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run test:e2e           # packaged shell smoke still 40/40
bun run lint
```

Expected: desktop **~455 → ~485**.

## Commits

1. `feat(desktop): a payment client that treats a network failure as pending`
2. `feat(desktop): a sandboxed checkout window with no preload and three allowed hosts`
3. `feat(desktop): MoMo, bank-transfer and card tenders in the builder`
4. `feat(desktop): a pending tender survives a restart`
5. `feat(desktop): a payment received without a sale is visible on the shift home`
6. `test(desktop): the poll state machine, the URL guard and the window options`

## Done when

- A MoMo tender is money only after the server says so.
- The card form is never rendered by our code and the window it lives in can reach nothing.
- A crash mid-authorisation costs a click, not a customer's payment.
- Money that arrives late is on the screen a manager looks at.
