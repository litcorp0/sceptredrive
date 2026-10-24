import { formatCount } from "@sceptre/shared"
import { differenceInCalendarDays, isAfter } from "date-fns"
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
	return `${sign}${formatCount(Math.abs(points))}`
}

/**
 * Whole calendar days from now until an ISO date; negative once it has passed.
 *
 * Calendar days rather than millisecond division: a partial day or a clock change must not
 * flip an expiry by one, and "expires tomorrow" is a date question, not an hour question.
 */
export function daysUntil(dateIso: string, now: Date = new Date()): number {
	return differenceInCalendarDays(new Date(dateIso), now)
}

/** True when an expiry is still ahead and falls inside the "expiring soon" window. */
export function isExpiringSoon(dateIso: string, now: Date = new Date()): boolean {
	const expiry = new Date(dateIso)
	if (!isAfter(expiry, now)) return false
	return daysUntil(dateIso, now) <= EXPIRING_SOON_DAYS
}

/**
 * Redemption value in pesewas for a point count, mirroring the server's
 * `quoteRedeem` floor maths. Display-only: the server's quote is authoritative.
 */
export function impliedValueMinor(points: number, pointsPerCedi: number): number {
	if (pointsPerCedi <= 0) return 0
	return Math.floor((points * 100) / pointsPerCedi)
}
