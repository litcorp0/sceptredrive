export type TaxCategory = "STANDARD" | "ZERO_RATED" | "EXEMPT"
export type TaxMode = "INCLUSIVE" | "EXCLUSIVE"

export interface Category {
	id: string
	name: string
	parentId: string | null
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface CategoryTreeNode extends Category {
	children: Category[]
}

export interface Brand {
	id: string
	name: string
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Uom {
	id: string
	code: string
	name: string
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface ProductRow {
	id: string
	sku: string
	name: string
	description: string | null
	categoryId: string
	brandId: string | null
	uomId: string
	costPriceMinor: number
	basePriceMinor: number
	taxCategory: TaxCategory
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Barcode {
	id: string
	productId: string
	code: string
	createdBy: string | null
	createdAt: string
}

export interface PriceOverride {
	id: string
	productId: string
	branchId: string
	priceMinor: number
	updatedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface ProductWithBarcodes extends ProductRow {
	barcodes: Barcode[]
}

export interface ProductDetail extends ProductWithBarcodes {
	overrides: PriceOverride[]
}

export interface Product {
	id: string
	sku: string
	name: string
	categoryId: string
	categoryName: string
	brandId: string | null
	brandName: string | null
	uomId: string
	uomCode: string
	uomName: string
	taxCategory: TaxCategory
	isActive: boolean
	basePriceMinor: number
	effectivePriceMinor: number | null
	barcodeCount: number
	updatedAt: string
}

export interface CategoryCreateInput {
	name: string
	parentId?: string | null
}

export interface CategoryUpdateInput {
	name?: string
	parentId?: string | null
}

export interface BrandCreateInput {
	name: string
}

export interface BrandUpdateInput {
	name: string
}

export interface UomCreateInput {
	code: string
	name: string
}

export interface UomUpdateInput {
	name: string
}

export interface ProductCreateInput {
	sku?: string
	name: string
	description?: string
	categoryId: string
	brandId?: string | null
	uomId: string
	costPriceMinor?: number
	basePriceMinor: number
	taxCategory?: TaxCategory
	barcodes?: string[]
}

export interface ProductUpdateInput {
	sku?: string
	name?: string
	description?: string
	categoryId?: string
	brandId?: string | null
	uomId?: string
	costPriceMinor?: number
	basePriceMinor?: number
	taxCategory?: TaxCategory
}

export type CatalogListQuery = {
	includeArchived?: boolean
}

export type ProductListQuery = {
	q?: string
	categoryId?: string
	brandId?: string
	includeArchived?: boolean
	branchId?: string
	limit?: number
	offset?: number
}
