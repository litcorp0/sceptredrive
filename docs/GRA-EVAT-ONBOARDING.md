# Getting GRA E-VAT credentials — the onboarding runbook

> **Status:** research notes and a runbook, not a GRA commitment. Everything marked
> **[verified]** was read on an official GRA source on **28 October 2026**. Everything
> marked **[ask GRA]** is a question only GRA can answer, and everything marked
> **[inferred]** is our reasoning, not a published rule.
>
> **Why this exists.** Sceptre Drive ships `EVAT_PROVIDER=mock` because GRA's API
> document and credentials are issued at onboarding, not published. This file is the
> path from "mock" to a real GRA connection: what to ask for, who to ask, what comes
> back, and where each value goes in this repository.

---

## 0. The short version

You cannot "get GRA keys" from a website. The key is issued to **the business** (the
taxpayer) after GRA has onboarded it, and only after the business has chosen to
integrate its own invoicing system. The path is:

| # | Step | Who | Output |
|---|---|---|---|
| 1 | Confirm the business is VAT-registered with a TIN and VAT number | Your accountant / TSC | TIN, VAT number |
| 2 | Ask GRA for E-VAT, stating **integration** (not the free app) | You, by letter to your Taxpayer Service Centre | A relationship manager and an onboarding form |
| 3 | Complete the onboarding form with the business and branch details | You | GRA's determination that you will integrate |
| 4 | Receive the **E-VAT API documentation** and the **cloud environment document** | GRA E-VAT team | API doc version, base URL, **API security key** |
| 5 | Build the client against the doc and test against the test environment | Us | A working provider |
| 6 | Complete **Appendix 4** readiness checklist and email it to `evat.support@gra.gov.gh` | You + us | A Joint UAT date |
| 7 | Joint UAT online, then a **certificate of acceptance** signed by both parties | You + GRA | Go-live authorisation |
| 8 | Switch `EVAT_PROVIDER=gra` and set the credentials | Us | Certified invoices |

Budget **weeks, not days**: GRA assigns a relationship manager, reviews the form,
schedules UAT, and the UAT itself is a booked session. Start early.

---

## 1. What you are actually collecting

GRA's model has more than one secret. "The GRA keys" is shorthand for six or seven
values, and only some of them are secret.

| Value | What it is | Secret? | Where it comes from |
|---|---|---|---|
| **TIN** | The taxpayer identification number, e.g. `C00XXXXXXXX` | No | GRA registration |
| **VAT number** | The VAT registration number printed on invoices | No | GRA registration |
| **VSDC serial / device serial** | The identifier of the Virtual Sales Data Controller that stamps invoices | No | Issued at onboarding / installation |
| **MRC (machine registration code)** | The code GRA prints on the receipt as "machine registration code" | No | Issued at installation, returned per invoice |
| **API security key** | The bearer credential for calling GRA's API (`security_key`) | **YES** | The "cloud environment document" GRA sends after setup |
| **Base URL** | The E-VAT endpoint. There is a **Test** URL and a **Production** URL | No | GRA's environment document |
| **Signature key** | The key the system requests from GRA to be able to stamp (see §3 step 5) | **YES** | Requested online during/after setup |
| **Certificate of acceptance** | The signed UAT sign-off | No | Joint UAT |

**[verified]** The API authenticates with a `security_key`; older document versions
(6.0/7.0) show `COMPANY_TIN`, `COMPANY_NAMES` and `COMPANY_SECURITY_KEY` in the same
payload. The field names change between versions, so build against the version GRA
hands you, not against a public copy. **[verified]** The GRA help centre points at
`https://documenter.getpostman.com/view/29809098/2sBXVeGCzK` as the current API
document (article updated March 2026).

> Never use a key that appears in a public sample, a Postman example, or someone
> else's screenshot. Sample keys in public docs are test data, and using them in
> production is how a business ends up submitting invoices under another TIN.

---

## 2. Prerequisites — have these before you contact GRA

**[verified]** GRA's onboarding article requires three attachments when requesting a
VSDC. Have them ready as PDFs:

1. **Business registration document** (Certificate of Incorporation / business
   registration certificate).
2. **Identification document** of the business owner (passport or national ID).
3. **A signed consent form to join E-VAT.**

Also assemble, because the onboarding form asks for business detail and because
GRA needs it to decide integration vs the free app:

- [ ] TIN and VAT registration number (and the VAT registration certificate).
- [ ] Legal business name exactly as registered, plus trading name.
- [ ] Every branch/shop location with **street address, city/area, and phone**. Our
      receipts and E-VAT payloads print a seller location per branch, so a missing
      address is a field GRA will reject.
- [ ] A named technical contact (name, role, email, phone) and a named commercial
      contact. GRA will use the technical contact for UAT.
- [ ] The invoicing system's description: name ("Sceptre Drive"), deployment
      (server-hosted API + desktop POS), and the fact that **cash sales continue
      offline** and are reported when connectivity returns.
- [ ] Confirmation of your accountant's view on which branch is the "registered
      location" if you trade from more than one. **[ask GRA]** whether each branch
      needs its own location code or serial.

---

## 3. The steps in detail

### Step 1 — Confirm the VAT registration

E-VAT is an invoicing obligation for **VAT-registered** businesses, not a new tax.
**[verified]** GRA's page states E-VAT aligns with the VAT Act 2025 (Act 1151), in
force since 1 January 2026, and that the effective rate is **20%** made up of
**15% VAT + 2.5% NHIL + 2.5% GETFund** — which is the same base our `priceCart`
computes, so no rate change is needed on go-live.

**[verified]** Act 1151 s.43(2) requires a taxable person to issue a tax invoice
**through a Certified Invoicing System** integrated into the Commissioner-General's
invoicing system, and s.72 defines that system. This is the legal hook the whole
exercise serves.

If the business is not VAT-registered yet, stop here: register for VAT first.

### Step 2 — Request E-VAT, and say "integration"

**[verified]** GRA's E-VAT page: *"How to Get the E-VAT System — Write to your
Taxpayer Service Center (TSC) indicating your request for the E-VAT system. The TSC
will guide you through the process."*

**[verified]** The E-VAT guidelines (GRA/AG/2024/005, §10) describe the same intake
from GRA's side: a taxpayer may be selected, may request, or may be onboarded at the
point of VAT registration; a **Relationship Manager** is assigned; an **onboarding
form** is shared; and on completion GRA decides whether the taxpayer needs
**integration** or the **free invoicing software**.

So the letter must be explicit:

> We are a VAT-registered business. We run our own invoicing system and request
> **integration** of that system with the E-VAT / Certified Invoicing System, not the
> free invoicing application.

There is also a self-service door: **[verified]** `https://gra.evatgra.com` is the
"embarking" portal where a taxpayer requests a VSDC by completing a form and
attaching the three documents in §2. In practice the TSC letter and this portal are
the same funnel — do the letter, and use the portal if your TSC tells you to.
**[inferred]** The portal is hosted in Ghana and may be unreachable from some
networks outside it; try a normal browser before concluding it is down.

### Step 3 — Choose the topology (this is the decision that matters)

GRA supports two shapes, and they are not equivalent for a shop that sells offline.

| | **A. On-premise VSDC** | **B. Cloud / API** |
|---|---|---|
| What it is | GRA's Virtual Sales Data Controller runs on a machine in the shop (Java WAR/JAR, or the free app) and stamps locally | Your system calls GRA's hosted endpoint with the API security key |
| Offline stamping | Yes — the VSDC is on the LAN | Depends on GRA's rule for a disconnected client **[ask GRA]** |
| What you must run | A machine that is always on, per location | Nothing extra; our API is already hosted |
| Serial / MRC | Per VSDC installation | Issued with the cloud environment |
| Fit with Sceptre Drive | Poor: a second box per branch, another failure mode at the till | **Good**: our API already owns the 24-hour queue and the retry ladder |

**Ask for B, the cloud/API integration**, and put the offline question in writing:
*"Our POS completes cash sales with no network and prints the receipt immediately.
What is the correct treatment: print uncertified and certify within 24 hours, or must
the invoice carry the SDC signature before it reaches the customer?"*

That answer decides how much of the receipt contract changes. Today the till prints
before any submission exists — the QR and signature fields are reserved, not filled —
and that is deliberate. **[verified]** GRA's own article says transactions can be
stamped online **or offline**, with reporting to the GRA portal requiring internet
**every 24 hours**, otherwise E-VAT stops stamping; queued invoices are pushed when
the connection returns. That matches our design, but the customer-facing question
(when the QR must be on paper) is a policy answer, not a technical one.

### Step 4 — Receive and read the API documentation

**[verified]** GRA's integration article, step 4, says the taxpayer reads the API
documentation on the portal, and lists the request types:

Invoice · Refund · Signature · Items · Purchase · Inventory · TIN Validator ·
Tag Description · VSDC Health Check · Z-Report

**[verified]** The API accepts **JSON or XML**. Our client will use JSON.

When the document arrives:

- [ ] Record the **version** and the date. Public copies exist at 6.0, 7.0 and 8.2
      and the field names differ between them. Our code must be written to the
      version GRA issues to you, and the version must be committed with the code.
- [ ] Note the **authentication fields** (in 8.2 it is `security_key`; in 6.0/7.0 it
      is `COMPANY_TIN` + `COMPANY_NAMES` + `COMPANY_SECURITY_KEY`).
- [ ] Note the **error-code table**. GRA returns codes like `E700` (already signed)
      and a long list of validation failures; our provider seam maps refusals to
      codes, and a code we do not know must become `ATTENTION`, never a silent retry.
- [ ] Note the **tax-code mapping**. Public copies map `TAX_A` / `TAX_B` / `TAX_C` to
      exempt / taxable / export with different rates across countries and versions.
      Confirm the Ghana values in the document you receive. **[ask GRA]**

### Step 5 — Prepare the environment and receive the key

**[verified]** From GRA's integration article, step 5:

- Requesting E-VAT auto-generates a **one-time OTP** used during installation.
- The **OTP and serial number** are entered when the database is created, together
  with the taxpayer's details.
- **For the cloud environment, you receive a document containing the API SECURITY
  KEY.**
- Invoices can be stamped online or offline; reporting needs the internet every 24
  hours; queued items are pushed on reconnect; after enough days without reporting,
  EVAT stops stamping.

This is the moment the credentials exist. Treat the document as a secret from the
first minute: it goes into the password manager and the server environment, never
into chat, a ticket, or this repository.

### Step 6 — Build and test (our side)

See §6 for exactly what is missing in the code. Test against the **Test URL** with
the test key **[ask GRA]** for the test credentials, and prove at minimum:

- health check;
- one invoice with mixed tax categories;
- a refund / credit note against a certified invoice;
- the Z-report;
- a replay of the same document (must not double-certify);
- an outage: queue, then flush.

### Step 7 — Readiness checklist, Joint UAT, certificate of acceptance

**[verified]** GRA's article, step 8:

1. Complete the readiness checklist in **Appendix 4** of the E-VAT documentation and
   email it to **`evat.support@gra.gov.gh`**.
2. GRA proposes a date for a **joint User Acceptance Testing session**, online,
   based on the E-VAT Interface User Requirements Specification and the API
   documentation.
3. The UAT is conducted online and a **certificate of acceptance is signed by both
   parties**.

Keep that certificate: it is the document that says the business may go live.

### Step 8 — Go live

Only after the certificate. See §7 for the switch-over procedure and §8 for what
changes operationally the day after.

---

## 4. Where each value lands in Sceptre Drive

The integration seam already exists; it is deliberately a seam and not a client
(`api/src/modules/evat/evat.provider.ts`). These are the values it expects.

### Environment (never committed)

| Variable | Value | Notes |
|---|---|---|
| `EVAT_PROVIDER` | `gra` | `mock` until the certificate of acceptance is signed |
| `EVAT_BASE_URL` | GRA's **production** endpoint | `https://…`; the test URL goes here while testing |
| `EVAT_SECURITY_KEY` | The API security key | Secret; rotate it in one place, the API reads it at boot |
| `EVAT_TIMEOUT_MS` | `10000` | Our bound on one provider call; it does not move the 24-hour deadline |

`api/src/config/env.ts` refuses to boot when `EVAT_PROVIDER=gra` and either
`EVAT_BASE_URL` or `EVAT_SECURITY_KEY` is missing, so a half-configured deployment
fails at start rather than at the first sale.

> **Local `.env` drift, worth fixing once:** the checked-in template is
> `.env.example`, and the names the code parses are `EVAT_PROVIDER`,
> `EVAT_BASE_URL`, `EVAT_SECURITY_KEY`, `EVAT_TIMEOUT_MS`. If a local `.env` still
> carries older names such as `GRA_EVAT_API_URL` / `GRA_EVAT_API_KEY` /
> `GRA_EVAT_SIGNATURE_KEY`, nothing reads them. Rename before go-live, or the
> deployment will look configured and still boot as `mock`.

### Settings (admin console, audited, branch-overridable)

| Setting | Key | Value |
|---|---|---|
| Seller TIN | `tax.sellerTin` | The `C00…` TIN issued by GRA |
| Seller VAT number | `tax.sellerVatNumber` | The VAT registration number |
| Business is VAT-registered | `pricing.vatRegistered` | `true` once the VAT certificate exists; `false` while it does not |

`pricing.vatRegistered` is **not** the GRA switch. It decides what the customer is
**charged**: `false` prices every line as `EXEMPT` (no VAT, NHIL or GETFund) whatever
the catalogue says, and stores the line that way. `flag.evatSubmission` decides
whether a sale is **reported**. Until the business is registered, both should be off —
and until the VAT certificate arrives, a shop that charges the 20% stack is
collecting tax it is not entitled to collect.

Both are already used by the receipt copy and the E-VAT document builder. A blank TIN
is refused with `SELLER_IDENTITY_MISSING` rather than submitted, because a blank TIN
is not a submission.

### What each certificate field becomes

GRA returns the SDC block with every certified invoice. Our schema stores it
column for column, so the mapping is one-to-one:

| GRA field (as named in GRA's docs) | `evat_submission` column | `EvatCertificate` field |
|---|---|---|
| Receipt number (`ysdcnum`) | `provider_invoice_number` | `providerInvoiceNumber` |
| SDC ID (`ysdcid`) | `sdc_id` | `sdcId` |
| VSDC serial | `serial` | `serial` |
| Receipt signature (`ysdcredsig`) | `signature` | `signature` |
| Internal data (`ysdcintdata`) | `internal_data` | `internalData` |
| MRC (`ysdcmrc`) | `machine_code` | `machineCode` |
| SDC time (`ysdcmrctim`) | `stamped_at` | `stampedAt` |
| QR payload | `qr_payload` | `qrPayload` |

`certificateProblem()` in `packages/shared` refuses a certificate with any of those
fields empty. That is on purpose: a half-filled certificate is worse than a visible
failure, because it would print a QR that GRA cannot verify.

**[verified]** GRA requires the QR to contain the GRA URL (test or production), the
taxpayer TIN, the invoice signature, the total amount, the total taxes, and the
invoice date and time — and recommends a QR of at least 3 cm × 3 cm on paper.
**[verified]** The receipt must also show company name, TIN, location and address,
invoice date and time, invoice number, item lines with names, unit price, VAT rate,
levies and totals, total amounts and total taxes.

Our receipt contract already prints all of that except the SDC block, which stays
reserved until a submission exists. See §3 step 3 for the question that decides
whether that is acceptable.

---

## 5. What actually changes on the till when this goes live

Very little, and that is the point.

- **Printing stays local.** A sale prints with or without network, as today.
- **Certification is asynchronous.** The submission row is written inside the sale's
  transaction (`queueForSale`), then a worker certifies it, and the SDC block is
  stored against that sale. The 24-hour deadline is a column (`due_at`), not a timer
  in the till.
- **A late certificate is still worth having.** The deadline is derived and shown as
  overdue; the retry ladder keeps going, because a certified invoice a day late is
  better than an uncertified one.
- **Refunds** are queued as credit notes against the original invoice, and one that
  arrives before its invoice is certified waits in `WAITING_FOR_INVOICE` rather than
  failing forever.
- **Nothing blocks the POS.** A GRA outage, a bad response, or an unknown error code
  becomes a row with a status and a person's attention — never a stopped sale. That
  rule is already implemented and tested; the real client inherits it.

---

## 6. Code that must exist before the switch can be flipped

`getEvatProvider()` deliberately throws when `EVAT_PROVIDER=gra`
(`P14-D33`): a client written against a document nobody has read would stamp
documents with a mock signature while an operator believed GRA had them. So the
work below is real work, and it is gated on §3 steps 4 and 5 actually delivering a
document and a key.

| # | Work | Where | Done when |
|---|---|---|---|
| 1 | A `GraEvatProvider` implementing `healthCheck`, `certify`, and (if the doc allows) `fetchCertificate` for `E700` recovery | `api/src/modules/evat/evat.gra.provider.ts` (new) | A test file drives it against recorded fixtures: one invoice, one refund, one refusal, one unknown code |
| 2 | Map our `EvatDocument` to the GRA payload of **the version GRA issued**, including tax-code mapping | same | A fixture per tax category, and the mapping is a single exported function with its own test |
| 3 | Map the GRA response into `EvatCertificate` (eight fields, §4) | same | `certificateProblem()` returns null for every fixture |
| 4 | Refusal mapping: known GRA codes → `EvatRefusal`, unknown codes → a non-retryable code that lands in `ATTENTION` | same | Unknown code never loops |
| 5 | Auth header/body exactly as the doc specifies (`security_key` in 8.2) | same | Recorded request assertion; the key never appears in a log |
| 6 | Health check wired into the existing provider seam | `evat.provider.ts` | The seam returns `GRA` instead of throwing when configured |
| 7 | A documented, disabled-by-default live smoke test that can be run once against the **test URL** | `api/scripts/` | Run manually during UAT; never in CI |
| 8 | E-VAT flag on for the branch(es) and the 24-hour sweep verified with a real row | settings + `pg-boss` | One certified invoice, one overdue row, one retried row |

Two rules that already hold and must not be broken by the real client:

- **No new synchronous dependency on the sale path.** Certification stays queued;
  the till never waits for GRA.
- **No secrets in logs.** The pino redaction list covers `token`/`secret`/`*password`,
  which does not match `security_key` by name — add it explicitly to the redaction
  paths when the client lands.

What we already have, so nobody rebuilds it:

- the 24-hour statutory deadline as a stored `due_at` (`evatDueAt`);
- the retry ladder and the sweep;
- `WAITING_FOR_INVOICE` for a refund whose invoice is not yet certified;
- `E700` handling as an `ATTENTION` outcome rather than an automatic retry;
- `SELLER_IDENTITY_MISSING` / `CERTIFICATE_INCOMPLETE` guards;
- the receipt contract with reserved SDC fields.

---

## 7. Go-live procedure

Run this in order, with the certificate of acceptance in hand.

1. **Rename the local env keys** if needed (§4) so `EVAT_*` is what exists.
2. **Set the seller identity** in the console: `tax.sellerTin`,
   `tax.sellerVatNumber`, and turn `pricing.vatRegistered` **on** (it is off while the
   business is unregistered). Check every branch's address, city, area and phone —
   the E-VAT document prints them.
3. **Put the production values in the server environment only**:
   `EVAT_PROVIDER=gra`, `EVAT_BASE_URL`, `EVAT_SECURITY_KEY`.
4. **Restart the API** and prove it booted: a missing key now fails the boot, so a
   process that is up is a process that has the key. Confirm `GET /api/health`
   (or the equivalent readiness route) shows the E-VAT provider as `GRA`.
5. **Run the health check** against production once, before any sale.
6. **Turn the flag on for one branch**, not all of them. Ring the first sale
   through the till yourself and watch the row reach `CERTIFIED`.
7. **Compare the certificate** against the printed receipt: TIN, signature, QR
   payload, totals. The three figures that must agree are gross, tax and total.
8. **Turn the flag on for the remaining branches.**
9. **Write down the go-live date** in `.planning/STATE.md` and in the branch notes:
   the certificate of acceptance is tied to a date and a version of the integration.

Rollback: `EVAT_PROVIDER=mock` (or the flag off) stops intake. It does **not**
delete submissions already queued — those are rows with a due date, and they stay
liable. Rollback is for stopping new work, not for erasing an obligation.

---

## 8. What changes the day after go-live

| Obligation | What it means for us | Where it lives |
|---|---|---|
| **Report within 24 hours** | A certified invoice should reach GRA by the end of the day it was issued. The E-VAT worker runs continuously; the sweep catches a missed doorbell | `evat_submission.due_at`, the retry ladder, the nightly sweep |
| **Offline stamping, then flush** | A sale taken offline is stamped/certified when connectivity returns; queued rows are pushed on reconnect and nothing is dropped | outbox → sale → `queueForSale` |
| **Tell GRA when the system is down** | The VAT administrative guidelines require a taxpayer whose certified system goes offline to inform the Commissioner-General. **[ask GRA]** for the channel and the window | a human process, not code — but the console should be able to show the outage window from `evat_submission` history |
| **Token / key renewal** | GRA's guidelines mention going online to obtain a new token/key for the VSDC to keep stamping. Assume keys expire and plan a rotation | the env, plus a calendar reminder owned by an admin |
| **Z-report** | GRA expects a periodic Z-report, not only invoices | our shift Z is a drawer report; the E-VAT Z is a separate submission **[ask GRA]** whether we must send it and on what cadence |
| **Purchases** | The API has a Purchase endpoint; input VAT depends on supplier invoices reaching GRA | out of scope for the POS, in scope for procurement later |
| **Retention** | Certified documents and their responses are statutory records | `evat_submission` is append-only; exports exist for audit |

---

## 9. Questions to put to GRA in writing

Send these with the request in §10 — the answers change the build, and asking later
means rebuilding.

1. **Environment:** do you provide a **test** environment and test credentials for an
   integrating taxpayer, or do we test against production with our own data?
2. **Offline POS:** our tills complete cash sales with no network and print
   immediately. May the paper receipt be issued without the SDC block and certified
   within 24 hours, or must the signature and QR be present before the customer
   receives the invoice?
3. **Topology:** for a hosted system with several shops, do you want one cloud
   integration per taxpayer, or a VSDC per location? If per location, how are serials
   and MRCs allocated?
4. **Branches:** is the VAT number shared across branches, and what identifier should
   the seller block carry per branch?
5. **Document version:** which API version is current for a new integration (we have
   seen 6.0, 7.0 and 8.2 in circulation), and will changes be announced in advance?
6. **Tax codes:** confirm the Ghana mapping for `TAX_A` / `TAX_B` / `TAX_C` and the
   treatment of zero-rated and exempt lines under Act 1151.
7. **Refunds:** how should a credit note reference a certified invoice, and what is
   the correct behaviour when the original invoice is not yet certified?
8. **Duplicate handling:** if we retry after a timeout and the first attempt actually
   succeeded, what does the API return, and is the invoice number we sent reused?
9. **Outage notification:** when our system cannot reach you, who do we notify, by
   what channel, and within what window?
10. **Key lifetime:** how long is the API security key valid, how is it rotated, and
    what happens to queued documents during rotation?
11. **Z-report:** is a periodic Z-report required from a POS, and at what cadence?
12. **UAT:** what does the Appendix 4 checklist expect us to demonstrate, and can we
    get it before the session so we can prepare?

---

## 10. Ready-to-send request

> **To:** your Taxpayer Service Centre (find it at `gra.gov.gh/domestic-tax/tax-service-centres/`)
> **Cc:** `evat.support@gra.gov.gh`
> **Subject:** Request for E-VAT integration — [LEGAL BUSINESS NAME], TIN [TIN]
>
> Dear Sir/Madam,
>
> We are a VAT-registered business trading as **[TRADING NAME]** (TIN **[TIN]**, VAT
> number **[VAT NO]**), operating **[N]** retail location(s) in **[city/region]**.
>
> We request onboarding to the Electronic VAT System (E-VAT) under the **integration**
> option. We operate our own invoicing system — a server-hosted application with
> point-of-sale terminals in each shop — and we wish to integrate it with the
> Commissioner-General's Certified Invoicing System rather than use the free
> invoicing application. Our POS continues to complete cash sales when the network is
> unavailable and reports them when connectivity returns, so we would also welcome
> your guidance on the correct treatment of invoices issued during an outage.
>
> Attached:
> 1. Business registration document
> 2. Identification document of the business owner
> 3. Signed consent form to join E-VAT
>
> Please advise on the next steps, the onboarding form, and the assignment of a
> relationship manager. Our technical contact for integration and UAT is
> **[NAME, ROLE, EMAIL, PHONE]**.
>
> Yours faithfully,
> **[NAME]**, **[ROLE]**, **[BUSINESS]**

---

## 11. Sources (read 28 October 2026)

| Source | What it establishes |
|---|---|
| [GRA — E-VAT](https://gra.gov.gh/e-services/e-vat/) | Two forms (free app vs integration); write to your TSC; 20% = 15% + 2.5% + 2.5%; 24-hour offline window; signature key; receipt features |
| [GRA — Guidelines on Certified Invoicing System (E-VAT), GRA/AG/2024/005](https://gra.gov.gh/wp-content/uploads/2024/07/E-VAT-GUIDELINES_20240222.pdf) | §10 onboarding process: relationship manager, onboarding form, integration vs free app, API documentation, testing, GRA sign-off, go-live |
| [GRA E-VAT Help Centre — How do I integrate my existing sales system with EVAT?](https://evatgra.zendesk.com/hc/en-us/articles/10990923915549-How-do-I-integrate-my-existing-sales-system-with-EVAT) | The 8 steps, the three attachments, the cloud API security key, the SDC fields, Appendix 4 → `evat.support@gra.gov.gh`, joint UAT and certificate of acceptance |
| [GRA E-VAT Help Centre — E-VAT API INTEGRATION DOCUMENT](https://evatgra.zendesk.com/hc/en-us/articles/34826329238941-E-VAT-API-INTEGRATION-DOCUMENT) | The current API document link (Postman, article updated March 2026) |
| [GRA — VAT Administrative Guidelines for Act 1151, GRA/AG/25/002](https://gra.gov.gh/wp-content/uploads/2026/01/VAT-Guidelines-for-VAT-ACT-1151.pdf) | Certified invoicing duty, the duty to notify GRA when the system is offline, VACS treatment |
| [VAT Act 2025 (Act 1151)](https://gra.gov.gh/wp-content/uploads/2026/01/VALUE-ADDED-TAX-ACT-2025-ACT-1151.pdf) | s.43 (invoice through a Certified Invoicing System, integration), s.72 (definition) |
| [GRA E-VAT API — VER 8.2 (public Postman copy)](https://documenter.getpostman.com/view/29596173/2s9YJgSKXe) | `security_key` auth, JSON/XML, request types, tax-code mapping — a public copy, not the one GRA will issue you |
| [GRA E-VAT API — VER 6.0 (public Postman copy)](https://documenter.getpostman.com/view/20074551/UVsQtQHr) | Older auth shape (`COMPANY_TIN`/`COMPANY_NAMES`/`COMPANY_SECURITY_KEY`), showing why the version matters |

Secondary (industry summaries, used only for context and clearly not authoritative):
[vatcalc](https://www.vatcalc.com/ghana/ghana-e-vat-electronic-invoicing-rollout),
[e-invoicing.org](https://e-invoicing.org/ghana),
[e-invoice.app](https://www.e-invoice.app/country/GH).

---

## 12. What is **not** verified — do not rely on it

- **Exact key format and lifetime.** No official page states the length, encoding, or
  expiry of the API security key. Take it from the document GRA sends you.
- **A public sandbox.** No official page advertises a self-service test environment.
  Assume you must ask; assume UAT happens against something GRA arranges.
- **Whether the key is per taxpayer or per location.** The guidance describes the
  taxpayer requesting a VSDC; multi-branch allocation is not published.
- **Exact penalties.** The Act and the guidelines both carry sanctions for failing to
  issue certified invoices, failing to integrate, and going offline without notifying
  GRA. The amounts are not reproduced here because the primary text should be read
  before anyone quotes a figure to a customer or a regulator.
- **Mandate dates by taxpayer class.** Third-party trackers describe waves and a
  general mandate from 1 January 2026, with some citing 1 July 2026 for all
  VAT-registered businesses. GRA's own page only says the system aligns with Act 1151.
  Confirm your own obligation with your TSC — being in an early wave is not the same
  as being legally required today.
- **The portal.** `https://gra.evatgra.com` did not respond from our network on
  28 October 2026. That may be geography, a browser requirement, or an outage. Try
  from a normal browser in Ghana before reporting it as broken.

---

## 13. One-page checklist

- [ ] VAT registration confirmed; TIN and VAT number in hand
- [ ] Business registration, owner ID, signed consent form scanned
- [ ] Branch addresses, cities, phone numbers collected
- [ ] Technical and commercial contacts named
- [ ] Letter sent to TSC asking for **integration**, cc `evat.support@gra.gov.gh`
- [ ] Relationship manager and onboarding form received
- [ ] API documentation + version recorded
- [ ] Cloud/API topology agreed; offline-printing treatment answered in writing
- [ ] API security key + base URL (test and production) received and stored as secrets
- [ ] `GraEvatProvider` written and tested against recorded fixtures
- [ ] Seller identity set: `tax.sellerTin`, `tax.sellerVatNumber`
- [ ] Appendix 4 readiness checklist completed and emailed
- [ ] Joint UAT passed; certificate of acceptance signed and filed
- [ ] `EVAT_PROVIDER=gra` on one branch, one sale certified, then all branches
- [ ] Go-live date and API version recorded in `.planning/STATE.md`
- [ ] Rotation reminder for the key; outage-notification channel written down
