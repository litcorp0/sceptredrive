import type { CatalogListQuery, ProductListQuery } from "../types"

/**
 * Every key the catalog module owns.
 *
 * The roots are spelled exactly as they were before Phase 8 — `["categories"]`, `["brands"]`,
 * `["uoms"]`, `["products"]`, `["product"]` — because the dialogs, the product form and the price
 * override panel invalidate them by prefix from several places. `["product-prices"]` and
 * `["product-picker"]` moved here byte-identical with their single readers.
 */
export const catalogKeys = {
	categories: ["categories"] as const,
	categoryTree: ["categoryTree"] as const,
	brands: ["brands"] as const,
	uoms: ["uoms"] as const,
	products: ["products"] as const,
	product: ["product"] as const,

	categoryList: (query: CatalogListQuery) => [...catalogKeys.categories, query] as const,
	brandList: (query: CatalogListQuery) => [...catalogKeys.brands, query] as const,
	uomList: (query: CatalogListQuery) => [...catalogKeys.uoms, query] as const,
	productList: (query: ProductListQuery) => [...catalogKeys.products, query] as const,
	productDetail: (id: string) => [...catalogKeys.product, id] as const,
	productPrices: (productId: string) => ["product-prices", productId] as const,
	productSearch: (query: string) => ["product-picker", query] as const,
}
