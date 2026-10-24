import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	LoyaltyAccountDetail,
	LoyaltyEntryCreateInput,
	LoyaltyLiabilityQuery,
	LoyaltyLiabilityReport,
	LoyaltyPostingResult,
} from "../types"
import { loyaltyKeys } from "./keys"

/**
 * `GET /api/loyalty/accounts/:customerId` — the global balance, its live lots (oldest first) and
 * the entry history in one read.
 */
export function accountOptions(customerId: string) {
	return queryOptions({
		queryKey: loyaltyKeys.account(customerId),
		queryFn: () => apiRequest<LoyaltyAccountDetail>(`/api/loyalty/accounts/${customerId}`),
	})
}

/**
 * `GET /api/loyalty/liability` — outstanding points and their value, activity per branch for the
 * range, and the balances below zero.
 *
 * Empty date inputs are normalised to `undefined` so the API sees no filter, exactly as the route
 * did before the move; the key keeps the raw inputs so a date change refetches.
 */
export function liabilityOptions(query: LoyaltyLiabilityQuery) {
	return queryOptions({
		queryKey: loyaltyKeys.liabilityReport(query),
		queryFn: () =>
			apiRequest<LoyaltyLiabilityReport>("/api/loyalty/liability", {
				query: {
					...query,
					from: query.from || undefined,
					to: query.to || undefined,
				},
			}),
	})
}

/** `POST /api/loyalty/entries` — a staff earn, redeem, clawback or adjustment. */
export function createLoyaltyEntry(input: LoyaltyEntryCreateInput) {
	return apiRequest<LoyaltyPostingResult>("/api/loyalty/entries", { method: "POST", body: input })
}
