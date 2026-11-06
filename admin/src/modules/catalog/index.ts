/**
 * `catalog` — products, categories, brands and units, shared across every branch.
 *
 * Migration note (Phase 8): the catalog section was 1,216 route lines across eight files and seven
 * components under `components/catalog/`. The section layout is now a page (`CatalogLayout`) and
 * every route renders one page and nothing else (decisions D6, D9 — a move, not a rewrite).
 *
 * The API keys keep the pre-Phase-8 roots (`["categories"]`, `["brands"]`, `["uoms"]`,
 * `["products"]`, `["product"]`) because the dialogs and the price override panel invalidate them
 * by prefix from several places. Money stays integer minor units and formatting stays in
 * `lib/format`.
 */
export {
	archiveBrand,
	archiveCategory,
	archiveUnit,
	brandListOptions,
	categoryListOptions,
	createBrand,
	createCategory,
	createUnit,
	reactivateBrand,
	reactivateCategory,
	reactivateUnit,
	unitListOptions,
	updateBrand,
	updateCategory,
	updateUnit,
} from "./api/catalog"
export { catalogKeys } from "./api/keys"
export {
	addProductBarcode,
	archiveProduct,
	createProduct,
	getProduct,
	productDetailOptions,
	productListOptions,
	productPricesOptions,
	productSearchOptions,
	reactivateProduct,
	removeProductBarcode,
	removeProductPrice,
	setProductPrice,
	suggestProductBarcode,
	suggestProductSku,
	updateProduct,
} from "./api/products"
export { BrandsPage } from "./pages/brands-page"
export { CatalogLayout } from "./pages/catalog-layout"
export { CategoriesPage } from "./pages/categories-page"
export { ProductDetailPage } from "./pages/product-detail-page"
export { ProductNewPage } from "./pages/product-new-page"
export { ProductsPage } from "./pages/products-page"
export { UnitsPage } from "./pages/units-page"
export type {
	Barcode,
	Brand,
	BrandCreateInput,
	BrandUpdateInput,
	CatalogListQuery,
	Category,
	CategoryCreateInput,
	CategoryTreeNode,
	CategoryUpdateInput,
	PriceOverride,
	Product,
	ProductCreateInput,
	ProductDetail,
	ProductListQuery,
	ProductRow,
	ProductUpdateInput,
	ProductWithBarcodes,
	TaxCategory,
	TaxMode,
	Uom,
	UomCreateInput,
	UomUpdateInput,
} from "./types"
