import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	Barcode,
	PriceOverride,
	Product,
	ProductCreateInput,
	ProductDetail,
	ProductListQuery,
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
		queryFn: () =>
			apiRequest<{ basePriceMinor: number; overrides: PriceOverride[] }>(
				`/api/products/${id}/prices`,
			),
	})
}

export function setProductPrice(id: string, input: { branchId: string; priceMinor: number }) {
	return apiRequest<{ override: PriceOverride }>(`/api/products/${id}/prices`, {
		method: "PUT",
		body: input,
	})
}

export function removeProductPrice(id: string, branchId: string) {
	return apiRequest<{ removed: true }>(`/api/products/${id}/prices/${branchId}`, {
		method: "DELETE",
	})
}
