import type { z } from 'zod'
import type { barcode, product, productPrice } from './products.schema.ts'
import type {
  barcodeCreateSchema,
  priceOverrideSchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
} from './products.validation.ts'

export type ProductRow = typeof product.$inferSelect
export type BarcodeRow = typeof barcode.$inferSelect
export type ProductPriceRow = typeof productPrice.$inferSelect

export type ProductCreateBody = z.infer<typeof productCreateSchema>
export type ProductUpdateBody = z.infer<typeof productUpdateSchema>
export type ProductListQuery = z.infer<typeof productListQuerySchema>
export type BarcodeCreateBody = z.infer<typeof barcodeCreateSchema>
export type PriceOverrideBody = z.infer<typeof priceOverrideSchema>

export interface ProductCreateInput {
  sku?: string | undefined
  name: string
  description?: string | undefined
  categoryId: string
  brandId?: string | null | undefined
  uomId: string
  costPriceMinor?: number | undefined
  basePriceMinor: number
  taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | undefined
  barcodes?: string[] | undefined
}

export interface ProductUpdateInput {
  sku?: string | undefined
  name?: string | undefined
  description?: string | undefined
  categoryId?: string | undefined
  brandId?: string | null | undefined
  uomId?: string | undefined
  costPriceMinor?: number | undefined
  basePriceMinor?: number | undefined
  taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | undefined
}

export interface ProductListFilters {
  q?: string | undefined
  categoryId?: string | undefined
  brandId?: string | undefined
  includeArchived: boolean
  branchId: string | null
  limit: number
  offset: number
}

export interface ProductListRow {
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
  taxCategory: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
  isActive: boolean
  basePriceMinor: number
  effectivePriceMinor: number | null
  barcodeCount: number
  updatedAt: Date
}

export interface ProductDetail extends ProductRow {
  barcodes: BarcodeRow[]
  overrides: ProductPriceRow[]
}
