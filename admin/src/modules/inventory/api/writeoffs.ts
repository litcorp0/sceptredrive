import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	WriteOffCreateInput,
	WriteOffDetail,
	WriteOffListQuery,
	WriteOffListResult,
} from "../types"
import { writeOffKeys } from "./keys"

/**
 * `GET /api/write-offs` — the branch's write-off documents.
 *
 * The list is branch-scoped by the API. The console passes the caller's filter and never narrows
 * afterwards: a manager asking for another branch is refused, not shown an empty table.
 */
export function listWriteOffs(query: WriteOffListQuery = {}) {
	return apiRequest<WriteOffListResult>("/api/write-offs", { query })
}

export function writeOffListOptions(query: WriteOffListQuery = {}) {
	return queryOptions({
		queryKey: writeOffKeys.list(query),
		queryFn: () => listWriteOffs(query),
	})
}

/** `GET /api/write-offs/:id` — the document's lines at their frozen cost, for a decider. */
export function getWriteOff(id: string) {
	return apiRequest<WriteOffDetail>(`/api/write-offs/${id}`)
}

export function writeOffDetailOptions(id: string) {
	return queryOptions({
		queryKey: writeOffKeys.detail(id),
		queryFn: () => getWriteOff(id),
	})
}

/**
 * `POST /api/write-offs` — raises a complete document at the caller's branch.
 *
 * There is no branch or status in the body: the server takes the branch from the session and
 * always writes `PENDING_APPROVAL`. The frozen value is computed from the branch's own average
 * cost, never from a client figure.
 */
export function createWriteOff(input: WriteOffCreateInput) {
	return apiRequest<WriteOffDetail>("/api/write-offs", { method: "POST", body: input })
}

/** `POST /api/write-offs/:id/cancel` — the requester withdraws a pending document. */
export function cancelWriteOff(id: string) {
	return apiRequest<{ ok: true }>(`/api/write-offs/${id}/cancel`, { method: "POST" })
}
