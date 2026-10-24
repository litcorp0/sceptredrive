/** The two fields the customer detail embeds for the profile's loyalty tab. */
export interface CustomerLoyaltySummary {
	accountId: string
	balancePoints: number
}

export type LoyaltyEntryKind = "EARN" | "REDEEM" | "CLAWBACK" | "ADJUST" | "EXPIRE"
export type LoyaltyStaffKind = Exclude<LoyaltyEntryKind, "EXPIRE">
export type LoyaltyReasonCode = "EXPIRY" | "RETURN" | "CORRECTION" | "GOODWILL" | "OTHER"

export interface LoyaltyLot {
	id: string
	accountId: string
	earnEntryId: string
	points: number
	remainingPoints: number
	expiresAt: string
	createdAt: string
}

export interface LoyaltyEntry {
	id: string
	accountId: string
	customerId: string
	branchId: string | null
	kind: LoyaltyEntryKind
	pointsDelta: number
	reasonCode: LoyaltyReasonCode | null
	note: string | null
	referenceType: string | null
	referenceId: string | null
	referenceNumber: string | null
	idempotencyKey: string | null
	createdBy: string | null
	occurredAt: string
	createdAt: string
}

export interface LoyaltyAccountDetail {
	accountId: string
	customerId: string
	balancePoints: number
	lots: LoyaltyLot[]
	entries: LoyaltyEntry[]
	entryTotal: number
}

export interface LoyaltyAccount {
	id: string
	customerId: string
	balancePoints: number
	createdAt: string
	updatedAt: string
}

export interface RedeemQuote {
	points: number
	discountMinor: number
}

export interface LoyaltyPostingResult {
	/** Null when an earn floors to zero points (nothing is written). */
	entry: LoyaltyEntry | null
	account: LoyaltyAccount
	lot: LoyaltyLot | null
	consumption: Array<{
		id: string
		lotId: string
		entryId: string
		points: number
		createdAt: string
	}>
	quote: RedeemQuote | null
}

export interface LoyaltyEntryCreateInput {
	customerId: string
	branchId?: string
	kind: LoyaltyStaffKind
	/** EARN only: the net amount paid, in minor units. */
	netPaidMinor?: number
	/** Signed for ADJUST; positive for REDEEM/CLAWBACK (the server stores the sign). */
	points?: number
	reasonCode?: LoyaltyReasonCode
	note?: string
	idempotencyKey?: string
}

export interface LoyaltyBranchActivity {
	branchId: string | null
	earnedPoints: number
	redeemedPoints: number
	clawedBackPoints: number
	adjustedPoints: number
	expiredPoints: number
	netPoints: number
}

export interface LoyaltyNegativeBalance {
	customerId: string
	customerName: string
	branchId: string | null
	balancePoints: number
}

export interface LoyaltyLiabilityReport {
	asOf: string
	pointsPerCedi: number
	outstandingPoints: number
	outstandingValueMinor: number
	/** Remaining live points that expire within the next 30 days. */
	expiringSoonPoints: number
	activity: {
		from: string | null
		to: string | null
		branchId: string | null
		rows: LoyaltyBranchActivity[]
	}
	negativeBalances: LoyaltyNegativeBalance[]
}

export type LoyaltyLiabilityQuery = {
	branchId?: string
	from?: string
	to?: string
}
