import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	MatchableOrder,
	OrderCancelInput,
	OrderCloseInput,
	OrderCreateInput,
	OrderDetail,
	OrderFromSuggestionsInput,
	OrderListQuery,
	OrderListResult,
	OrderUpdateInput,
	ReceiveOrderInput,
	ReceiveOrderResult,
} from "../types"
import { orderKeys } from "./keys"

/** `GET /api/procurement/orders` — the list, branch-scoped by the API, never by the screen. */
export function listOrders(query: OrderListQuery) {
	return apiRequest<OrderListResult>("/api/procurement/orders", { query })
}

export function orderListOptions(query: OrderListQuery) {
	return queryOptions({
		queryKey: orderKeys.list(query),
		queryFn: () => listOrders(query),
	})
}

/** `GET /api/procurement/orders/:id` — lines, goods value, threshold, approval and `canApply`. */
export function getOrder(id: string) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}`)
}

export function orderDetailOptions(id: string) {
	return queryOptions({
		queryKey: orderKeys.byId(id),
		queryFn: () => getOrder(id),
	})
}

/** `GET /api/procurement/orders/matchable` — approved/sent orders for one supplier. */
export function listMatchableOrders(supplierId: string, branchId: string | null) {
	return apiRequest<{ orders: MatchableOrder[] }>("/api/procurement/orders/matchable", {
		query: { supplierId, branchId: branchId ?? undefined },
	})
}

export function matchableOrderOptions(supplierId: string | null, branchId: string | null) {
	return queryOptions({
		queryKey: orderKeys.matchable(supplierId ?? "", branchId),
		queryFn: () => listMatchableOrders(supplierId as string, branchId),
		enabled: Boolean(supplierId),
	})
}

/** The server computes the number, the goods value and the approval decision on submit. */
export function createOrder(input: OrderCreateInput) {
	return apiRequest<OrderDetail>("/api/procurement/orders", { method: "POST", body: input })
}

export function createOrderFromSuggestions(input: OrderFromSuggestionsInput) {
	return apiRequest<OrderDetail>("/api/procurement/orders/from-suggestions", {
		method: "POST",
		body: input,
	})
}

export function updateOrder(id: string, input: OrderUpdateInput) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function submitOrder(id: string) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}/submit`, { method: "POST" })
}

export function sendOrder(id: string) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}/send`, { method: "POST" })
}

/** The API requires a reason of at least three characters; the service audits it. */
export function cancelOrder(id: string, input: OrderCancelInput) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}/cancel`, {
		method: "POST",
		body: input,
	})
}

export function closeOrder(id: string, input: OrderCloseInput) {
	return apiRequest<OrderDetail>(`/api/procurement/orders/${id}/close`, {
		method: "POST",
		body: input,
	})
}

/**
 * `POST /api/procurement/orders/:id/receive`.
 *
 * The receipt, its stock movements and the supplier-product link are written in one server
 * transaction; the console sends the client idempotency key so a retry returns the first receipt
 * rather than receiving the goods twice.
 */
export function receiveOrder(id: string, input: ReceiveOrderInput) {
	return apiRequest<ReceiveOrderResult>(`/api/procurement/orders/${id}/receive`, {
		method: "POST",
		body: input,
	})
}
