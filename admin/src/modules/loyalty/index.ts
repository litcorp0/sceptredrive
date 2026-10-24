/**
 * `loyalty` — one points balance per customer across branches, the append-only entry history, the
 * live point lots, staff adjustments, and the liability report.
 *
 * Migration note (Phase 8): the section lived in `components/customers/` (four files) and one
 * route (`_authenticated/loyalty.tsx`, 81 lines). The route now only routes; the page lives in
 * `pages/` (decisions D6, D9 — a move, not a rewrite).
 *
 * The API keys keep the pre-Phase-8 roots (`["loyalty-account"]`, `["loyalty-liability"]`) because
 * the adjust dialog invalidates both by prefix. Points stay integers and every formatted value
 * comes from `@sceptre/shared`; the expiry helpers are the `date-fns` calendar-day helpers moved
 * whole out of the old library module.
 */

export { loyaltyKeys } from "./api/keys"
export { accountOptions, createLoyaltyEntry, liabilityOptions } from "./api/loyalty"
export type {
	CustomerLoyaltySummary,
	LoyaltyAccount,
	LoyaltyAccountDetail,
	LoyaltyBranchActivity,
	LoyaltyEntry,
	LoyaltyEntryCreateInput,
	LoyaltyEntryKind,
	LoyaltyLiabilityQuery,
	LoyaltyLiabilityReport,
	LoyaltyLot,
	LoyaltyNegativeBalance,
	LoyaltyPostingResult,
	LoyaltyReasonCode,
	LoyaltyStaffKind,
	RedeemQuote,
} from "./types"
export {
	daysUntil,
	EXPIRING_SOON_DAYS,
	impliedValueMinor,
	isExpiringSoon,
	LOYALTY_ADJUST_REASONS,
	LOYALTY_KIND_LABELS,
	LOYALTY_KIND_TONES,
	LOYALTY_REASON_LABELS,
	LOYALTY_STAFF_KIND_LABELS,
	signedPoints,
} from "./utils/loyalty"
