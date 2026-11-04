import type {
	CartVoidReason,
	ConflictResolutionCode,
	RefundReason,
	RefundRestock,
	TenderMethod,
} from "@sceptre/shared"

/**
 * The shapes the oversight API returns, mirrored for the console.
 *
 * Every money field is an integer the server already decided; the console renders it
 * and never re-adds a total. The types are deliberately narrow: a screen that has no
 * field cannot invent one.
 */

export type SyncConflictSeverity = "LOW" | "MEDIUM" | "HIGH"
export type ConflictStatus = "OPEN" | "RESOLVED" | "DISMISSED"
export type RefundTenderStatus = "SETTLED" | "PENDING" | "FAILED" | "NEEDS_ATTENTION"
export type ShiftStatus = "OPEN" | "CLOSED"
export type ShiftReviewStatus = "NONE" | "REQUIRED" | "REVIEWED"

export interface OversightSaleRow {
	id: string
	receiptNumber: string
	occurredAt: string
	branchId: string
	branchCode: string
	branchName: string
	terminalCode: string
	shiftId: string
	cashierName: string
	customerName: string | null
	itemsSold: number
	totalMinor: number
	taxTotalMinor: number
	changeMinor: number
	creditMinor: number
	conflictCount: number
	refundedMinor: number
}

export interface OversightSaleLine {
	lineNumber: number
	productId: string
	sku: string
	name: string
	barcode: string | null
	quantity: number
	unitPriceMinor: number
	expectedUnitPriceMinor: number
	lineDiscountMinor: number
	saleDiscountMinor: number
	loyaltyDiscountMinor: number
	netMinor: number
	taxableMinor: number
	baseMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	taxTotalMinor: number
	totalMinor: number
	taxCategory: string
}

export interface OversightSaleTender {
	sequence: number
	method: TenderMethod
	amountMinor: number
	reference: string | null
}

export interface OversightSaleRefundRef {
	id: string
	number: string
	refundedMinor: number
	occurredAt: string
}

export interface OversightSaleConflictRef {
	id: string
	type: string
	severity: SyncConflictSeverity
	status: ConflictStatus
	resolutionCode: ConflictResolutionCode | null
}

export interface OversightSaleDetail {
	sale: OversightSaleRow
	lines: OversightSaleLine[]
	tenders: OversightSaleTender[]
	refunds: OversightSaleRefundRef[]
	conflicts: OversightSaleConflictRef[]
}

export interface ReceiptEvatBlock {
	providerInvoiceNumber: string | null
	sdcId: string | null
	serial: string | null
	signature: string | null
	internalData: string | null
	machineCode: string | null
	stampedAt: string | null
	qrPayload: string | null
}

export interface ReceiptCopy {
	header: {
		seller: string
		branch: string
		branchCode: string
		terminal: string
		receiptNumber: string
		occurredAt: string
		cashier: string
		customer: { name: string; phoneMasked: string } | null
		isCopy: true
		reprint: false
	}
	lines: OversightSaleLine[]
	totals: {
		subtotalMinor: number
		lineDiscountMinor: number
		saleDiscountMinor: number
		loyaltyDiscountMinor: number
		taxableMinor: number
		vatMinor: number
		nhilMinor: number
		getfundMinor: number
		taxTotalMinor: number
		totalMinor: number
	}
	tenders: OversightSaleTender[]
	tenderedMinor: number
	changeMinor: number
	loyalty: { earnedPoints: number; redeemedPoints: number } | null
	footer: string
	evat: ReceiptEvatBlock | null
}

export interface OversightRefundRow {
	id: string
	number: string
	occurredAt: string
	branchId: string
	branchCode: string
	branchName: string
	terminalCode: string
	saleId: string
	shiftId: string
	receiptNumber: string
	refundedMinor: number
	reasonCode: RefundReason
	tenderCount: number
	hasPendingTender: boolean
	approvalId: string | null
	approvedBy: string | null
	approvedByStaffId: string
}

export interface OversightRefundLine {
	lineNumber: number
	productId: string
	productName: string
	sku: string
	quantity: number
	unitPriceMinor: number
	restock: RefundRestock
	damageReason: string | null
	baseMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	taxTotalMinor: number
	totalMinor: number
}

export interface OversightRefundTender {
	sequence: number
	method: TenderMethod
	amountMinor: number
	status: RefundTenderStatus
	settledAt: string | null
	providerRefundReference: string | null
	failedMessage: string | null
}

export interface OversightRefundDetail {
	refund: OversightRefundRow & {
		note: string | null
		approvedAt: string
		baseMinor: number
		vatMinor: number
		nhilMinor: number
		getfundMinor: number
		taxTotalMinor: number
	}
	lines: OversightRefundLine[]
	tenders: OversightRefundTender[]
}

export interface OversightShiftRow {
	id: string
	number: string
	status: ShiftStatus
	reviewStatus: ShiftReviewStatus
	branchId: string
	branchCode: string
	branchName: string
	terminalCode: string
	cashierName: string
	openedAt: string
	closedAt: string | null
	openingFloatMinor: number
	serverExpectedCashMinor: number | null
	countedCashMinor: number | null
	varianceMinor: number | null
	hasReport: boolean
}

export interface ShiftReportView {
	kind: "X" | "Z"
	shiftId: string
	number: string
	branchId: string
	terminalId: string
	deviceId: string
	openedAt: string
	closedAt: string | null
	openingFloatMinor: number
	saleCount: number
	itemCount: number
	refundCount: number
	voidCount: number
	grossMinor: number
	refundMinor: number
	netMinor: number
	lineDiscountMinor: number
	saleDiscountMinor: number
	loyaltyDiscountMinor: number
	loyaltyRedeemPoints: number
	loyaltyEarnedPoints: number
	baseMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	taxTotalMinor: number
	cashMinor: number
	creditMinor: number
	momoMinor: number
	cardMinor: number
	bankTransferMinor: number
	changeMinor: number
	cashInMinor: number
	cashOutMinor: number
	cashRefundMinor: number | null
	cashRepaymentMinor: number | null
	expectedCashMinor: number
	countedCashMinor: number | null
	varianceMinor: number | null
	generatedAt: string
}

export interface OversightVoidRow {
	id: string
	occurredAt: string
	reasonCode: CartVoidReason
	reasonLabel: string
	label: string | null
	itemCount: number
	grossMinor: number
	cashierName: string
}

export interface OversightVoidSummary {
	count: number
	itemCount: number
	grossMinor: number
	rows: OversightVoidRow[]
}

export interface OversightShiftDetail {
	shift: OversightShiftRow
	report: ShiftReportView | null
	reportState: "STORED" | "LIVE" | "MISSING"
	voids: OversightVoidSummary
}

export interface OversightSalesList {
	sales: OversightSaleRow[]
	total: number
	limit: number
	offset: number
}

export interface OversightRefundsList {
	refunds: OversightRefundRow[]
	total: number
	limit: number
	offset: number
}

export interface OversightShiftsList {
	shifts: OversightShiftRow[]
	total: number
	limit: number
	offset: number
}

export interface ConflictRow {
	id: string
	type: string
	severity: SyncConflictSeverity
	status: ConflictStatus
	createdAt: string
	branchId: string
	branchCode: string
	terminalId: string
	terminalCode: string
	saleId: string | null
	receiptNumber: string | null
	shiftId: string | null
	shiftNumber: string | null
	resolvedBy: string | null
	resolvedAt: string | null
	resolutionCode: ConflictResolutionCode | null
	resolutionNote: string | null
	details: Record<string, unknown>
}

export type ConflictSubject =
	| {
			kind: "sale"
			id: string
			receiptNumber: string
			occurredAt: string
			totalMinor: number
			conflictCount: number
	  }
	| {
			kind: "shift"
			id: string
			number: string
			openedAt: string
			closedAt: string | null
			varianceMinor: number | null
	  }
	| { kind: "none" }

export interface ConflictDetail extends ConflictRow {
	subject: ConflictSubject
}

export interface ConflictList {
	conflicts: ConflictRow[]
	total: number
	limit: number
	offset: number
}

export interface ConflictResolutionInput {
	status: "RESOLVED" | "DISMISSED"
	code: ConflictResolutionCode
	note?: string | null
}

export interface OversightScopeQuery {
	branchId?: string
	from?: string
	to?: string
	terminalId?: string
	limit?: number
	offset?: number
}

export interface OversightSalesQuery extends OversightScopeQuery {
	receiptNumber?: string
	cashierStaffId?: string
}

export interface OversightRefundsQuery extends OversightScopeQuery {
	reasonCode?: RefundReason
	method?: TenderMethod
	tenderStatus?: RefundTenderStatus
}

export interface OversightShiftsQuery extends OversightScopeQuery {
	cashierStaffId?: string
	status?: ShiftStatus
	reviewStatus?: ShiftReviewStatus
}

export interface ConflictListQuery extends OversightScopeQuery {
	status?: "OPEN" | "RESOLVED" | "DISMISSED" | "ALL"
	type?: string
	severity?: SyncConflictSeverity
	saleId?: string
	shiftId?: string
}
