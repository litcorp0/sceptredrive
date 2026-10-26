import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	ReturnableReceipt,
	ReturnCreateInput,
	ReturnDetail,
	ReturnListQuery,
	ReturnListResult,
} from "../types"
import { returnKeys } from "./keys"

/** `GET /api/procurement/returns` — branch-scoped by the API. */
export function listReturns(query: ReturnListQuery = {}) {
	return apiRequest<ReturnListResult>("/api/procurement/returns", { query })
}

export function returnListOptions(query: ReturnListQuery = {}) {
	return queryOptions({
		queryKey: returnKeys.list(query),
		queryFn: () => listReturns(query),
	})
}

export function getReturn(id: string) {
	return apiRequest<ReturnDetail>(`/api/procurement/returns/${id}`)
}

export function returnDetailOptions(id: string) {
	return queryOptions({
		queryKey: returnKeys.byId(id),
		queryFn: () => getReturn(id),
	})
}

/**
 * The return dialog's read: one receipt and how much of each line is still
 * returnable. The server sums POSTED returns only, so a cancelled draft does not
 * consume the cap.
 */
export function getReturnableReceipt(receiptId: string) {
	return apiRequest<ReturnableReceipt>(`/api/procurement/receipts/${receiptId}/returnable`)
}

export function returnableReceiptOptions(receiptId: string) {
	return queryOptions({
		queryKey: returnKeys.returnable(receiptId),
		queryFn: () => getReturnableReceipt(receiptId),
	})
}

/** Creates a DRAFT: nothing moves and no credit note exists until `postReturn`. */
export function createReturn(input: ReturnCreateInput) {
	return apiRequest<ReturnDetail>("/api/procurement/returns", { method: "POST", body: input })
}

/** Posts the stock movement and the credit note in one server transaction. */
export function postReturn(id: string) {
	return apiRequest<ReturnDetail>(`/api/procurement/returns/${id}/post`, { method: "POST" })
}

export function cancelReturn(id: string, reason: string) {
	return apiRequest<ReturnDetail>(`/api/procurement/returns/${id}/cancel`, {
		method: "POST",
		body: { reason },
	})
}
