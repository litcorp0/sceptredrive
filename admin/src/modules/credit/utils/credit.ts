import { z } from "zod"
import { formatGhs } from "#/lib/format"
import type {
	AgingBucketKey,
	CreditEntryKind,
	CreditMethod,
	CreditOverrideReason,
	CreditReasonCode,
} from "../types"

export const CREDIT_KIND_LABELS: Record<CreditEntryKind, string> = {
	CHARGE: "Charge",
	REPAYMENT: "Repayment",
	REFUND: "Refund",
	ADJUSTMENT: "Adjustment",
}

export const CREDIT_KIND_TONES: Record<CreditEntryKind, "amber" | "green" | "blue" | "zinc"> = {
	CHARGE: "amber",
	REPAYMENT: "green",
	REFUND: "blue",
	ADJUSTMENT: "zinc",
}

export const CREDIT_METHOD_LABELS: Record<CreditMethod, string> = {
	CASH: "Cash",
	MOMO: "MoMo",
	BANK: "Bank",
}

export const CREDIT_REASON_LABELS: Record<CreditReasonCode, string> = {
	SALE: "Sale",
	OPENING_BALANCE: "Opening balance",
	CORRECTION: "Correction",
	WRITE_OFF: "Write-off",
	DISPUTE: "Dispute",
	RETURN: "Return",
	OTHER: "Other",
}

export const CREDIT_OVERRIDE_LABELS: Record<CreditOverrideReason, string> = {
	TEMPORARY_APPROVAL: "Temporary approval",
	TRUSTED_CUSTOMER: "Trusted customer",
	URGENT_NEED: "Urgent need",
	OTHER: "Other",
}

/** Fixed oldest-first order of the aging buckets. */
export const AGING_BUCKET_KEYS: AgingBucketKey[] = [
	"current",
	"days1To30",
	"days31To60",
	"days61To90",
	"over90",
]

/** Compact column headers for the aging report. */
export const AGING_BUCKET_SHORT: Record<AgingBucketKey, string> = {
	current: "Current",
	days1To30: "1–30",
	days31To60: "31–60",
	days61To90: "61–90",
	over90: "90+",
}

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
	current: "Current (not yet due)",
	days1To30: "1–30 days past due",
	days31To60: "31–60 days past due",
	days61To90: "61–90 days past due",
	over90: "Over 90 days past due",
}

/** "+GHS 50.00" for charges, "−GHS 15.00" for collections and credits. */
export function signedGhs(amountMinor: number): string {
	const sign = amountMinor > 0 ? "+" : amountMinor < 0 ? "−" : ""
	return `${sign}${formatGhs(Math.abs(amountMinor))}`
}

/**
 * The over-limit list's filters live in the URL, so the operations card can link the queue it
 * counted. `branchId` is an admin's filter; a manager's scope is decided by the server.
 */
export const overLimitSearchSchema = z.object({
	branchId: z.uuid().optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
})

export type OverLimitSearch = z.infer<typeof overLimitSearchSchema>

export const overLimitSearchDefaults = {} as const
