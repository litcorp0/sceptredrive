/**
 * The E-VAT certificate contract and its deadline arithmetic (P14-D35/P14-D36).
 *
 * Certificates live in `evat_submission`, never on the sale or refund. The
 * deadline is GRA's 24-hour stamping window, derived from the document's time
 * and never stored twice; the retry ladder is a fixed backoff, not a clock.
 */

export const EVAT_DOCUMENT_KINDS = ['INVOICE', 'REFUND'] as const
export type EvatDocumentKind = (typeof EVAT_DOCUMENT_KINDS)[number]

export const EVAT_SUBMISSION_STATUSES = [
  'QUEUED',
  'WAITING_FOR_INVOICE',
  'SUBMITTING',
  'CERTIFIED',
  'RETRY',
  'ATTENTION',
] as const
export type EvatSubmissionStatus = (typeof EVAT_SUBMISSION_STATUSES)[number]

export const EVAT_STATUS_LABELS: Record<EvatSubmissionStatus, string> = {
  QUEUED: 'Queued',
  WAITING_FOR_INVOICE: 'Waiting for invoice',
  SUBMITTING: 'Submitting',
  CERTIFIED: 'Certified',
  RETRY: 'Retrying',
  ATTENTION: 'Needs attention',
}

/** GRA's codes we must handle by name (research fact 10). */
export const EVAT_ERROR_CODES = {
  ALREADY_SIGNED: 'E700', // adopt the existing certificate, do not retry
  NOT_FOUND: 'E701', // the referenced invoice is not certified
  ALREADY_REFUNDED: 'E727',
  INVALID_SECURITY_KEY: 'E900',
} as const

/** GRA's obligation: offline generation for up to 24 hours (S7, S8). */
export const EVAT_DEADLINE_HOURS = 24

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000

export const EVAT_MAX_ATTEMPTS = 8
export const EVAT_RETRY_DELAYS_MINUTES = [1, 2, 5, 15, 60, 240, 720] as const

/** The document's deadline: `occurredAt + 24h`, derived rather than stored. */
export function evatDueAt(occurredAt: Date): Date {
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new RangeError('E-VAT occurredAt must be a valid Date')
  }
  return new Date(occurredAt.getTime() + EVAT_DEADLINE_HOURS * MILLISECONDS_PER_HOUR)
}

/**
 * The delay before the next attempt, in minutes. The ladder has seven rungs for
 * eight attempts; an attempt past the ladder returns the last delay rather than
 * `undefined`, so a caller can read the schedule without a bound check.
 */
export function evatRetryDelayMinutes(attempt: number): number {
  const lastIndex = EVAT_RETRY_DELAYS_MINUTES.length - 1
  const boundedAttempt = Math.min(Math.max(Math.trunc(attempt), 1), EVAT_MAX_ATTEMPTS)
  const index = Math.min(boundedAttempt - 1, lastIndex)
  return EVAT_RETRY_DELAYS_MINUTES[index] ?? EVAT_RETRY_DELAYS_MINUTES[lastIndex] ?? 1
}

/** Overdue only after the deadline: exactly `dueAt` is still on time. */
export function isEvatOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime()
}

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

const CERTIFICATE_FIELDS = [
  'providerInvoiceNumber',
  'sdcId',
  'serial',
  'signature',
  'internalData',
  'machineCode',
  'stampedAt',
  'qrPayload',
] as const satisfies readonly (keyof EvatCertificate)[]

/** Null when complete; otherwise the name of the first missing field. */
export function certificateProblem(input: Partial<EvatCertificate>): string | null {
  for (const field of CERTIFICATE_FIELDS) {
    const value = input[field]
    if (typeof value !== 'string' || value.trim().length === 0) {
      return `Certificate is missing ${field}`
    }
  }
  return null
}
