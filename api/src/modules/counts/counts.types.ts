import type { stockCount, stockCountLine, stockCountStatusEnum } from './counts.schema.ts'

export type StockCountStatus = (typeof stockCountStatusEnum.enumValues)[number]
export type StockCountRow = typeof stockCount.$inferSelect
export type StockCountLineRow = typeof stockCountLine.$inferSelect

export interface CountCreateInput {
  branchId: string
  categoryId?: string
  note?: string
}

export interface CountLinesUpdateInput {
  lines: { productId: string; countedQty: number | null }[]
}

export interface CountListQuery {
  branchId?: string
  status?: StockCountStatus
  limit: number
  offset: number
}

export interface CountListFilters {
  branchId: string | null
  status?: StockCountStatus | undefined
  limit: number
  offset: number
}

export interface CountListRow {
  id: string
  number: string
  branchId: string
  branchCode: string
  branchName: string
  categoryId: string | null
  status: StockCountStatus
  note: string | null
  createdBy: string | null
  postedBy: string | null
  postedAt: Date | null
  cancelledBy: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  lineCount: number
  countedCount: number
  varianceUnits: number
}

export interface CountLineDetail extends StockCountLineRow {
  sku: string
  productName: string
  variance: number | null
}

export interface CountDetail extends CountListRow {
  lines: CountLineDetail[]
}

export interface SnapshotRow {
  productId: string
  quantityOnHand: number
}

export interface CountPostSummary {
  postedLines: number
  shortageUnits: number
  overageUnits: number
  netUnits: number
  netValueMinor: number
}
