import type { AgingBucketKey, AgingBuckets } from "#/modules/payables"

export type { AgingBucketKey, AgingBuckets } from "#/modules/payables"

export type CreditEntryKind = "CHARGE" | "REPAYMENT" | "REFUND" | "ADJUSTMENT"
export type CreditMethod = "CASH" | "MOMO" | "BANK"
export type CreditReasonCode =
	| "SALE"
	| "OPENING_BALANCE"
	| "CORRECTION"
	| "WRITE_OFF"
	| "DISPUTE"
	| "RETURN"
	| "OTHER"

export interface CreditProfile {
	id: string
	customerId: string
	branchId: string
	limitMinor: number
	hold: boolean
	paymentTermDays: number
	notes: string | null
	balanceMinor: number
	createdAt: string
	updatedAt: string
}

export interface CreditProfileListRow extends CreditProfile {
	customerName: string
	customerPhone: string | null
	branchCode: string
	branchName: string
}

export interface CreditProfileUpdateInput {
	branchId?: string
	limitMinor?: number
	hold?: boolean
	paymentTermDays?: number
	notes?: string | null
}

export type CreditOverrideReason =
	| "TEMPORARY_APPROVAL"
	| "TRUSTED_CUSTOMER"
	| "URGENT_NEED"
	| "OTHER"

export interface RepaymentCreateInput {
	customerId: string
	branchId?: string
	/** Positive minor units; the server stores the negative ledger sign. */
	amountMinor: number
	method: CreditMethod
	note?: string
	idempotencyKey?: string
}

export interface CreditEntryCreateInput {
	customerId: string
	branchId?: string
	kind: "CHARGE" | "REFUND" | "ADJUSTMENT"
	/** CHARGE/REFUND positive; ADJUSTMENT signed non-zero. */
	amountMinor: number
	reasonCode?: CreditReasonCode
	referenceNumber?: string
	note?: string
	idempotencyKey?: string
	override?: { reasonCode: CreditOverrideReason; note?: string }
}

export interface CreditPostingResult {
	entry: CreditEntry
	profile: CreditProfile
}

/**
 * `AgingBucketKey` and `AgingBuckets` are the one piece of credit vocabulary that payables also
 * uses (`PayablesAgingResult`), so they are declared once in `#/modules/payables` and re-exported
 * here. Declaring them twice would let the two reports drift apart on the bucket names.
 */
export interface AgingChargeRow {
	entryId: string
	occurredAt: string
	dueDate: string
	amountMinor: number
	outstandingMinor: number
	daysPastDue: number
	bucket: AgingBucketKey
}

export interface AgingCustomerRow {
	customerId: string
	customerName: string
	branchId: string
	buckets: AgingBuckets
	totalMinor: number
	oldestDueDate: string | null
}

export interface BranchAging {
	branch: { id: string; code: string; name: string }
	customers: AgingCustomerRow[]
	totals: AgingBuckets & { total: number }
}

export interface AgingResult {
	asOf: string
	branches: BranchAging[]
}

export type AgingQuery = {
	branchId?: string
	asOf?: string
}

export interface StatementEntry {
	id: string
	kind: CreditEntryKind
	occurredAt: string
	dueDate: string | null
	amountMinor: number
	referenceType: string | null
	referenceNumber: string | null
	reasonCode: CreditReasonCode | null
	method: CreditMethod | null
	note: string | null
	createdBy: string | null
}

export interface CreditStatement {
	customer: { id: string; name: string; phone: string | null }
	branch: { id: string; code: string; name: string }
	from: string | null
	to: string
	openingBalanceMinor: number
	entries: StatementEntry[]
	closingBalanceMinor: number
	currentBalanceMinor: number
	aging: AgingChargeRow[]
}

export type StatementQuery = {
	branchId?: string
	from?: string
	to?: string
}

export interface CreditEntry {
	id: string
	customerId: string
	branchId: string
	kind: CreditEntryKind
	amountMinor: number
	reasonCode: CreditReasonCode | null
	method: CreditMethod | null
	note: string | null
	dueDate: string | null
	referenceType: string | null
	referenceId: string | null
	referenceNumber: string | null
	overrideReason: string | null
	overriddenBy: string | null
	receivedBy: string | null
	idempotencyKey: string | null
	createdBy: string | null
	occurredAt: string
	createdAt: string
	branchCode: string
}

export type CreditEntryListQuery = {
	customerId: string
	branchId?: string
	kind?: CreditEntryKind
	from?: string
	to?: string
	page?: number
	pageSize?: number
}

export interface CreditEntryListResult {
	entries: CreditEntry[]
	total: number
	page: number
	pageSize: number
}
