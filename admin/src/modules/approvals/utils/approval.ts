import {
	APPROVAL_REASON_CODES,
	APPROVAL_STATUSES,
	APPROVAL_TYPES,
	type ApprovalReasonCode,
	type ApprovalStatus,
	type ApprovalType,
	formatCount,
	formatRelative,
	REFUND_REASON_LABELS,
	REFUND_REASONS,
	type RefundReason,
} from "@sceptre/shared"
import { z } from "zod"
import type { StatusVariant } from "#/components/common/status-badge"
import { formatGhs } from "#/lib/format"
import type { ApprovalListRow, ApprovalSubject } from "../types"

/**
 * The words the approval inbox shares.
 *
 * The API sends machine values (`PENDING`, `PRICE_CHANGE`); this file is the only place the
 * console turns them into a sentence, so an inbox row and its detail cannot disagree.
 */
export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
	PURCHASE_ORDER: "Purchase order",
	PRODUCT_CREATE: "Product submission",
	TRANSFER_REQUEST: "Transfer request",
	STOCK_WRITE_OFF: "Stock write-off",
	PRICE_CHANGE: "Price change",
	CREDIT_LIMIT_CHANGE: "Credit limit change",
	SHIFT_VARIANCE_REVIEW: "Shift variance review",
	REFUND: "Refund",
}

export function typeLabel(type: ApprovalType): string {
	return APPROVAL_TYPE_LABELS[type]
}

/** A type is not a lifecycle state: the variant distinguishes families, not success or failure. */
export function typeTone(type: ApprovalType): StatusVariant {
	switch (type) {
		case "STOCK_WRITE_OFF":
		case "SHIFT_VARIANCE_REVIEW":
		case "REFUND":
			return "warn"
		default:
			return "info"
	}
}

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
	PENDING: "Pending",
	APPROVED: "Approved",
	REJECTED: "Rejected",
	WITHDRAWN: "Withdrawn",
}

export function statusLabel(status: ApprovalStatus): string {
	return APPROVAL_STATUS_LABELS[status]
}

export function statusTone(status: ApprovalStatus): StatusVariant {
	switch (status) {
		case "PENDING":
			return "warn"
		case "APPROVED":
			return "ok"
		case "REJECTED":
			return "danger"
		default:
			return "muted"
	}
}

export const APPROVAL_REASON_LABELS: Record<ApprovalReasonCode, string> = {
	OVER_THRESHOLD: "Over the threshold",
	PRICE_TOO_HIGH: "Price too high",
	OUT_OF_POLICY: "Out of policy",
	INCOMPLETE: "Incomplete",
	DUPLICATE: "Duplicate",
	OTHER: "Other",
}

export function approvalReasonLabel(code: ApprovalReasonCode | null): string {
	return code ? APPROVAL_REASON_LABELS[code] : "no reason recorded"
}

/** A refund's reason comes from the shared vocabulary, so the till and the console agree. */
export function refundReasonLabel(code: string): string {
	return (REFUND_REASONS as readonly string[]).includes(code)
		? REFUND_REASON_LABELS[code as RefundReason]
		: code
}

/**
 * Where the money is: a settled tender has arrived, a pending electronic one is on its way
 * back, and the two failure states are the reviewer's cue to look closer.
 */
export const REFUND_TENDER_STATUS_LABELS = {
	SETTLED: "Settled",
	PENDING: "Back to the card",
	FAILED: "Failed",
	NEEDS_ATTENTION: "Needs attention",
} as const

export function refundTenderStatusLabel(status: string): string {
	return status in REFUND_TENDER_STATUS_LABELS
		? REFUND_TENDER_STATUS_LABELS[status as keyof typeof REFUND_TENDER_STATUS_LABELS]
		: status
}

/**
 * The value column's unit. A price and a variance must never look like the same kind of number,
 * so the label travels with the amount on both the list and the detail.
 */
export function valueLabel(type: ApprovalType): string {
	switch (type) {
		case "PRODUCT_CREATE":
		case "PRICE_CHANGE":
			return "Proposed price"
		case "CREDIT_LIMIT_CHANGE":
			return "Proposed limit"
		case "STOCK_WRITE_OFF":
			return "Frozen value"
		case "SHIFT_VARIANCE_REVIEW":
			return "Variance"
		case "REFUND":
			return "Refund value"
		default:
			return "Goods value"
	}
}

/** `GHS 1,240.00`, or `—` when the type is not valued. */
export function amountText(amountMinor: number | null): string {
	return amountMinor === null ? "—" : formatGhs(amountMinor)
}

/** A variance is signed: `+GHS 12.00` over, `−GHS 12.00` short. */
export function signedAmountText(amountMinor: number): string {
	const sign = amountMinor > 0 ? "+" : amountMinor < 0 ? "−" : ""
	return `${sign}${formatGhs(Math.abs(amountMinor))}`
}

/** `10%` — the band the price request was judged against. */
export function bandLabel(percent: number): string {
	return `${formatCount(percent)}%`
}

export function ageWords(requestedAt: string): string {
	return formatRelative(requestedAt)
}

/** A list row has no loaded subject, so its summary is built from the list payload. */
export function subjectSummary(row: ApprovalListRow): string {
	const lines = readNumber(row.payload, "lineCount")
	const number = readText(row.payload, "number")

	switch (row.subjectKind) {
		case "product":
			return proposalName(row.payload)
		case "stock_write_off":
			return number
				? `${number}${lines === null ? "" : ` · ${formatCount(lines)} ${lines === 1 ? "line" : "lines"}`}`
				: typeLabel(row.type)
		case "transfer":
			return lines === null
				? typeLabel(row.type)
				: `Transfer of ${formatCount(lines)} ${lines === 1 ? "line" : "lines"}`
		case "refund": {
			const receipt = readText(row.payload, "receiptNumber")
			if (number && receipt) return `${number} · Receipt ${receipt}`
			return number ?? receipt ?? typeLabel(row.type)
		}
		default:
			return typeLabel(row.type)
	}
}

/** A `PRODUCT_CREATE` subject is the API's validated submission body; read it defensively. */
export function proposalText(proposal: unknown, key: string): string | null {
	if (typeof proposal !== "object" || proposal === null) return null
	const value = (proposal as Record<string, unknown>)[key]
	return typeof value === "string" && value.trim().length > 0 ? value : null
}

export function proposalName(proposal: unknown): string {
	return proposalText(proposal, "name") ?? "Untitled proposal"
}

export function proposalMinor(proposal: unknown, key: string): number | null {
	if (typeof proposal !== "object" || proposal === null) return null
	const value = (proposal as Record<string, unknown>)[key]
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

function readText(source: Record<string, unknown>, key: string): string | null {
	const value = source[key]
	return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key]
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

/** The subject's kind, for a detail page that must render one renderer per arm. */
export function subjectKindLabel(subject: ApprovalSubject): string {
	switch (subject.kind) {
		case "purchase_order":
			return "Purchase order"
		case "product":
			return "Product submission"
		case "transfer":
			return "Transfer request"
		case "stock_write_off":
			return "Stock write-off"
		case "price_change":
			return "Price change"
		case "credit_limit_change":
			return "Credit limit change"
		case "shift_variance":
			return "Shift variance review"
		case "refund":
			return "Refund"
		default:
			return "Request"
	}
}

/**
 * The whole inbox lives in the URL: type, status, sort, branch and page.
 *
 * `.catch()` rather than `.default()` on every filter: a hand-edited or truncated link renders
 * the page with a sane fallback, never an error boundary. The API validates again.
 */
export const approvalSearchSchema = z.object({
	type: z.enum(APPROVAL_TYPES).optional().catch(undefined),
	/**
	 * `ALL` is a URL value, not an API one: the default queue is pending, so "all statuses"
	 * needs a value that survives `stripSearchParams`.
	 */
	status: z
		.enum([...APPROVAL_STATUSES, "ALL"])
		.optional()
		.catch(undefined),
	sort: z.enum(["oldest", "newest"]).optional().catch(undefined),
	/** `ALL` is the explicit "every branch" choice; absence follows the shell's branch. */
	branchId: z
		.union([z.uuid(), z.literal("ALL")])
		.optional()
		.catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
})

export type ApprovalSearch = z.infer<typeof approvalSearchSchema>

/** Values `stripSearchParams` removes so the default inbox is a clean URL. */
export const approvalSearchDefaults = { status: "PENDING", sort: "oldest" } as const

/** The reason list the reject dialog offers, in the API's order. */
export const APPROVAL_REASON_OPTIONS = APPROVAL_REASON_CODES
