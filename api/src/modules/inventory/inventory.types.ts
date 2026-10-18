import type { DbExecutor } from '@gikautos/db'
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
