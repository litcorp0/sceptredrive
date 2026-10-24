import type { CountListQuery, ReceiptListQuery, StockListQuery, TransferListQuery } from "../types"

/**
 * Every key the inventory module owns.
 *
 * The roots are spelled exactly as they were before Phase 8 — `["inventory-stock"]`,
 * `["inventory-movements"]`, `["inventory-receipts"]`, `["inventory-receipt"]`,
 * `["inventory-thresholds"]`, `["transfers"]`, `["transfer"]`, `["counts"]` and `["count"]` —
 * because every dialog invalidates them by prefix from several places. A renamed root would still
 * typecheck and still render, but the stock ledger would stop refreshing after a posting, which is
 * the one thing these screens exist to show.
 *
 * `["receipt-invoice"]` is not here any more: the linked-invoice read is payables' data and moved
 * to `#/modules/payables` in Plan 11.
 */
export const inventoryKeys = {
	stock: ["inventory-stock"] as const,
	movements: ["inventory-movements"] as const,
	receipts: ["inventory-receipts"] as const,
	receipt: ["inventory-receipt"] as const,
	thresholds: ["inventory-thresholds"] as const,

	stockList: (query: StockListQuery) => [...inventoryKeys.stock, "list", query] as const,
	stockDetail: (productId: string, branchId: string | null) =>
		[...inventoryKeys.stock, "detail", productId, branchId] as const,
	movementList: (query: { productId: string; branchId: string | null; offset: number }) =>
		[...inventoryKeys.movements, query] as const,
	receiptList: (query: ReceiptListQuery) => [...inventoryKeys.receipts, query] as const,
	receiptDetail: (id: string) => [...inventoryKeys.receipt, id] as const,
}

export const transferKeys = {
	all: ["transfers"] as const,
	list: (query: TransferListQuery) => [...transferKeys.all, query] as const,
	detail: (id: string) => ["transfer", id] as const,
}

export const countKeys = {
	all: ["counts"] as const,
	list: (query: CountListQuery) => [...countKeys.all, query] as const,
	detail: (id: string) => ["count", id] as const,
}
