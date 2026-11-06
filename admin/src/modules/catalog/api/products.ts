import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	Barcode,
	PriceWriteResult,
	Product,
	ProductCreateInput,
	ProductDetail,
	ProductListQuery,
	ProductPriceList,
	ProductRow,
	ProductUpdateInput,
	ProductWithBarcodes,
} from "../types"
import { catalogKeys } from "./keys"

/** `GET /api/products` — the trigram search list, priced for `branchId` when one is given. */
export function productListOptions(query: ProductListQuery = {}) {
	return queryOptions({
		queryKey: catalogKeys.productList(query),
		queryFn: () => listProducts(query),
	})
}

/** The bare fetcher, for callers that own their own key (the shared product picker today). */
export function listProducts(query: ProductListQuery = {}) {
	return apiRequest<{ products: Product[]; total: number; branchId: string | null }>(
		"/api/products",
		{
			query,
		},
	)
}

/** `GET /api/products/:id` — barcodes and branch overrides included. */
export function getProduct(id: string) {
	return apiRequest<{ product: ProductDetail }>(`/api/products/${id}`)
}

export function productDetailOptions(id: string) {
	return queryOptions({
		queryKey: catalogKeys.productDetail(id),
		queryFn: () => getProduct(id),
		retry: false,
	})
}

/** The product picker's eight-row search. Kept as its own key so it never shares a list cache. */
export function productSearchOptions(query: string) {
	return queryOptions({
		queryKey: catalogKeys.productSearch(query),
		queryFn: () => listProducts({ q: query, limit: 8 }),
	})
}

export function suggestProductSku() {
	return apiRequest<{ sku: string }>("/api/products/suggest-sku")
}

/** The internal code the next product without a barcode will receive (P20-D11). */
export function suggestProductBarcode() {
	return apiRequest<{ barcode: string }>("/api/products/suggest-barcode")
}

/**
 * The peek as a query. Deliberately not keyed by product: the sequence moves only when
 * a product is created, and `catalogKeys.products` invalidation covers that.
 */
export function suggestBarcodeOptions() {
	return queryOptions({
		queryKey: ["catalog", "suggest-barcode"] as const,
		queryFn: suggestProductBarcode,
		staleTime: 0,
	})
}

export function createProduct(input: ProductCreateInput) {
	return apiRequest<{ product: ProductWithBarcodes }>("/api/products", {
		method: "POST",
		body: input,
	})
}

export function updateProduct(id: string, input: ProductUpdateInput) {
	return apiRequest<{ product: ProductRow }>(`/api/products/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function archiveProduct(id: string) {
	return apiRequest<{ product: ProductRow }>(`/api/products/${id}/archive`, { method: "POST" })
}

export function reactivateProduct(id: string) {
	return apiRequest<{ product: ProductRow }>(`/api/products/${id}/reactivate`, { method: "POST" })
}

export function addProductBarcode(id: string, code: string) {
	return apiRequest<{ barcode: Barcode }>(`/api/products/${id}/barcodes`, {
		method: "POST",
		body: { code },
	})
}

export function removeProductBarcode(id: string, barcodeId: string) {
	return apiRequest<{ removed: true }>(`/api/products/${id}/barcodes/${barcodeId}`, {
		method: "DELETE",
	})
}

/** `GET /api/products/:id/prices` — the base price plus every branch override. */
export function productPricesOptions(id: string) {
	return queryOptions({
		queryKey: catalogKeys.productPrices(id),
		queryFn: () => apiRequest<ProductPriceList>(`/api/products/${id}/prices`),
	})
}

export function setProductPrice(id: string, input: { branchId: string; priceMinor: number }) {
	return apiRequest<PriceWriteResult>(`/api/products/${id}/prices`, {
		method: "PUT",
		body: input,
	})
}

export function removeProductPrice(id: string, branchId: string) {
	return apiRequest<PriceWriteResult>(`/api/products/${id}/prices/${branchId}`, {
		method: "DELETE",
	})
}
