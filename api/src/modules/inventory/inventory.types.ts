import type { DbExecutor } from '@sceptre/db'
import type { z } from 'zod'
import type {
  stockAdjustmentReasonEnum,
  stockLevel,
  stockMovement,
  stockMovementReferenceEnum,
  stockMovementTypeEnum,
} from './inventory.schema.ts'
import type { stockReportQuerySchema } from './inventory.validation.ts'

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
  /** Required for inbound types (receipt, transfer-in). An outbound caller may pin it (a write-off posts the approved cost); otherwise the projection's average is used. */
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
  /** The purchase order this delivery fulfils (Phase 11); absent for a bare receipt. */
  purchaseOrderId?: string
  /** Replay guard for a console retry (P11-D20). */
  idempotencyKey?: string
  lines: ReceiptLineInput[]
}

export interface ReceiptLineInput {
  productId: string
  quantity: number
  unitCostMinor: number
  /** The ordered line this quantity satisfies. */
  purchaseOrderLineId?: string
  overReceiptReason?: 'SUPPLIER_SENT_MORE' | 'ORDER_ROUNDING' | 'SUBSTITUTE' | 'OTHER'
  overReceiptNote?: string
}

export interface ReceiptListQuery {
  branchId?: string
  /** The purchase order this delivery fulfils (Phase 11); a receipt list for one order. */
  purchaseOrderId?: string
  from?: Date
  to?: Date
  limit: number
  offset: number
}

export interface ReceiptListFilters {
  branchId: string | null
  purchaseOrderId?: string | undefined
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
  /** The purchase order this delivery fulfils; null for a manual receipt. */
  purchaseOrderId: string | null
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
  /** Opening stock: what the units on the shelf cost (17-05). */
  unitCostMinor?: number
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
  outOfStock?: boolean
}

export interface StockListFilters {
  /** `null` reads every branch (admin only); scoped callers always pass one. */
  branchId: string | null
  q?: string | undefined
  lowStock: boolean
  /** Only rows with nothing on hand (18-01). Mutually exclusive with lowStock in the UI. */
  outOfStock: boolean
  limit: number
  offset: number
}

export interface StockRow {
  productId: string
  sku: string
  productName: string
  categoryName: string
  /** The branch this level belongs to; an unscoped read spans branches. */
  branchId: string
  branchCode: string
  branchName: string
  quantityOnHand: number
  avgCostMinor: number
  valueMinor: number
  /** The effective threshold: the product's row, the branch default, or 5 (18-02). */
  threshold: number
  isLow: boolean
  /** True when this branch has never held the product, as opposed to holding none. */
  neverStocked: boolean
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
  /** Top-up level (P11-D3); omitted on a new row defaults to `2 × threshold`. */
  maxQuantity?: number | null
  /** A supplier's minimum order quantity: a floor on the suggestion. */
  minOrderQuantity?: number
}

export interface ThresholdRow {
  id: string
  productId: string
  sku: string
  productName: string
  branchId: string
  threshold: number
  maxQuantity: number | null
  minOrderQuantity: number
  updatedBy: string | null
  updatedAt: Date
}

// --- Stock report (Phase 14, RPT-04) -----------------------------------------

export type StockReportQuery = z.infer<typeof stockReportQuerySchema>

/** One product's level at one branch, valued at the projection's average cost. */
export interface StockReportRow {
  productId: string
  sku: string
  productName: string
  categoryName: string
  branchId: string
  branchCode: string
  branchName: string
  quantityOnHand: number
  avgCostMinor: number
  valueMinor: number
  threshold: number | null
  belowThreshold: boolean
}

export interface StockReportBranchRow {
  branchCode: string
  branchName: string
  quantityOnHand: number
  valueMinor: number
}

/**
 * The report is a snapshot plus a period (P14-D16): on-hand and value are the
 * `stock_level` projection **as read**, because a past-dated valuation would have to
 * replay the ledger's integer rounding and would disagree with the dashboard by a few
 * pesewas. Everything else is counted in `[from, to)` Accra days.
 */
export interface StockReport {
  /** The instant the projection was read. A stock figure without one is a rumour. */
  asOf: string
  period: { from: string; to: string }
  /** The resolved branch: the caller's own for a manager, `null` for all branches. */
  branchId: string | null
  rows: StockReportRow[]
  /** Matching rows before the 5 000-row cap, so a client can say what it is missing. */
  total: number
  truncated: boolean
  totals: { quantityOnHand: number; valueMinor: number; products: number }
  /** Populated for an admin only, following the analytics read model's precedent. */
  byBranch: StockReportBranchRow[]
  movements: {
    inflow: number
    outflow: number
    byType: Array<{ type: StockMovementType; quantity: number }>
  }
  transfers: { dispatched: number; received: number; shortClosed: number }
  counts: {
    completed: number
    countedLines: number
    matchedLines: number
    varianceValueMinor: number
  }
}
