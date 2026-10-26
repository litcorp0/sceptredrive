import type { z } from 'zod'
import type { ApprovalSubject } from '../approvals/approvals.types.ts'
import type { barcode, product, productPrice } from './products.schema.ts'
import type {
  barcodeCreateSchema,
  priceChangePayloadSchema,
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

/** The stored proposal of a `PRICE_CHANGE` request (P12-D19). */
export type PriceChangePayload = z.infer<typeof priceChangePayloadSchema>
export type PriceChangeKind = PriceChangePayload['kind']

/**
 * What a price write did (P12-D19). One endpoint, two honest outcomes: the change
 * was inside the band (or the actor is an admin) and landed, or it became a
 * request that an admin decides. Never both, and never a silent third state.
 */
export type PriceWriteResult =
  | { status: 'APPLIED'; priceMinor: number }
  | { status: 'PENDING_APPROVAL'; approvalId: string }

/**
 * The two prices a band decision needs, read in one row: the product's base price
 * and this branch's override, plus the row id the write would target.
 */
export interface PriceContext {
  basePriceMinor: number
  overrideMinor: number | null
  overrideRowId: string | null
  isActive: boolean
}

/** The window a manager may set a price in, derived server-side (P12-D18). */
export interface PriceBandBounds {
  minMinor: number
  maxMinor: number
}

/** An override row with the band the console may show beside it. */
export interface ProductPriceBandRow extends ProductPriceRow {
  bounds: PriceBandBounds
}

/**
 * `GET /api/products/:id/prices`: the band travels with the rows so the console
 * warns before sending a request instead of re-deriving the server rule.
 */
export interface ProductPriceList {
  basePriceMinor: number
  managerBandPercent: number
  overrides: ProductPriceBandRow[]
}

/**
 * The `price_change` subject with the figures an approver needs. It is exactly the
 * shared arm, not a module-local widening: Plans 11 and 12 read the console from
 * `ApprovalSubject`, so a parallel interface would be a second contract to drift.
 */
export type PriceChangeSubject = Extract<ApprovalSubject, { kind: 'price_change' }>

export interface ProductCreateInput {
  sku?: string | undefined
  name: string
  description?: string | undefined
  categoryId: string
  brandId?: string | null | undefined
  uomId: string
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
  basePriceMinor?: number | undefined
  taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | undefined
}

export interface BarcodeCreateInput {
  code: string
}

export interface ProductListFilters {
  q?: string | undefined
  categoryIds?: string[] | undefined
  brandId?: string | undefined
  includeArchived: boolean
  branchId: string | null
  limit: number
  offset: number
}

export interface ProductListQueryRow {
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
  overrideMinor: number | null
  barcodeCount: number
  updatedAt: Date
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

export interface ProductWithBarcodes extends ProductRow {
  barcodes: BarcodeRow[]
}

export interface ProductDetail extends ProductRow {
  barcodes: BarcodeRow[]
  overrides: ProductPriceRow[]
}

/** A manager's product proposal: the payload an admin decides on (MGR-02). */
export interface ProductSubmissionBody {
  name: string
  categoryId: string
  uomId: string
  brandId?: string
  description?: string
  proposedBasePriceMinor: number
  barcode?: string
  supplierId?: string
  note?: string
}
