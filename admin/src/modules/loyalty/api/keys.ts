import type { LoyaltyLiabilityQuery } from "../types"

/**
 * Every key the loyalty module owns.
 *
 * The roots are spelled exactly as they were before Phase 8 — `["loyalty-account"]` and
 * `["loyalty-liability"]` — because the adjust dialog invalidates the account by prefix and the
 * liability report by prefix. A renamed root would still typecheck and still render, but the
 * balance and the report would stop refreshing after a posting. There is no separate history
 * query: the account read returns the entries alongside the lots.
 */
export const loyaltyKeys = {
	accounts: ["loyalty-account"] as const,
	liability: ["loyalty-liability"] as const,

	account: (customerId: string) => [...loyaltyKeys.accounts, customerId] as const,
	liabilityReport: (query: LoyaltyLiabilityQuery) => [...loyaltyKeys.liability, query] as const,
}
