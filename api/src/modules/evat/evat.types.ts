import type { EvatDocumentKind, EvatSubmissionStatus } from '@sceptre/shared'
import type { z } from 'zod'
import type { evatSubmission } from './evat.schema.ts'
import type { evatListQuerySchema } from './evat.validation.ts'

export type EvatSubmissionRow = typeof evatSubmission.$inferSelect

/** The certificate exactly as it comes back, never merged into the document. */
export interface EvatCertificateView {
  providerInvoiceNumber: string
  sdcId: string
  serial: string
  signature: string
  internalData: string
  machineCode: string
  stampedAt: string
  qrPayload: string
}

/**
 * One row as the console reads it. `overdue` is derived from `dueAt` on every
 * read and never stored (P14-D36): a row can be `RETRY` and overdue, and that
 * combination is exactly what an operator needs to see.
 */
export interface EvatSubmissionView {
  id: string
  kind: EvatDocumentKind
  status: EvatSubmissionStatus
  overdue: boolean
  attempts: number
  branchId: string
  terminalId: string
  saleId: string | null
  refundId: string | null
  /** The sale's receipt number or the refund's number. */
  documentNumber: string | null
  dueAt: string
  nextAttemptAt: string | null
  provider: string
  certificate: EvatCertificateView | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  submittedAt: string | null
  certifiedAt: string | null
  createdAt: string
}

export type EvatListQuery = z.infer<typeof evatListQuerySchema>

export interface EvatListFilters {
  branchId: string | null
  status?: EvatSubmissionStatus | undefined
  kind?: EvatDocumentKind | undefined
  overdue?: boolean | undefined
  from?: Date | undefined
  to?: Date | undefined
  limit: number
  offset: number
  /** One clock for the whole read, so `overdue` and the summary cannot disagree. */
  now: Date
}

export interface EvatSummary {
  queued: number
  certified: number
  retrying: number
  attention: number
  overdue: number
  /** How long the oldest overdue document has been past its deadline; null when none is. */
  oldestOverdueMinutes: number | null
}

/** The aggregate as SQL returns it; the service turns the date into minutes. */
export interface EvatSummaryCounts {
  queued: number
  certified: number
  retrying: number
  attention: number
  overdue: number
  oldestDueAt: Date | null
}

/** A submission joined to the document it names. */
export interface EvatSubmissionJoinedRow extends EvatSubmissionRow {
  documentNumber: string | null
}

export interface EvatSubmissionPage {
  submissions: EvatSubmissionView[]
  total: number
  branchId: string | null
}
