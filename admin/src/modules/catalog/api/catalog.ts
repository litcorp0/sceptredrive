import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	Brand,
	BrandCreateInput,
	BrandUpdateInput,
	CatalogListQuery,
	Category,
	CategoryCreateInput,
	CategoryTreeNode,
	CategoryUpdateInput,
	Uom,
	UomCreateInput,
	UomUpdateInput,
} from "../types"
import { catalogKeys } from "./keys"

/** `GET /api/categories` — top-level categories with their children. */
export function categoryListOptions(query: CatalogListQuery = {}) {
	return queryOptions({
		queryKey: catalogKeys.categoryList(query),
		queryFn: () => apiRequest<{ categories: CategoryTreeNode[] }>("/api/categories", { query }),
	})
}

export function createCategory(input: CategoryCreateInput) {
	return apiRequest<{ category: Category }>("/api/categories", { method: "POST", body: input })
}

export function updateCategory(id: string, input: CategoryUpdateInput) {
	return apiRequest<{ category: Category }>(`/api/categories/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function archiveCategory(id: string) {
	return apiRequest<{ category: Category }>(`/api/categories/${id}/archive`, { method: "POST" })
}

export function reactivateCategory(id: string) {
	return apiRequest<{ category: Category }>(`/api/categories/${id}/reactivate`, { method: "POST" })
}

/** `GET /api/brands` */
export function brandListOptions(query: CatalogListQuery = {}) {
	return queryOptions({
		queryKey: catalogKeys.brandList(query),
		queryFn: () => apiRequest<{ brands: Brand[] }>("/api/brands", { query }),
	})
}

export function createBrand(input: BrandCreateInput) {
	return apiRequest<{ brand: Brand }>("/api/brands", { method: "POST", body: input })
}

export function updateBrand(id: string, input: BrandUpdateInput) {
	return apiRequest<{ brand: Brand }>(`/api/brands/${id}`, { method: "PATCH", body: input })
}

export function archiveBrand(id: string) {
	return apiRequest<{ brand: Brand }>(`/api/brands/${id}/archive`, { method: "POST" })
}

export function reactivateBrand(id: string) {
	return apiRequest<{ brand: Brand }>(`/api/brands/${id}/reactivate`, { method: "POST" })
}

/** `GET /api/uoms` — the unit-of-measure table. */
export function unitListOptions(query: CatalogListQuery = {}) {
	return queryOptions({
		queryKey: catalogKeys.uomList(query),
		queryFn: () => apiRequest<{ uoms: Uom[] }>("/api/uoms", { query }),
	})
}

export function createUnit(input: UomCreateInput) {
	return apiRequest<{ uom: Uom }>("/api/uoms", { method: "POST", body: input })
}

export function updateUnit(id: string, input: UomUpdateInput) {
	return apiRequest<{ uom: Uom }>(`/api/uoms/${id}`, { method: "PATCH", body: input })
}

export function archiveUnit(id: string) {
	return apiRequest<{ uom: Uom }>(`/api/uoms/${id}/archive`, { method: "POST" })
}

export function reactivateUnit(id: string) {
	return apiRequest<{ uom: Uom }>(`/api/uoms/${id}/reactivate`, { method: "POST" })
}
