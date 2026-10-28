import type { ConflictResolutionCode, RefundReason } from "@sceptre/shared"
import {
	CONFLICT_RESOLUTION_LABELS,
	CONFLICT_SEVERITY_LABELS,
	CONFLICT_TYPE_LABELS,
	REFUND_REASON_LABELS,
} from "@sceptre/shared"
import type { StatusVariant } from "#/components/common/status-badge"
import { formatGhs } from "#/lib/format"
import type {
	ConflictStatus,
	RefundTenderStatus,
	ShiftReviewStatus,
	SyncConflictSeverity,
} from "../types"

/** Severity is a risk, not a lifecycle state: HIGH is the only danger tone. */
export function conflictSeverityTone(severity: SyncConflictSeverity): StatusVariant {
	switch (severity) {
		case "HIGH":
			return "danger"
		case "MEDIUM":
			return "warn"
		default:
			return "muted"
	}
}

export function severityLabel(severity: SyncConflictSeverity): string {
	return CONFLICT_SEVERITY_LABELS[severity]
}

export function conflictStatusLabel(status: ConflictStatus): string {
	switch (status) {
		case "OPEN":
			return "Open"
		case "RESOLVED":
			return "Resolved"
		default:
			return "Dismissed"
	}
}

export function conflictStatusTone(status: ConflictStatus): StatusVariant {
	switch (status) {
		case "OPEN":
			return "warn"
		case "RESOLVED":
			return "ok"
		default:
			return "muted"
	}
}

export function conflictTypeLabel(type: string): string {
	return CONFLICT_TYPE_LABELS[type] ?? type
}

export function resolutionLabel(code: ConflictResolutionCode | null): string {
	return code ? CONFLICT_RESOLUTION_LABELS[code] : "No code recorded"
}

export function refundReasonLabel(code: RefundReason): string {
	return REFUND_REASON_LABELS[code]
}

export function refundTenderStatusLabel(status: RefundTenderStatus): string {
	switch (status) {
		case "SETTLED":
			return "Settled"
		case "PENDING":
			return "Pending"
		case "FAILED":
			return "Failed"
		default:
			return "Needs attention"
	}
}

export function refundTenderStatusTone(status: RefundTenderStatus): StatusVariant {
	switch (status) {
		case "SETTLED":
			return "ok"
		case "PENDING":
			return "warn"
		default:
			return "danger"
	}
}

export function shiftStatusTone(status: "OPEN" | "CLOSED"): StatusVariant {
	return status === "OPEN" ? "info" : "muted"
}

export function reviewStatusLabel(status: ShiftReviewStatus): string {
	switch (status) {
		case "REQUIRED":
			return "Review required"
		case "REVIEWED":
			return "Reviewed"
		default:
			return "No review"
	}
}

export function reviewStatusTone(status: ShiftReviewStatus): StatusVariant {
	switch (status) {
		case "REQUIRED":
			return "warn"
		case "REVIEWED":
			return "ok"
		default:
			return "muted"
	}
}

/**
 * A drawer variance is a mismatch whenever it is not exactly zero. The sign says which
 * way it went; the tone says it needs a human.
 */
export function varianceTone(variance: number | null): StatusVariant {
	if (variance === null) return "muted"
	return variance === 0 ? "ok" : "danger"
}

/** Display only: the API's integer, with a leading plus when it is above zero. */
export function signedMoney(minorUnits: number): string {
	const text = formatGhs(minorUnits)
	return minorUnits > 0 ? `+${text}` : text
}

/** A GRA signature is printed in four groups; the payload already decides the bytes. */
export function signatureGroups(signature: string | null): string[] {
	const clean = signature?.trim() ?? ""
	if (clean.length === 0) return []
	const size = Math.ceil(clean.length / 4)
	return [0, 1, 2, 3]
		.map((index) => clean.slice(index * size, (index + 1) * size))
		.filter((group) => group.length > 0)
}

/** Render one `sync_conflict.details` value without inventing a format it does not carry. */
export function detailText(value: unknown): string {
	if (value === null || value === undefined) return "—"
	if (typeof value === "boolean") return value ? "Yes" : "No"
	if (typeof value === "string") return value.length > 0 ? value : "—"
	if (typeof value === "number") return String(value)
	return JSON.stringify(value)
}
