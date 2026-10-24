# Research — Paystack Ghana

**Researched:** 2026-10-17
**Sources:** `paystack.com/docs/api/charge`, `paystack.com/docs/payments/payment-channels`,
`paystack.com/docs/transfers`, `paystack.com/docs/transfers/creating-transfer-recipients`,
`support.paystack.com` (pricing, transfers, automated payouts)

## Charges (collecting money)

- Charge API: `POST https://api.paystack.co/charge` with `amount`, `email`, `currency: "GHS"`.
- Amounts are integer **pesewas** for GHS (kobo for NGN).
- **Mobile Money** (Ghana): `mobile_money: { phone, provider }` where provider is
  `mtn` (MTN), `atl` (Airtel/Tigo), `vod` (Telecel). The response status is `pay_offline`
  and includes `display_text` for the customer; the customer has **180 seconds** to
  approve the prompt.
- Settlement is confirmed by the `charge.success` webhook; if no webhook arrives after
  180 seconds, call the Verify Transaction endpoint and read `data.message`.
- **Card**: hosted checkout / Inline, or the Charge API with authorization codes.
  Cards can require OTP (`send_otp`) or other steps; the server must follow the
  status-driven flow.
- **Bank transfer** (Ghana): supported through Pay with Transfer / dedicated accounts.
- `channels` can restrict the payment methods shown on hosted checkout.
- MoMo transaction fee in Ghana: 1.95%.
- Recurring/charge-authorization is available for cards; MoMo does not support recurring.

## Transfers (paying out, including suppliers)

- Feature available for businesses in Ghana (registered businesses only).
- Recipient types relevant to Ghana:
  - `ghipss` — Ghana bank account (GHS).
  - `mobile_money` — MoMo account (GHS), `bank_code` is the telco code (`MTN`, `ATL`, `VOD`).
- Verify the bank account before creating a recipient (Resolve Account Number API for GHS).
- Create recipient: `POST /transferrecipient`; store `recipient_code`.
- Initiate transfer: `POST /transfer` with `source: "balance"`, `amount` (pesewas),
  `recipient`, unique `reference` (16–50 chars, lowercase/digits/`-`/`_`), `reason`, `currency`.
- Statuses: `pending` → `successful` | `failed` | `reversed`; final status arrives by
  webhook (`transfer.success`, `transfer.failed`, `transfer.reversed`) — prefer webhooks
  over polling.
- OTP for transfers can be disabled in the dashboard for fully automated payouts.
- Fees (Ghana): **GHS 1 per MoMo transfer**, **GHS 8 per bank transfer**.
- Limits (Ghana): minimum **GHS 10**, maximum **GHS 50,000** per single transfer.
- Bulk transfers exist (batches ≤ 100, one batch per 5 seconds); single transfers with
  unique references are simpler for supplier payments.
- Top-up of Paystack balance is free for Ghana businesses; automated payouts to Ghana
  bank accounts follow the next-working-day schedule (MoMo payouts have their own rules).

## Security requirements

- Never expose the secret key to the desktop app; all Paystack calls are server-side.
- Verify webhooks with the `x-paystack-signature` HMAC (SHA-512) using the webhook secret.
- Store webhook events idempotently (event ID / reference unique constraint).
- Treat webhook/verify as the source of truth; never trust client-reported success.
- Use unique transfer references per payment attempt; retries must reuse the reference.

## Implications for Sceptre Drive

- `PAYSTACK_MODE=mock` implements the same interfaces with an in-process fake until keys exist.
- MoMo and card flows are online-only; the POS disables them offline.
- Supplier transfers use `mobile_money` or `ghipss` recipients with unique references;
  manual cash/bank payment recording is always available as a fallback.
- Reconciliation job compares our payment records with Paystack transactions.
