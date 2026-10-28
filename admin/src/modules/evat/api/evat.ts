import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	EvatHealth,
	EvatListQuery,
	EvatSubmissionPage,
	EvatSubmissionView,
	EvatSummary,
} from "../types"
import { evatKeys } from "./keys"

/** `GET /api/evat/submissions` — one page of submissions, filtered by the screen. */
export function listEvatSubmissions(query: EvatListQuery = {}) {
	return apiRequest<EvatSubmissionPage>("/api/evat/submissions", { query })
}

export function evatListOptions(filters: EvatListQuery) {
	return queryOptions({
		queryKey: evatKeys.list(filters),
		queryFn: () => listEvatSubmissions(filters),
	})
}

export function getEvatSubmission(id: string) {
	return apiRequest<EvatSubmissionView>(`/api/evat/submissions/${id}`)
}

export function evatDetailOptions(submissionId: string) {
	return queryOptions({
		queryKey: evatKeys.detail(submissionId),
		queryFn: () => getEvatSubmission(submissionId),
	})
}

/**
 * `GET /api/evat/summary` — counts for the signed-in scope. The API resolves the branch; the
 * console never adds up a page of rows to invent a total.
 */
export function getEvatSummary() {
	return apiRequest<EvatSummary>("/api/evat/summary")
}

export function evatSummaryOptions() {
	return queryOptions({
		queryKey: evatKeys.summary,
		queryFn: getEvatSummary,
		staleTime: 30_000,
	})
}

/** The provider probe is cached for a minute server-side; asking again is cheap and bounded. */
export function getEvatHealth() {
	return apiRequest<{ health: EvatHealth }>("/api/evat/health")
}

export function evatHealthOptions() {
	return queryOptions({
		queryKey: evatKeys.health,
		queryFn: getEvatHealth,
		staleTime: 60_000,
	})
}

/** `POST /api/evat/submissions/:id/retry` — admin-only through `evat.retry`. */
export function retryEvatSubmission(id: string) {
	return apiRequest<{ submission: EvatSubmissionView }>(`/api/evat/submissions/${id}/retry`, {
		method: "POST",
	})
}
