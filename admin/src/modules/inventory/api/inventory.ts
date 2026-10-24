import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	AdjustmentCreateInput,
	InventoryReceipt,
	MovementRow,
	ReceiptCreateInput,
	ReceiptListQuery,
	StockDetail,
	StockListQuery,
	StockRow,
	StockThreshold,
	ThresholdInput,
} from "../types"
import { inventoryKeys } from "./keys"

/** `GET /api/inventory/stock` — the low-stock view is the same read with `lowStock: true`. */
export function stockListOptions(query: StockListQuery = {}) {
	return queryOptions({
		queryKey: inventoryKeys.stockList(query),
		queryFn: () =>
			query.lowStock
				? apiRequest<{ stock: StockRow[]; total: number; branchId: string }>(
						"/api/inventory/low-stock",
						{ query },
					)
				: apiRequest<{ stock: StockRow[]; total: number; branchId: string }>(
						"/api/inventory/stock",
						{ query },
					),
	})
}

export function stockDetailOptions(productId: string, branchId: string | null) {
	return queryOptions({
		queryKey: inventoryKeys.stockDetail(productId, branchId),
		queryFn: () =>
			apiRequest<{ stock: StockDetail }>(`/api/inventory/stock/${productId}`, {
				query: branchId ? { branchId } : {},
			}),
	})
}

/** `GET /api/inventory/movements` — newest first, paged in the page's `offset`/`limit`. */
export function movementListOptions(
	productId: string,
	branchId: string | null,
	offset: number,
	limit: number,
) {
	return queryOptions({
		queryKey: inventoryKeys.movementList({ productId, branchId, offset }),
		queryFn: () =>
			apiRequest<{ movements: MovementRow[]; total: number; branchId: string | null }>(
				"/api/inventory/movements",
				{ query: { productId, branchId: branchId ?? undefined, limit, offset } },
			),
	})
}

export function listReceipts(query: ReceiptListQuery = {}) {
	return apiRequest<{ receipts: InventoryReceipt[]; total: number; branchId: string | null }>(
		"/api/inventory/receipts",
		{ query },
	)
}

export function receiptListOptions(query: ReceiptListQuery = {}) {
	return queryOptions({
		queryKey: inventoryKeys.receiptList(query),
		queryFn: () => listReceipts(query),
	})
}

export function getReceipt(id: string) {
	return apiRequest<{ receipt: InventoryReceipt }>(`/api/inventory/receipts/${id}`)
}

export function receiptDetailOptions(id: string) {
	return queryOptions({
		queryKey: inventoryKeys.receiptDetail(id),
		queryFn: () => getReceipt(id),
	})
}

export function createReceipt(input: ReceiptCreateInput) {
	return apiRequest<{ receipt: InventoryReceipt }>("/api/inventory/receipts", {
		method: "POST",
		body: input,
	})
}

export function createAdjustment(input: AdjustmentCreateInput) {
	return apiRequest<{ movement: MovementRow; level: { quantityOnHand: number } }>(
		"/api/inventory/adjustments",
		{ method: "POST", body: input },
	)
}

export function thresholdListOptions(query: { branchId?: string } = {}) {
	return queryOptions({
		queryKey: [...inventoryKeys.thresholds, query] as const,
		queryFn: () =>
			apiRequest<{ thresholds: StockThreshold[]; branchId: string }>("/api/inventory/thresholds", {
				query,
			}),
	})
}

export function setThreshold(input: ThresholdInput) {
	return apiRequest<{ threshold: StockThreshold }>("/api/inventory/thresholds", {
		method: "PUT",
		body: input,
	})
}

export function removeThreshold(productId: string, query: { branchId?: string } = {}) {
	return apiRequest<{ ok: true }>(`/api/inventory/thresholds/${productId}`, {
		method: "DELETE",
		query,
	})
}
