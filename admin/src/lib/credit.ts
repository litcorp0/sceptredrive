import type {
	CreditEntryKind,
	CreditMethod,
	CreditOverrideReason,
	CreditReasonCode,
} from "#/lib/api-types"
import { formatGhs } from "#/lib/format"

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

/** "+GHS 50.00" for charges, "−GHS 15.00" for collections and credits. */
export function signedGhs(amountMinor: number): string {
	const sign = amountMinor > 0 ? "+" : amountMinor < 0 ? "−" : ""
	return `${sign}${formatGhs(Math.abs(amountMinor))}`
}
