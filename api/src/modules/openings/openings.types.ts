import type { OpeningStatus, OpeningTotals } from '@sceptre/shared'
import type { stockOpening, stockOpeningLine } from './openings.schema.ts'

export type OpeningRow = typeof stockOpening.$inferSelect
export type OpeningLineRow = typeof stockOpeningLine.$inferSelect

export type OpeningTaxCategory = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
export type OpeningLineStatus = 'NEW' | 'EXISTING'

/**
 * One CSV row as the console sends it. Money and quantity stay strings until the
 * service parses them, so no float ever touches a ledger value.
 */
export interface OpeningLineInput {
  lineNo?: number
  sku?: string
  barcode?: string
  name: string
  category: string
  unit: string
  brand?: string
  price: string
  cost: string
  quantity: string
  taxCategory?: OpeningTaxCategory
}

export interface OpeningPreviewRow {
  lineNo: number
  status: OpeningLineStatus
  productId: string | null
  sku: string | null
  name: string
  category: string
  categoryId: string | null
  /**
   * Segments of a category this line will create on save (P20-D21). Empty on every row
   * unless the operator asked for it, so the preview is where the decision is visible.
   */
  createsCategory: string[] | null
  unit: string
  uomId: string | null
  brand: string | null
  brandId: string | null
  barcode: string | null
  priceMinor: number | null
  taxCategory: OpeningTaxCategory
  costMinor: number
  quantity: number
  onHand: number
  delta: number
  countedValueMinor: number
  deltaValueMinor: number
  warnings: string[]
  errors: string[]
}

export interface OpeningPreview {
  branchId: string
  rows: OpeningPreviewRow[]
  lineCount: number
  totalUnits: number
  countedValueMinor: number
  deltaValueMinor: number
  newProductCount: number
  uncostedLineCount: number
  /** Deduped category paths the save would create, in tree order (P20-D21). */
  categoriesToCreate: string[][]
  canPost: boolean
}

export interface OpeningCreateInput {
  branchId: string
  /** Build the category paths this file names when they do not exist (P20-D21). */
  createMissingCategories?: boolean
  countedAt?: Date
  note?: string
  idempotencyKey?: string
  rows: OpeningLineInput[]
}

export interface OpeningPostInput {
  acknowledgeUncosted?: boolean
}

export interface OpeningListQuery {
  branchId?: string
  status?: OpeningStatus
  limit: number
  offset: number
}

export interface OpeningListFilters {
  branchId: string | null
  status?: OpeningStatus
  limit: number
  offset: number
}

export interface OpeningListRow {
  id: string
  number: string
  branchId: string
  branchCode: string
  branchName: string
  status: OpeningStatus
  countedAt: Date
  note: string | null
  lineCount: number
  newProductCount: number
  totalUnits: number
  countedValueMinor: number
  postedValueMinor: number
  uncostedLineCount: number
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  postedBy: string | null
  postedAt: Date | null
}

export interface OpeningLineDetail {
  id: string
  lineNo: number
  productId: string | null
  productSku: string | null
  productName: string | null
  isNew: boolean
  name: string
  categoryId: string | null
  unit: string | null
  uomId: string | null
  brandId: string | null
  barcode: string | null
  basePriceMinor: number | null
  taxCategory: OpeningTaxCategory | null
  quantity: number
  unitCostMinor: number
  onHandAtDraft: number
  deltaAtDraft: number
  warning: string | null
  movementId: string | null
}

export interface OpeningDetail {
  opening: OpeningListRow
  lines: OpeningLineDetail[]
}

export interface OpeningListResponse {
  openings: OpeningListRow[]
  total: number
  branchId: string | null
}

/** A product row resolved by SKU, barcode or name+category during preview. */
export interface OpeningMatchedProduct {
  id: string
  sku: string
  name: string
  categoryId: string
  uomId: string
  brandId: string | null
  basePriceMinor: number
  taxCategory: OpeningTaxCategory
  isActive: boolean
}

/** The branch's projection for a product, used for the review snapshot. */
export interface OpeningLevel {
  quantityOnHand: number
  avgCostMinor: number
}

export type OpeningTotalsSummary = OpeningTotals
