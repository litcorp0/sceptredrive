import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	OpeningDetail,
	OpeningLineInput,
	OpeningListQuery,
	OpeningListResult,
	OpeningPreview,
} from "../types"
import { openingKeys } from "./keys"

/** `POST /api/openings/preview` — pure validation; nothing is written. */
export function previewOpening(branchId: string, rows: OpeningLineInput[]) {
	return apiRequest<OpeningPreview>("/api/openings/preview", {
		method: "POST",
		body: { branchId, rows },
	})
}

/** `POST /api/openings` — the manager's draft (or the admin's). */
export function createOpening(input: {
	branchId: string
	countedAt?: string
	note?: string
	idempotencyKey?: string
	rows: OpeningLineInput[]
}) {
	return apiRequest<OpeningDetail>("/api/openings", { method: "POST", body: input })
}

export function listOpenings(query: OpeningListQuery = {}) {
	return apiRequest<OpeningListResult>("/api/openings", { query })
}

export function openingListOptions(query: OpeningListQuery = {}) {
	return queryOptions({
		queryKey: openingKeys.list(query),
		queryFn: () => listOpenings(query),
	})
}

export function getOpening(id: string) {
	return apiRequest<OpeningDetail>(`/api/openings/${id}`)
}

export function openingDetailOptions(id: string) {
	return queryOptions({
		queryKey: openingKeys.detail(id),
		queryFn: () => getOpening(id),
	})
}

/** Admin only; the API enforces `inventory.opening.post`. */
export function postOpening(id: string, acknowledgeUncosted: boolean) {
	return apiRequest<OpeningDetail>(`/api/openings/${id}/post`, {
		method: "POST",
		body: { acknowledgeUncosted },
	})
}

/** Draft only; the API refuses a posted document. */
export function deleteOpening(id: string) {
	return apiRequest<{ ok: true }>(`/api/openings/${id}`, { method: "DELETE" })
}
