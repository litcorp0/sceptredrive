---
phase: 14-admin-operations-evatu
plan: 01
title: Shared vocabulary — permissions, flags, conflict, transfer and E-VAT labels
lane: shared
depends_on: []
requirements: [ADM-07, ADM-08, PAY-04, PAY-06, EVAT-01, EVAT-03]
---

# Plan 01 — One word for one thing, before anything is built on it

## Goal

`packages/shared` owns every word this phase puts on a screen or a receipt: six
permissions, the flag registry, the conflict resolution vocabulary, the transfer status
map, and the E-VAT certificate contract with its deadline arithmetic. After this plan no
later plan invents a status string in a module, and the console, the API and the till
cannot describe the same row differently.

## Read first

- `00-DECISIONS.md` P14-D5, D6, D14, D24, D34–D37, D41.
- `packages/shared/src/permissions.ts:3-138` — the list, the three role arrays, `can`.
- `packages/shared/src/permissions.test.ts:134-137` — the hard-coded `60/49/0` counts.
- `packages/shared/src/refund.ts` — the label-map pattern this plan copies, and
  `refundApprovalRequired` as the shape of a shared predicate.
- `packages/shared/src/pin.ts` — the shape of a shared *policy* function (`pinProblem`
  returns a human sentence or null; the callers enforce it).
- `01-RESEARCH.md` §1.1 facts 1–4 and 8–11.

## Tasks

### 1. Permissions

`permissions.ts` gains six entries, appended in the order a reader meets them:

```ts
'pos.oversight.read',   // sales, refunds, shifts, receipt copies
'conflict.read',
'conflict.resolve',
'payable.transfer',     // recipients, initiation, finalisation
'evat.read',
'evat.retry',
```

`MANAGER_PERMISSIONS` gains all but `evat.retry`. `CASHIER_PERMISSIONS` stays `[]` —
untouched, and the test that asserts length 0 stays.

`permissions.test.ts`: the counts become **66 / 54 / 0**; add one assertion per new
permission to the manager matrix, and one asserting a manager does **not** hold
`evat.retry` (the retry button is an admin action because a failed submission is a
compliance matter, not a branch one).

### 2. Flags

New `packages/shared/src/flags.ts`:

```ts
export const FLAG_KEYS = [
  'flag.supplierTransfers',
  'flag.evatSubmission',
  'flag.posConflictResolution',
] as const

export type FlagKey = (typeof FLAG_KEYS)[number]

/** Defaults are on: this phase ships these features. A flag exists to turn one off
 *  without a deploy, not to hide a half-built screen. */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  'flag.supplierTransfers': true,
  'flag.evatSubmission': true,
  'flag.posConflictResolution': true,
}

export const FLAG_DESCRIPTIONS: Record<FlagKey, string> = { … one sentence each … }

export function isFlagKey(key: string): key is FlagKey
```

Three flags, no more. A flag nobody reads is a setting with a nicer name; each of these is
read by exactly one plan (06, 07, 08) and each is named in `FLAG_DESCRIPTIONS` in terms a
manager can act on.

### 3. Conflicts

New `packages/shared/src/conflicts.ts`:

```ts
export const CONFLICT_RESOLUTION_CODES = [
  'CONFIRMED',            // the conflict is real and the fact stands
  'CORRECTED_ELSEWHERE',  // a compensating document already handled it
  'ACCEPTED_RISK',        // known, tolerated, recorded
  'TILL_INSTRUCTION',     // the branch was told what to do at the counter
  'DUPLICATE',            // the same fact, recorded twice
] as const

export const CONFLICT_RESOLUTION_LABELS: Record<ConflictResolutionCode, string>
export const CONFLICT_TYPE_LABELS: Record<string, string>   // all 16, from the enum
export const CONFLICT_SEVERITY_LABELS: Record<'LOW'|'MEDIUM'|'HIGH', string>

/** Null when the resolution is complete, a sentence when it is not (P14-D14). */
export function resolutionProblem(input: {
  status: 'RESOLVED' | 'DISMISSED'
  code: string | null
  note: string | null
}): string | null
```

`resolutionProblem` is the only place the "a dismissal needs a note" rule lives, so the
API and the console cannot disagree about when the button is enabled. The 16 type labels
are the enum's own names in words (`CREDIT_OVER_LIMIT` → "Credit over limit"); they are
listed here rather than derived from the string because `MOMO`-style acronyms do not
survive a generic title-caser.

### 4. Transfers

New `packages/shared/src/transfers.ts`:

```ts
export const TRANSFER_STATUSES = [
  'PENDING', 'AWAITING_OTP', 'SUCCESS', 'FAILED', 'REVERSED', 'BLOCKED', 'REJECTED',
] as const

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string>

/** Paystack's own vocabulary → ours. Null means "we do not know this status", which the
 *  caller treats as no transition rather than as failure. */
export function mapProviderTransferStatus(raw: string): TransferStatus | null

/** SUCCESS only. A reversal is money that came back; it is not a payment. */
export function transferMovedMoney(status: TransferStatus): boolean

/** Terminal states never move again; a webhook arriving for one is a duplicate. */
export function isTerminalTransferStatus(status: TransferStatus): boolean
```

`mapProviderTransferStatus` covers `pending`, `otp`, `success`, `failed`, `reversed`,
`blocked`, `rejected`, and returns `null` for anything else. Lower-cased on the way in —
Paystack's payloads are lowercase and our enum is not.

### 5. E-VAT

New `packages/shared/src/evat.ts`:

```ts
export const EVAT_DOCUMENT_KINDS = ['INVOICE', 'REFUND'] as const
export const EVAT_SUBMISSION_STATUSES = [
  'QUEUED', 'WAITING_FOR_INVOICE', 'SUBMITTING', 'CERTIFIED', 'RETRY', 'ATTENTION',
] as const

export const EVAT_STATUS_LABELS: Record<EvatSubmissionStatus, string>

/** GRA's codes we must handle by name (research fact 10). */
export const EVAT_ERROR_CODES = {
  ALREADY_SIGNED: 'E700',   // adopt the existing certificate, do not retry
  NOT_FOUND: 'E701',        // the referenced invoice is not certified
  ALREADY_REFUNDED: 'E727',
  INVALID_SECURITY_KEY: 'E900',
} as const

/** GRA's obligation: offline generation for up to 24 hours (S7, S8). */
export const EVAT_DEADLINE_HOURS = 24
export const EVAT_MAX_ATTEMPTS = 8
export const EVAT_RETRY_DELAYS_MINUTES = [1, 2, 5, 15, 60, 240, 720] as const

export function evatDueAt(occurredAt: Date): Date
export function evatRetryDelayMinutes(attempt: number): number
export function isEvatOverdue(dueAt: Date, now: Date): boolean

/** A certificate is complete or it is not a certificate. */
export interface EvatCertificate {
  providerInvoiceNumber: string
  sdcId: string
  serial: string
  signature: string
  internalData: string
  machineCode: string
  stampedAt: string
  qrPayload: string
}

export function certificateProblem(input: Partial<EvatCertificate>): string | null
```

`certificateProblem` exists so a mock provider that returns seven of eight fields is a
failure rather than a receipt with a blank where a signature should be. `evatDueAt` and
`isEvatOverdue` take `Date` and are pure; the deadline is never stored twice (D36).

### 6. Exports

`packages/shared/src/index.ts` re-exports each new file: `flags`, `conflicts`, `transfers`,
`evat`, and the new permissions are already exported by `permissions.ts`.

### 7. Tests

`flags.test.ts`: every key is unique, every key starts with `flag.`, defaults are booleans,
`isFlagKey` rejects `flag.nope` and accepts each key.

`conflicts.test.ts`: `resolutionProblem` returns null for RESOLVED+code+null note, a
sentence for RESOLVED without a code, a sentence for DISMISSED without a note, null for
DISMISSED+code+note; every one of the 16 enum names has a label and no label is the raw
enum name.

`transfers.test.ts`: the seven statuses map from Paystack's seven spellings; an unknown
string maps to null; `transferMovedMoney('SUCCESS')` is true and is false for `REVERSED`,
`FAILED` and `PENDING`; terminal is true for SUCCESS/FAILED/REVERSED/BLOCKED/REJECTED and
false for PENDING/AWAITING_OTP.

`evat.test.ts`: the deadline is 24 hours to the millisecond; retry delays are strictly
increasing, bounded at 8 attempts, and `evatRetryDelayMinutes(99)` returns the last delay
rather than undefined; `isEvatOverdue` is false at exactly `dueAt` and true one second
after; `certificateProblem` rejects each missing field by name and accepts a complete one.

`permissions.test.ts`: the new counts and matrix.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run check-types
bun run lint
```

Expected: shared **318 → ~365**. No other workspace changes. `git diff --stat` touches
`packages/shared/**` and nothing else — if `api/`, `admin/` or `desktop/` appear, a label
was put in the wrong place.

## Commits

1. `feat(shared): six permissions for oversight, conflict, transfer and E-VAT`
2. `feat(shared): the flag registry, as three typed boolean settings`
3. `feat(shared): conflict resolution vocabulary and the rule that a dismissal needs a note`
4. `feat(shared): transfer statuses, Paystack's spelling of them, and what counts as money`
5. `feat(shared): the E-VAT certificate contract, retry ladder and 24-hour deadline`
6. `test(shared): labels, maps, ladders and the deadline boundary`

## Done when

- The permission counts are 66/54/0 and every new permission has an assertion.
- No later plan needs to write a status string of its own: each one maps through a shared
  function.
- A certificate with a missing signature cannot pass `certificateProblem`.
- The deadline arithmetic is testable without a clock.
