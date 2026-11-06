import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type { SourceStockProduct, Transfer, TransferCreateInput, TransferListQuery } from "../types"
import { transferKeys } from "./keys"

export function transferListOptions(query: TransferListQuery = {}) {
	return queryOptions({
		queryKey: transferKeys.list(query),
		queryFn: () =>
			apiRequest<{ transfers: Transfer[]; total: number; branchId: string | null }>(
				"/api/transfers",
				{ query },
			),
	})
}

export function transferDetailOptions(id: string) {
	return queryOptions({
		queryKey: transferKeys.detail(id),
		queryFn: () => apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}`),
	})
}

export function createTransfer(input: TransferCreateInput) {
	return apiRequest<{ transfer: Transfer }>("/api/transfers", { method: "POST", body: input })
}

export function updateTransfer(id: string, input: { note?: string | null }) {
	return apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function replaceTransferLines(id: string, lines: TransferCreateInput["lines"]) {
	return apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/lines`, {
		method: "PUT",
		body: { lines },
	})
}

export function cancelTransfer(id: string) {
	return apiRequest<{ ok: true }>(`/api/transfers/${id}/cancel`, { method: "POST" })
}

export function dispatchTransfer(
	id: string,
	lines: { productId: string; quantityDispatched: number }[],
) {
	return apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/dispatch`, {
		method: "POST",
		body: { lines },
	})
}

export function receiveTransfer(
	id: string,
	lines: { productId: string; quantityReceived: number }[],
) {
	return apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/receive`, {
		method: "POST",
		body: { lines },
	})
}

export function shortCloseTransfer(id: string, note: string) {
	return apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/short-close`, {
		method: "POST",
		body: { note },
	})
}

/**
 * What one branch can give, for the transfer line picker (P20-D18).
 *
 * Cross-branch by design: the form exists to ask another branch for stock, so the picker
 * has to know whether that branch can fill the request.
 */
export function sourceStockOptions(branchId: string | undefined, q: string, includeEmpty: boolean) {
	return queryOptions({
		queryKey: [
			...transferKeys.all,
			"source-stock",
			branchId ?? "none",
			q,
			includeEmpty ? "all" : "in-stock",
		] as const,
		queryFn: () =>
			apiRequest<{ products: SourceStockProduct[] }>("/api/inventory/transfers/source-stock", {
				query: { branchId, q, includeEmpty: includeEmpty ? "true" : "false" },
			}),
		enabled: Boolean(branchId) && q.length > 0,
	})
}
