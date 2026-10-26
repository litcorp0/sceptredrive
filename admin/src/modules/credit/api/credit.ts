import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	AgingResult,
	CreditEntryCreateInput,
	CreditEntryListResult,
	CreditLimitRequestInput,
	CreditLimitRequestResult,
	CreditPostingResult,
	CreditProfile,
	CreditProfileListRow,
	CreditProfileUpdateInput,
	CreditStatement,
	OverLimitListResult,
	OverLimitQuery,
	RepaymentCreateInput,
} from "../types"
import { type CreditEntryFilters, creditKeys } from "./keys"

/** `GET /api/credit/aging` — fixed buckets from each charge's due date, as of one day. */
export function agingOptions(branchId: string | null, asOf: string) {
	return queryOptions({
		queryKey: creditKeys.agingReport(branchId, asOf),
		queryFn: () =>
			apiRequest<AgingResult>("/api/credit/aging", {
				query: { branchId: branchId ?? undefined, asOf: asOf || undefined },
			}),
	})
}

/** `GET /api/credit/statements/:customerId` — the printable statement payload. */
export function statementOptions(
	customerId: string,
	branchId: string | null,
	from: string,
	to: string,
) {
	return queryOptions({
		queryKey: creditKeys.statementFor(customerId, branchId, from, to),
		queryFn: () =>
			apiRequest<CreditStatement>(`/api/credit/statements/${customerId}`, {
				query: { branchId: branchId ?? undefined, from: from || undefined, to: to || undefined },
			}),
		enabled: branchId !== null,
	})
}

/** `GET /api/credit/profiles` — the customer's profile at every branch. */
export function profileListOptions(customerId: string) {
	return queryOptions({
		queryKey: creditKeys.profileList(customerId),
		queryFn: () =>
			apiRequest<{ profiles: CreditProfileListRow[] }>("/api/credit/profiles", {
				query: { customerId },
			}),
	})
}

export function updateCreditProfile(customerId: string, input: CreditProfileUpdateInput) {
	return apiRequest<{ profile: CreditProfile }>(`/api/credit/profiles/${customerId}`, {
		method: "PUT",
		body: input,
	})
}

/**
 * `POST /api/credit/profiles/:customerId/limit-requests` — a manager raises an increase.
 *
 * The body carries only the proposed limit and the reason; the branch and the current limit are
 * the server's. An admin is refused here (their direct path is the `PUT`), so the console never
 * offers the request to one.
 */
export function requestCreditLimitIncrease(customerId: string, input: CreditLimitRequestInput) {
	return apiRequest<CreditLimitRequestResult>(`/api/credit/profiles/${customerId}/limit-requests`, {
		method: "POST",
		body: input,
	})
}

/** `GET /api/credit/entries` — the ledger, newest first. */
export function entryListOptions(
	customerId: string,
	branchId: string | null,
	filters: CreditEntryFilters,
) {
	return queryOptions({
		queryKey: creditKeys.entryList(customerId, branchId, filters),
		queryFn: () =>
			apiRequest<CreditEntryListResult>("/api/credit/entries", {
				query: { customerId, branchId: branchId ?? undefined, ...filters },
			}),
		enabled: branchId !== null,
	})
}

export function createCreditEntry(input: CreditEntryCreateInput) {
	return apiRequest<CreditPostingResult>("/api/credit/entries", { method: "POST", body: input })
}

export function createRepayment(input: RepaymentCreateInput) {
	return apiRequest<CreditPostingResult>("/api/credit/repayments", {
		method: "POST",
		body: input,
	})
}

/** `GET /api/credit/over-limit` — customers whose ledger balance is above their limit. */
export function overLimitListOptions(query: OverLimitQuery = {}) {
	const limit = query.limit ?? 25
	const offset = query.offset ?? 0
	return queryOptions({
		queryKey: creditKeys.overLimitList(query.branchId ?? null, limit, offset),
		queryFn: () =>
			apiRequest<OverLimitListResult>("/api/credit/over-limit", {
				query: { branchId: query.branchId, limit, offset },
			}),
	})
}
