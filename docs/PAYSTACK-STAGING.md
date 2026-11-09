# Paystack staging and go-live

This is the operator's guide for the Ghana Paystack integration: test mode on staging, the
dashboard settings, the test credentials, and the live checklist. The code paths are in
`api/src/modules/payments/` and the UI is the till's electronic tender screen.

> **Two rules first**
>
> 1. **Staging uses an `sk_test_` key. Production uses an `sk_live_` key.** Paystack decides
>    test vs live from the key, not from the URL. The API now refuses a key whose prefix
>    contradicts `PAYSTACK_MODE`, so an `sk_live_` key in staging fails at boot instead of
>    charging a real card.
> 2. **Never commit a key.** `.env` is ignored; `.env.example` is the template. Store the
>    staging and production keys in the host's secret manager (Render/VPS), not in git.

---

## 0. The five-minute local check

Put the **test** key in the ignored `.env` (or export it in the shell; dotenv does not
override an existing variable):

```dotenv
PAYSTACK_MODE="test"
PAYSTACK_SECRET_KEY="sk_test_…"
PAYSTACK_WEBHOOK_SECRET=""
PAYSTACK_EMAIL_DOMAIN="your-real-domain.com"
```

Then:

```bash
bun run paystack:smoke
```

It calls `/balance`, initialises a GHS 1.00 transaction and verifies it. In test mode it
prints a checkout URL; open it and pay with `4084 0840 8408 4081` (CVV `408`, any future
expiry). That proves the key and the checkout. For the Ghana mobile-money charge:

```bash
bun run paystack:smoke -- --momo
```

The test MTN number is `0551234987` (no PIN/OTP). For a webhook test locally, expose the API
with a tunnel (`cloudflared tunnel --url http://localhost:4000` or ngrok) and put the tunnel's
HTTPS URL + `/api/payments/webhook/paystack` in the Paystack **test** webhook setting. The
tunnel URL changes on restart; update the dashboard each time.

Do not paste the key into a chat, an issue, or a commit. If a key has been exposed, rotate it
in the dashboard immediately (**Developers → Generate new secret keys → Immediately**).

---

## 1. What the app already does

| Flow | Endpoint | Provider behaviour |
|---|---|---|
| Card | `POST /transaction/initialize` with `channels: ['card']` | Returns an `authorization_url`; the POS opens it in a locked-down Electron window and polls the payment |
| Mobile money | `POST /charge` with `mobile_money` | Returns `pay_offline` and `display_text`; the customer completes on the phone within **180 seconds** |
| Bank transfer | `POST /charge` with `bank_transfer.account_expires_at` | Returns a temporary account; the POS shows it; a webhook settles it |
| Refund | `POST /refund` | The admin-approved refund is dispatched by the API; `refund.*` webhooks settle it |
| Supplier transfer | `POST /transferrecipient` then `POST /transfer` | `pending`, `otp`, `success`, `failed`, `reversed`; OTP is entered in the console |
| Webhook | `POST /api/payments/webhook/paystack` | `x-paystack-signature` HMAC-SHA512 over the **raw** body, using the secret key |

The till never trusts the checkout page: the server is the only writer of `PAID`, through the
webhook or `verify`. A late success becomes an orphaned payment and a HIGH conflict, never an
auto-refund.

---

## 2. Dashboard setup — test mode

Log in at <https://dashboard.paystack.com>, switch the dashboard to **Test mode**, then:

### 2.1 API keys

**Developers → API Keys & Webhooks** (<https://dashboard.paystack.com/v2/developers>):

- Copy the **test secret key** (`sk_test_…`). This is the only key the API needs.
- The public key (`pk_test_…`) is **not** used by this integration: the API initialises the
  transaction server-side and the POS opens the returned checkout URL. Do not put it in the
  renderer.
- Copy the test key into the staging API's `PAYSTACK_SECRET_KEY`.

### 2.2 Webhook URL

Still under Developers, set the **test webhook URL** to:

```
https://<staging-api-host>/api/payments/webhook/paystack
```

- It must be public HTTPS. `localhost` cannot receive Paystack events.
- The API must return `200`. A signature mismatch is a `401` and Paystack retries.
- Paystack signs with the **secret key**, so leave `PAYSTACK_WEBHOOK_SECRET` empty. If it is
  set, it must be the same value as `PAYSTACK_SECRET_KEY`; the API refuses anything else.
- Keep the live webhook URL separate: the test and live dashboards have separate settings.

### 2.3 Callback URL

The callback is the page the **customer's browser** returns to after a card checkout. It is
**not** the webhook.

- For the desktop POS, leave Paystack's default callback or set a simple HTTPS page you own.
  The till polls the API and closes the checkout window when the payment is `PAID`; it does
  not need your page.
- If you later add a web checkout, set a real callback URL on the staging site. The Electron
  checkout window only navigates to Paystack hosts, so a custom callback on your domain is
  blocked by design in the POS; the poll still settles the payment.

### 2.4 Payment channels

**Settings → Payment channels** (the v2 dashboard label may be *Preferences → Payment
channels*):

- Enable **Card**.
- Enable **Mobile Money** for Ghana. The provider codes the API uses are `mtn`, `vod`
  (Telecel) and `atl` (ATMoney/Airtel Money).
- Enable **Bank Transfer** (Pay with Transfer) for Ghana.
- Disable channels you do not want customers to see.

Cards are available on all accounts. Mobile money and Pay with Transfer are country-specific;
Ghana supports both.

### 2.5 Transfers (supplier payments)

Supplier transfers are a different product from collecting a sale:

- They are available to **registered businesses**, not starter businesses.
- **Settings → Transfers** controls the approval mode. If **Confirm transfers before
  sending** is on, Paystack returns `otp`; the console asks the admin for the OTP. A wrong
  OTP must not move the transfer; the app keeps the row and shows the provider's message.
- Test mode simulates the processor. A test transfer can still return `otp`; the app handles
  it. Check the transfer in the dashboard under **Transfers**.
- Ghana recipients are `ghipss` bank accounts (a GHIPSS bank code) or `mobile_money` wallets
  (the telco code as `bank_code`). The admin enters the bank code in the supplier payment
  details form. To list Ghana bank codes:

```bash
curl -sS 'https://api.paystack.co/bank?currency=GHS' \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" | jq '.data[] | {name, code}'
```

### 2.6 Business profile and live activation

Before live keys will collect and settle:

- Complete the business profile (legal name, support email, logo, website).
- Add and verify the **settlement bank account**.
- Submit the compliance documents Paystack asks for in Ghana (business registration, TIN,
  ID of the director, proof of address — the exact list is in the dashboard's activation
  checklist).
- Decide whether the account is a registered business. Transfers require it.

Test mode does not require the full activation, but transfers may still be limited to
registered businesses.

### 2.7 IP allowlisting (optional)

Paystack sends webhooks from these IPs in both test and live mode:

```
52.31.139.75
52.49.173.169
52.214.14.220
```

The API already verifies the HMAC signature, which is the stronger control. If you also
allowlist at Caddy/Cloudflare, add these three and keep the signature check. Do not allowlist
only the IPs and skip the signature.

---

## 3. Staging environment variables

Set these on the staging API (Render/VPS). `NODE_ENV=production` is correct for a staging
build; `PAYSTACK_MODE=test` is what selects the test key.

```dotenv
NODE_ENV="production"
PAYSTACK_MODE="test"
PAYSTACK_SECRET_KEY="sk_test_…"
PAYSTACK_WEBHOOK_SECRET=""                 # leave empty; Paystack signs with the secret key
PAYSTACK_BASE_URL="https://api.paystack.co"
PAYSTACK_EMAIL_DOMAIN="your-real-domain.com"
```

- `PAYSTACK_EMAIL_DOMAIN` is the domain in the synthetic customer email
  (`pos+<terminal>-<paymentId>@<domain>`). It is a **routing label**, never a contact address.
  In live mode the API refuses the `.example` placeholder; use a domain the business owns.
- The same domain can be used in test mode; Paystack is more forgiving there, but using the
  real one avoids a difference between staging and production.
- `PAYSTACK_MODE=live` additionally requires `NODE_ENV=production`.
- Do **not** add `PAYSTACK_PUBLIC_KEY`; the integration does not use it.

---

## 4. Verify the credential before touching the till

From the repository root, with the staging `.env` loaded (or the variables exported):

```bash
bun run paystack:smoke
```

It calls `GET /balance`, initialises a GHS 1.00 test transaction, and verifies it. It prints
no secret. In test mode it prints the checkout URL; open it and pay with a test card to prove
the webhook and the poll end to end.

```bash
# Also exercise the Ghana mobile-money charge (test mode only)
bun run paystack:smoke -- --momo
```

The script refuses `PAYSTACK_MODE=live` unless you pass `--live`, and then it requires
`--amount`:

```bash
bun run paystack:smoke -- --live --amount 100
```

A successful smoke test means: the key is valid, the GHS currency is enabled, the account can
initialise a transaction, and `verify` is reachable. It does **not** prove the webhook; that
needs a real test payment and the dashboard's Webhook Events page.

---

## 5. Test credentials

### Cards

| Scenario | Number | Expiry | CVV | PIN / OTP |
|---|---|---|---|---|
| Success, no validation | `4084 0840 8408 4081` | any future (e.g. 10/27) | `408` | — |
| PIN validation | `5078 5078 5078 5078 12` | 10/27 | `081` | PIN `1111` |
| PIN + OTP | `5060 6666 6666 6666 666` | 10/27 | `123` | PIN `1234`, OTP `123456` |
| PIN + phone + OTP | `5078 5078 5078 5078 04` | 10/27 | `884` | PIN `0000`, OTP `123456` |
| Declined | `4084 0800 0000 5408` | 10/27 | `001` | — |
| Refund fails | `4084 0800 0067 1803` | 10/27 | `180` | — |
| Refund needs attention | `4084 0800 0067 1902` | 10/27 | `190` | — |

### Mobile money (Ghana)

| Number | Network | Behaviour |
|---|---|---|
| `055 123 498 7` | MTN | Test number; no PIN/OTP |

The API sends the charge to Paystack; Paystack returns `pay_offline` and the test number
completes. The customer has **180 seconds**; after that the charge fails and `verify` returns
the reason.

Some live Ghana numbers answer `send_otp` instead of `pay_offline` (notably the
Telecel/Vodafone voucher flow). That is **not** a failure and not a dashboard setting: the till
must show a one-time-code field and post the code to `/charge/submit_otp`. The app stores only
the fact that a code is required, never the code itself. While that row is pending it is polled
with `GET /charge/:reference` (check pending charge), **not** `transaction/verify`: Paystack's
verify call can report the still-waiting charge as "Transaction was not completed", which would
close the window before the cashier can submit the code. The check endpoint can itself answer
`failed` with the envelope message "Reference check successful" while the OTP is still pending;
the API treats a failed check inside the 180-second window as "not completed yet" and keeps the
row `PENDING`. If the field does not appear and the charge ends as "Transaction was not
completed", the POS/API build predates the OTP fix.

### What test mode does not simulate

- No real money moves and the test balance is not a settlement balance.
- Test webhooks retry hourly for 10 hours with a 30-second timeout; live events retry every
  3 minutes for the first four tries, then hourly for 72 hours.
- Some processor/bank edge cases are simulated rather than real. A test transfer that returns
  `success` does not prove a live Ghana bank will accept the recipient.
- The dashboard's test and live data are separate; a test transaction never appears in live.

---

## 6. End-to-end flows on the staging till

### Card

1. Open a shift, add an item, choose **Card**, and start the tender.
2. The locked checkout window opens. Pay with `4084 0840 8408 4081`, CVV `408`, any future
   expiry.
3. Paystack sends `charge.success`. The API marks the payment `PAID`; the till's poll sees it
   and closes the window.
4. The receipt prints. In the dashboard, **Transactions** (test mode) shows the reference and
   the amount in GHS.
5. If the till says pending after success, check the webhook delivery and `PAYMENT_LATE_SETTLEMENT`
   / `PAYMENT_AMOUNT_MISMATCH` in Operations → Conflicts. The poll uses `verify`, so it can
   settle even when the webhook is late.

### Mobile money

1. Choose **MoMo**, enter `0551234987`, choose MTN, and start.
2. The till shows Paystack's `display_text` ("Please complete authorization…").
3. The test number completes; `charge.success` settles the payment.
4. If Paystack answers `send_otp`, the till shows **One-time code from the customer's phone**.
   The customer reads the code, the cashier submits it, and only then does `charge.success`
   settle the payment. A wrong code keeps the charge pending with Paystack's message; it does
   not fail it.
5. If it stays pending past 180 seconds, the payment expires; the till returns to the tender
   screen. Check the dashboard for the final status.

### Bank transfer

1. Choose **Bank transfer**. The API creates a temporary account with a 15-minute expiry (the
   Paystack maximum is 8 hours; the app uses 15 minutes).
2. The till shows the account number, bank and expiry.
3. A transfer into the account sends `charge.success`; a wrong amount sends
   `bank.transfer.rejected`. The POS listens for both.
4. In test mode, use the amount/account the API returned; if Paystack's test simulator does
   not complete the transfer, the payment expires and the till returns to tender. The mock
   provider remains the way to test the full offline till path without Paystack.

### Refund

1. Complete a card sale, open the sale, and refund it from the till; the admin approves if
   the amount is at/above the threshold.
2. The API calls `POST /refund`; the dashboard shows the refund. Use the refund test cards
   above to see `refund.failed` and `refund.needs-attention`.
3. A refund is settled by the `refund.*` webhook; a `needs-attention` result is never retried
   into `SETTLED` by the app. It is money a person must handle.

### Supplier transfer

1. Enable `flag.supplierTransfers` in Settings.
2. Add the supplier's payment details (bank code or MoMo provider code) in the supplier
   record.
3. Create a supplier transfer in Payables. If Paystack returns `otp`, enter the OTP in the
   console. A wrong OTP is a 400 and leaves the intent intact.
4. `transfer.success` posts the supplier payment. `transfer.failed`/`reversed` leave the
   liability and raise the result for a person.

---

## 7. Webhook troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` on every delivery | secret mismatch, or `PAYSTACK_WEBHOOK_SECRET` set to a random value | leave it empty or set it to the secret key; the API checks the HMAC over the raw body |
| `404` | wrong path | the route is `/api/payments/webhook/paystack` |
| `200` but the payment stays pending | event not handled, or reference mismatch | handled: `charge.success`, `charge.failed`, `bank.transfer.rejected`, `transfer.success/failed/reversed`, `refund.*`; check `payment_event` and `sync_conflict` |
| Payment is `PAID` with a conflict | amount or currency did not match | `PAYMENT_AMOUNT_MISMATCH`; a person reviews it, no auto-refund |
| Webhook delayed | test mode retries hourly (10h); live retries 72h | use the dashboard **Webhook Events** to resend; the till's `verify` poll can settle first |
| Card checkout opens but never returns | callback URL points at your domain and the Electron window blocks it | use the default callback for the POS; the poll settles and closes the window |
| `Invalid key` from the API | wrong mode/key pair | `sk_test_` with `PAYSTACK_MODE=test`, `sk_live_` with `live` in production |
| `pay_offline` forever | customer did not approve within 180s | expected; start a new charge |
| "Please enter the one-time password" then "Transaction was not completed" | the number answered `send_otp` and no code was submitted before the 180s timeout | the till must show the OTP field and post it to `/api/pos/payments/:id/otp`; update the POS/API if it does not |
| OTP field appears, then "Transaction was not completed" a second later | the poll used `transaction/verify`, which reports an OTP-pending charge as not completed | an OTP-pending row must be polled with `GET /charge/:reference` (check pending charge); update the API |
| OTP field appears, then "Reference check successful" and the field disappears | the check endpoint answered `failed` with that envelope message while the OTP was still pending | the API must keep a failed check pending until the 180-second window closes; update the API |
| OTP field shows but every code is rejected | wrong code, expired charge, or the phone is not the one that received the code | read the provider's message; if it says expired, start a new charge |
| Transfer `blocked` | the approval URL/server did not answer in time | not used by this app unless you configure URL approval; prefer OTP |

The dashboard **Webhook Events** page lists every attempt with the payload and your response;
resending is the fastest way to test a fix without making another payment.

---

## 8. Live mode checklist

Do these in order; none is optional.

- [ ] Business is a **registered business** (not starter); transfers require it.
- [ ] Settlement bank account is added and verified.
- [ ] Live **secret key** (`sk_live_…`) is in the production secret manager, not in git.
- [ ] Production `PAYSTACK_MODE="live"` and `NODE_ENV="production"`.
- [ ] `PAYSTACK_EMAIL_DOMAIN` is a domain the business owns (not `.example`).
- [ ] Live **webhook URL** is set to `https://<production-api>/api/payments/webhook/paystack`.
- [ ] `PAYSTACK_WEBHOOK_SECRET` is empty (or exactly the live secret key).
- [ ] Callback URL is set if you have a web checkout; the POS does not need it.
- [ ] Card, Mobile Money (MTN/Telecel/AT) and Bank Transfer are enabled.
- [ ] Transfer approval mode is chosen (OTP is what the console supports).
- [ ] CORS includes the production admin, web and `app://sceptre-drive` origins.
- [ ] A small live card charge is made, refunded, and settled; its webhook is received.
- [ ] A small live MoMo charge is made and settled; its webhook is received.
- [ ] A live Telecel/Vodafone number that asks for a one-time code is completed through the
      till's OTP field (the MTN test number does not exercise this path).
- [ ] A supplier transfer is made to a real recipient (or a controlled one) and reconciled.
- [ ] Keys are in the secret manager; rotation procedure is written down.
- [ ] `docs/STAGING-ONE-DAY.md` is not used for production; it is disposable.

### Key rotation

Paystack rotates **both** the live and test secret keys together. Before you rotate:

- Update staging (`sk_test_`) and production (`sk_live_`) servers, any worker/job, CI secrets
  and the webhook verification code.
- Set the new key, restart the API, and run `bun run paystack:smoke` in each mode.
- If the old key is exposed, choose **Immediately**; have the new key ready to deploy.

The app validates the key prefix against `PAYSTACK_MODE` at boot, so a half-rotated environment
fails loudly instead of charging with the wrong mode.
