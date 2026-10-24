import type { DbExecutor } from '@sceptre/db'
import type {
  stockAdjustmentReasonEnum,
  stockLevel,
  stockMovement,
  stockMovementReferenceEnum,
  stockMovementTypeEnum,
} from './inventory.schema.ts'

export type StockMovementType = (typeof stockMovementTypeEnum.enumValues)[number]
export type StockMovementReference = (typeof stockMovementReferenceEnum.enumValues)[number]
export type StockAdjustmentReason = (typeof stockAdjustmentReasonEnum.enumValues)[number]

export type StockMovementRow = typeof stockMovement.$inferSelect
export type StockLevelRow = typeof stockLevel.$inferSelect

export interface MovementInput {
  productId: string
  branchId: string
  type: StockMovementType
  quantityDelta: number
  /** Required for inbound types (receipt, transfer-in); ignored otherwise. */
  unitCostMinor?: number
  referenceType: StockMovementReference
  referenceId?: string | null
  referenceNumber?: string | null
  reasonCode?: StockAdjustmentReason | null
  note?: string | null
  /** Display label used in insufficient-stock errors; never persisted. */
  productName?: string
}

export interface PostMovementsOptions {
  executor?: DbExecutor
  /** Reserved for the Phase 6 POS oversell path; back-office callers never set it. */
  allowNegative?: boolean
}

export interface PostMovementsResult {
  movements: StockMovementRow[]
  levels: Map<string, StockLevelRow>
}

export interface BranchReconciliation {
  productId: string
  branchId: string
  quantityOnHand: number
  ledgerQuantity: number
}

export interface ReceiptLineInput {
  productId: string
  quantity: number
  unitCostMinor: number
}

export interface ReceiptCreateInput {
  branchId: string
  supplierId?: string
  supplierName?: string
  supplierInvoiceNumber?: string
  note?: string
  lines: ReceiptLineInput[]
}

export interface ReceiptListQuery {
  branchId?: string
  from?: Date
  to?: Date
  limit: number
  offset: number
}

export interface ReceiptListFilters {
  branchId: string | null
  from?: Date | undefined
  to?: Date | undefined
  limit: number
  offset: number
}

export interface ReceiptLineRow {
  id: string
  productId: string
  sku: string
  productName: string
  quantity: number
  unitCostMinor: number
  movementId: string
}

export interface StockReceiptRow {
  id: string
  number: string
  branchId: string
  branchCode: string
  branchName: string
  supplierId: string | null
  supplierName: string | null
  supplierInvoiceNumber: string | null
  note: string | null
  createdBy: string | null
  createdAt: Date
  lineCount: number
  totalCostMinor: number
}

export interface ReceiptDetail extends StockReceiptRow {
  lines: ReceiptLineRow[]
}

/** Permission-free receipt view for the payables service (service-to-service). */
export interface ReceiptForPayables {
  id: string
  number: string
  branchId: string
  supplierId: string | null
  supplierName: string | null
  supplierInvoiceNumber: string | null
  note: string | null
  lines: { productId: string; quantity: number; unitCostMinor: number }[]
}

export interface AdjustmentCreateInput {
  branchId: string
  productId: string
  quantityDelta: number
  reasonCode: StockAdjustmentReason
  note?: string
}

export interface MovementListQuery {
  branchId?: string
  productId?: string
  type?: StockMovementType
  from?: Date
  to?: Date
  limit: number
  offset: number
}

export interface MovementListFilters {
  branchId: string | null
  productId?: string | undefined
  type?: StockMovementType | undefined
  from?: Date | undefined
  to?: Date | undefined
  limit: number
  offset: number
}

export interface MovementHistoryRow extends StockMovementRow {
  sku: string
  productName: string
  branchCode: string
}

export interface StockListQuery {
  branchId?: string
  q?: string
  lowStock?: boolean
  limit: number
  offset: number
}

export interface StockListFilters {
  branchId: string
  q?: string | undefined
  lowStock: boolean
  limit: number
  offset: number
}

export interface StockRow {
  productId: string
  sku: string
  productName: string
  categoryName: string
  quantityOnHand: number
  avgCostMinor: number
  valueMinor: number
  threshold: number | null
  isLow: boolean
  updatedAt: Date
}

export interface StockDetail {
  productId: string
  sku: string
  productName: string
  categoryName: string
  taxCategory: string
  basePriceMinor: number
  costPriceMinor: number
  isActive: boolean
  quantityOnHand: number
  avgCostMinor: number
  valueMinor: number
  threshold: number | null
  updatedAt: Date | null
}

export interface ThresholdInput {
  branchId: string
  productId: string
  threshold: number
}

export interface ThresholdRow {
  id: string
  productId: string
  sku: string
  productName: string
  branchId: string
  threshold: number
  updatedBy: string | null
  updatedAt: Date
}
