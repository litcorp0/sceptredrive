import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	ConflictDetail,
	ConflictList,
	ConflictListQuery,
	ConflictResolutionInput,
	OversightRefundDetail,
	OversightRefundsList,
	OversightRefundsQuery,
	OversightSaleDetail,
	OversightSalesList,
	OversightSalesQuery,
	OversightShiftDetail,
	OversightShiftsList,
	OversightShiftsQuery,
	ReceiptCopy,
} from "../types"
import { posKeys } from "./keys"

/**
 * The oversight reads. Every URL is the same three gates server-side (session, the
 * owning permission, per-user limiter); the console never filters a branch after the
 * fact and never turns a refusal into an empty list.
 */

export function salesOptions(query: OversightSalesQuery) {
	return queryOptions({
		queryKey: posKeys.sales(query),
		queryFn: () => apiRequest<OversightSalesList>("/api/pos/oversight/sales", { query }),
	})
}

export function saleOptions(id: string | null) {
	return queryOptions({
		queryKey: posKeys.sale(id ?? ""),
		queryFn: () => apiRequest<OversightSaleDetail>(`/api/pos/oversight/sales/${id}`),
		enabled: Boolean(id),
	})
}

/** The server-rendered copy: every figure comes from the sale's own columns. */
export function receiptOptions(id: string | null) {
	return queryOptions({
		queryKey: posKeys.receipt(id ?? ""),
		queryFn: () => apiRequest<ReceiptCopy>(`/api/pos/oversight/sales/${id}/receipt`),
		enabled: Boolean(id),
	})
}

export function refundsOptions(query: OversightRefundsQuery) {
	return queryOptions({
		queryKey: posKeys.refunds(query),
		queryFn: () => apiRequest<OversightRefundsList>("/api/pos/oversight/refunds", { query }),
	})
}

export function refundOptions(id: string | null) {
	return queryOptions({
		queryKey: posKeys.refund(id ?? ""),
		queryFn: () => apiRequest<OversightRefundDetail>(`/api/pos/oversight/refunds/${id}`),
		enabled: Boolean(id),
	})
}

export function shiftsOptions(query: OversightShiftsQuery) {
	return queryOptions({
		queryKey: posKeys.shifts(query),
		queryFn: () => apiRequest<OversightShiftsList>("/api/pos/oversight/shifts", { query }),
	})
}

export function shiftOptions(id: string | null) {
	return queryOptions({
		queryKey: posKeys.shift(id ?? ""),
		queryFn: () => apiRequest<OversightShiftDetail>(`/api/pos/oversight/shifts/${id}`),
		enabled: Boolean(id),
	})
}

export function conflictsOptions(query: ConflictListQuery) {
	return queryOptions({
		queryKey: posKeys.conflicts(query),
		queryFn: () => apiRequest<ConflictList>("/api/pos/oversight/conflicts", { query }),
	})
}

export function conflictOptions(id: string | null) {
	return queryOptions({
		queryKey: posKeys.conflict(id ?? ""),
		queryFn: () => apiRequest<ConflictDetail>(`/api/pos/oversight/conflicts/${id}`),
		enabled: Boolean(id),
	})
}

/**
 * The one write in this module. It records a decision; it never touches the sale,
 * the refund, the stock or the ledger (P14-D13).
 */
export function resolveConflict(id: string, input: ConflictResolutionInput) {
	return apiRequest<ConflictDetail>(`/api/pos/oversight/conflicts/${id}`, {
		method: "PATCH",
		body: input,
	})
}
