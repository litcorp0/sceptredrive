---
phase: 14-admin-operations-evatu
plan: 07
title: E-VAT — the provider seam, the mock, the queue, the deadline
lane: api
depends_on: [02]
requirements: [EVAT-01, EVAT-02, EVAT-03]
---

# Plan 07 — The certificate is a separate fact

## Goal

Every sale and every refund queues an E-VAT submission. A provider certifies it and the
certificate is stored beside the document, not inside it. Failures retry on a documented
ladder, a refusal is visible with GRA's own code, and a document still uncertified after 24
hours is flagged as overdue. The provider is a mock; the seam is real.

## Read first

- `00-DECISIONS.md` P14-D33 to D40.
- `01-RESEARCH.md` facts 8–11 and S7–S10 (the certificate's shape, the deadline, the error
  codes, why there is no HTTP client).
- `packages/shared/src/evat.ts` (Plan 01) — `EVAT_DOCUMENT_KINDS`, the statuses,
  `EVAT_ERROR_CODES`, `EVAT_DEADLINE_HOURS`, `EVAT_RETRY_DELAYS_MINUTES`,
  `certificateProblem`, `evatDueAt`, `isEvatOverdue`.
- `api/src/modules/payments/payments.provider.ts:86-110` — the factory pattern this
  mirrors.
- `api/src/modules/payments/payments.mock.provider.ts` — the mock's harness hooks.
- `api/src/config/env.ts:54-86`, `:161-167` — how `PAYSTACK_*` fails closed.
- `api/src/jobs/queues.ts:14-56`, `:71-80`, `:145-153`, `:242-249` — queues, enqueue,
  boot list, schedule.
- `api/src/modules/sync/sync.service.ts:295-470` — `dispatchTransaction`, where a sale is
  applied and where the submission row is queued.
- `api/src/modules/pos/pos.service.ts:2366-2399` — the refund path that must wait for its
  invoice.
- `api/src/modules/platform/settings.validation.ts` — `tax.sellerTin`, `tax.sellerVatNumber`
  from Plan 02.
- `api/migrations/0017_phase14_schema.sql` — the table this module's `evat.schema.ts` now
  declares.

## Tasks

### 1. Environment, fail-closed

`api/src/config/env.ts`:

```ts
EVAT_PROVIDER: z.enum(['mock', 'gra']).default('mock'),
EVAT_BASE_URL: optionalUrl,
EVAT_SECURITY_KEY: optionalNonEmpty(z.string().min(8)),
EVAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10_000),
```

A refinement refuses boot when `EVAT_PROVIDER=gra` and either the URL or the key is
missing — the same rule `PAYSTACK_MODE !== 'mock'` already follows. `.env.example` documents
all four with the sentence that GRA issues the key to the taxpayer at onboarding, not to us.

### 2. The module

`api/src/modules/evat/` — the seven-file layout plus a provider pair, following
`payments/`:

| File | Responsibility |
|---|---|
| `evat.schema.ts` | the Drizzle definition of `evat_submission` (the table was created in 0017) |
| `evat.provider.ts` | `EInvoicingProvider`, `EvatDocument`, `EvatCertificate`, `EvatRefusal`, `getEvatProvider()` |
| `evat.mock.provider.ts` | deterministic certification + refusal switches for tests |
| `evat.repository.ts` | Drizzle only |
| `evat.service.ts` | queueing, submission, state machine, adoption, deadlines |
| `evat.validation.ts` | strict query/param schemas |
| `evat.controller.ts` | HTTP handlers |
| `evat.routes.ts` | paths and permissions |
| `evat.types.ts` | row, view and filter types |
| `evat.test.ts` | the state machine and the queue |

The interface is deliberately small:

```ts
export interface EInvoicingProvider {
  readonly name: 'MOCK' | 'GRA'
  healthCheck(): Promise<{ ok: boolean; detail?: string }>
  certify(document: EvatDocument): Promise<EvatCertification>
  /** Optional: only a provider that can look a document up can recover from E700. */
  fetchCertificate?(providerInvoiceNumber: string): Promise<EvatCertification | null>
}

export type EvatCertification =
  | { ok: true; certificate: EvatCertificate }
  | { ok: false; code: string; message: string; retryable: boolean }
```

`EvatDocument` carries everything a provider needs and nothing it does not: `kind`,
`documentNumber` (the sale's `receiptNumber` or the refund's `number`), `originalInvoiceNumber`
(null for an invoice), `occurredAt`, seller `{ name, tin, vatNumber, branchCode, address,
city, area, phone }`, `currency: 'GHS'`, `calculationType: 'INCLUSIVE' | 'EXCLUSIVE'` from
`pricing.taxMode`, `totals` (`baseMinor`, `nhilMinor`, `getfundMinor`, `vatMinor`,
`totalMinor`), `lines[]` (`name`, `sku`, `quantity`, `unitPriceMinor`, `lineTotalMinor`,
`taxCategory`), and `tenders[]` (`method`, `amountMinor`). **No customer name, no phone,
no tender reference** — GRA needs the transaction, not the person.

The mock: a deterministic certificate derived from the document number
(`serial = '<branchCode>-00004391'`, `signature` = the first 16 hex of
`sha256(documentNumber)` in four groups, `qr_payload =
'https://evat.mock.invalid/verify?data=…'` — the `.invalid` TLD is reserved, so a mock QR
cannot be mistaken for a real one). Hooks: `failNextMockSubmission(code, retryable)`,
`makeMockHealthFail()`, `resetMockEvat()`.

### 3. Queueing

`evat.service.queueForSale(saleId, executor)` / `queueForRefund(refundId, executor)` insert
one `QUEUED` row with `due_at = evatDueAt(occurredAt)`; the partial uniques make a replay a
no-op (`ON CONFLICT DO NOTHING` and read back).

Called from `sync.service.dispatchTransaction` **inside** the upload transaction, for a
`SALE` and for a `REFUND`. After the transaction commits, `enqueueEvatSubmission(id)` sends
a pg-boss job. If the send is lost the row is still `QUEUED` and the 5-minute sweep picks it
up — the database is the queue and the job is the doorbell.

A refund whose sale has no `CERTIFIED` submission starts `WAITING_FOR_INVOICE`
(P14-D37). When an invoice certifies, the service transitions that invoice's waiting
refunds to `QUEUED` in the same transaction.

The flag: `flag.evatSubmission` false means new documents are **not queued** and the
console says submissions are switched off. Existing queued rows still process — a flag
turns off the intake, not the obligation.

### 4. The state machine

`submit(submissionId, executor)`:

1. Lock the row. Refuse unless `status ∈ { QUEUED, RETRY, WAITING_FOR_INVOICE }`.
2. `WAITING_FOR_INVOICE`: re-check the sale's submission; still not certified → return
   unchanged without spending an attempt.
3. `SUBMITTING`, `attempts + 1`, `submitted_at = now()`.
4. Build the document from the sale/refund's own rows and the seller settings.
5. `provider.certify(document)`.
6. `ok` → `certificateProblem`; a problem is a refusal with our code
   `CERTIFICATE_INCOMPLETE` naming the missing field. A complete certificate writes the
   eight fields, `status = 'CERTIFIED'`, `certified_at`, and transitions waiting refunds.
7. `!ok` and `code === 'E700'` → if the provider can `fetchCertificate`, adopt it and
   certify; otherwise `ATTENTION` with `E700` and the message that GRA already has it
   (research fact 10).
8. `!ok` and `retryable` and `attempts < EVAT_MAX_ATTEMPTS` → `RETRY`,
   `next_attempt_at = now() + evatRetryDelayMinutes(attempts)`.
9. Anything else → `ATTENTION` with the code and message; no further automatic attempts.

`overdue` is never a status: it is `isEvatOverdue(due_at, now)` on read. A row can be
`RETRY` and overdue, which is exactly what an operator needs to see.

### 5. The worker and the sweep

`api/src/jobs/queues.ts` gains `evat-submit` (every 5 minutes, `missed: 'once'`) and
`enqueueEvatSubmission(id)`. The worker claims up to 50 rows where
`status IN ('QUEUED','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
ordered by `next_attempt_at`, and submits each. Each row is its own transaction and its own
try/catch: one bad payload cannot stop the other 49. Logs are `{ submissionId, status,
attempts, code }` — never the payload, which contains money and a TIN.

The sweep also transitions `WAITING_FOR_INVOICE` rows whose invoice has since certified, so
a refund is not stranded by a crashed job.

### 6. Routes

| Method | Path | Permission |
|---|---|---|
| GET | `/api/evat/submissions` | `evat.read` |
| GET | `/api/evat/submissions/:id` | `evat.read` |
| POST | `/api/evat/submissions/:id/retry` | `evat.retry` (admin only) |
| GET | `/api/evat/summary` | `evat.read` |
| GET | `/api/evat/health` | `evat.read` — calls `provider.healthCheck()` at most once a minute |

Filters: `branchId` (manager forced), `status`, `kind`, `overdue`, `from`, `to`, paging.
A retry resets `status = 'QUEUED'`, `next_attempt_at = now()` and appends an audit row
`evat.submission.retried` — it does not reset `attempts`, because the attempt count is
history.

`GET /api/evat/summary` returns `{ queued, certified, retrying, attention, overdue,
oldestOverdueMinutes }` for the branch(es) the caller may see.

### 7. Tests — `evat.test.ts`

- a sale upload queues exactly one `QUEUED` row with `due_at = occurredAt + 24h`; a replayed
  upload queues none;
- a refund upload queues `WAITING_FOR_INVOICE` until the sale certifies, then `QUEUED`;
- a mock certification stores all eight fields and `status = 'CERTIFIED'`;
- **the sale is byte-identical after certification** — take a checksum over `sale` and
  `sale_line` before and after, exactly as Plan 04 does for conflicts;
- the certificate's `provider_invoice_number` is the sale's `receiptNumber` and the
  `qr_payload` is the mock's own string, never composed by us (assert the prefix and that
  the service contains no `https://` literal);
- a refusal with `retryable: true` sets `RETRY` and `next_attempt_at` to 1, 2, 5 … minutes;
- the eighth failure sets `ATTENTION` and the ninth attempt never happens;
- `E700` with a provider that can fetch → `CERTIFIED` from the fetched certificate;
  `E700` with one that cannot → `ATTENTION` with `E700`;
- `E900` → `ATTENTION` immediately, no retry;
- a certificate missing `signature` → `ATTENTION` with `CERTIFICATE_INCOMPLETE`;
- a row 25 hours old reads `overdue: true` while `status = 'RETRY'`;
- `flag.evatSubmission = false` queues nothing for a new sale and still processes an
  existing `QUEUED` row;
- a manager sees their branch's submissions and a 403 on another's; a manager's retry is a
  403 (`evat.retry` is admin-only);
- a worker run over three rows where the middle one throws certifies the other two.

## Verification

```bash
bun run --filter api test     # ~870 → ~900
bun run check-types
```

By hand: sell on the till (mock payment), watch one row appear, certify within the minute,
open the receipt copy from Plan 03 and see the certificate attached to an unchanged sale.
Switch the mock to fail twice and watch the retry ladder in `next_attempt_at`.

## Commits

1. `feat(api): E-VAT configuration that refuses to boot half-configured`
2. `feat(api): the provider seam and a mock that cannot be mistaken for GRA`
3. `feat(api): every sale and refund queues a submission beside itself`
4. `feat(api): the retry ladder, the E700 adoption and the 24-hour deadline`
5. `feat(api): the submission worker, the sweep and the failure surface`
6. `test(api): certification leaves the document byte-identical`

## Done when

- Every sale has a submission and every submission has a visible state.
- A failure is a code and a message a person can act on, not a silent row.
- Nothing in the phase can write a certificate field onto a sale or a refund.
