import type { LoyaltyEntryKind, LoyaltyReasonCode, LoyaltyStaffKind } from "#/lib/api-types"

/** The liability headline looks 30 days ahead, matching the API window. */
export const EXPIRING_SOON_DAYS = 30

export const LOYALTY_KIND_LABELS: Record<LoyaltyEntryKind, string> = {
	EARN: "Earn",
	REDEEM: "Redeem",
	CLAWBACK: "Clawback",
	ADJUST: "Adjust",
	EXPIRE: "Expire",
}

export const LOYALTY_KIND_TONES: Record<
	LoyaltyEntryKind,
	"amber" | "green" | "blue" | "zinc" | "red"
> = {
	EARN: "green",
	REDEEM: "blue",
	CLAWBACK: "amber",
	ADJUST: "zinc",
	EXPIRE: "red",
}

export const LOYALTY_STAFF_KIND_LABELS: Record<LoyaltyStaffKind, string> = {
	EARN: "Earn",
	REDEEM: "Redeem",
	CLAWBACK: "Clawback",
	ADJUST: "Adjust",
}

export const LOYALTY_REASON_LABELS: Record<LoyaltyReasonCode, string> = {
	EXPIRY: "Expiry",
	RETURN: "Return",
	CORRECTION: "Correction",
	GOODWILL: "Goodwill",
	OTHER: "Other",
}

/** Point values the ADJUST dialog offers (the API accepts exactly these). */
export const LOYALTY_ADJUST_REASONS: LoyaltyReasonCode[] = ["GOODWILL", "CORRECTION", "OTHER"]

/** "+120" / "−400" points, for ledgers and toasts. */
export function signedPoints(points: number): string {
	const sign = points > 0 ? "+" : points < 0 ? "−" : ""
	return `${sign}${Math.abs(points).toLocaleString("en-GH")}`
}

/** Whole days from now until an ISO date; negative once it has passed. */
export function daysUntil(dateIso: string, now: Date = new Date()): number {
	return Math.ceil((new Date(dateIso).getTime() - now.getTime()) / 86_400_000)
}

/** True when an expiry falls inside the "expiring soon" window. */
export function isExpiringSoon(dateIso: string, now: Date = new Date()): boolean {
	const days = daysUntil(dateIso, now)
	return days >= 0 && days <= EXPIRING_SOON_DAYS
}

/**
 * Redemption value in pesewas for a point count, mirroring the server's
 * `quoteRedeem` floor maths. Display-only: the server's quote is authoritative.
 */
export function impliedValueMinor(points: number, pointsPerCedi: number): number {
	if (pointsPerCedi <= 0) return 0
	return Math.floor((points * 100) / pointsPerCedi)
}
