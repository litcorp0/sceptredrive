import type { EvatDocumentKind, EvatSubmissionStatus } from "@sceptre/shared"

/**
 * The E-VAT console contracts, mirroring `api/src/modules/evat`.
 *
 * `overdue` is derived by the API on every read and never stored (P14-D36): a row can be
 * retrying and overdue at the same time, and the console must show both facts rather than
 * pick one.
 */
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

export interface EvatListQuery {
	branchId?: string
	status?: EvatSubmissionStatus
	kind?: EvatDocumentKind
	overdue?: boolean
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface EvatSubmissionPage {
	submissions: EvatSubmissionView[]
	total: number
	branchId: string | null
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

export interface EvatHealth {
	ok: boolean
	detail?: string
	checkedAt: string
	/** True when this answer was reused rather than asked for again. */
	cached: boolean
}
