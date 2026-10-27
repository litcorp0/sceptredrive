import type {
  abcClassEnum,
  countFrequencyEnum,
  countSchedule,
  countScopeEnum,
  countTriggerReasonEnum,
  stockAbcClass,
  stockCount,
  stockCountLine,
  stockCountStatusEnum,
} from './counts.schema.ts'

export type StockCountStatus = (typeof stockCountStatusEnum.enumValues)[number]
export type CountScope = (typeof countScopeEnum.enumValues)[number]
export type CountFrequency = (typeof countFrequencyEnum.enumValues)[number]
export type CountTriggerReason = (typeof countTriggerReasonEnum.enumValues)[number]
export type AbcClass = (typeof abcClassEnum.enumValues)[number]

export type StockCountRow = typeof stockCount.$inferSelect
export type StockCountLineRow = typeof stockCountLine.$inferSelect
export type CountScheduleRow = typeof countSchedule.$inferSelect
export type StockAbcClassRow = typeof stockAbcClass.$inferSelect

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
  from?: Date
  to?: Date
  limit: number
  offset: number
}

export interface CountListFilters {
  branchId: string | null
  status?: StockCountStatus | undefined
  /** Inclusive lower bound on `created_at`. */
  from?: Date | undefined
  /** Inclusive upper bound on `created_at`; the service widens a day boundary. */
  to?: Date | undefined
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
  countType: string
  scope: CountScope | null
  scopeKey: string | null
  dueAt: string | null
  assignedTo: string | null
  scheduleId: string | null
  triggerReason: CountTriggerReason | null
  triggerProductId: string | null
  triggerSourceId: string | null
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
  snapshotQty: number
}

export interface CountPostSummary {
  postedLines: number
  shortageUnits: number
  overageUnits: number
  netUnits: number
  netValueMinor: number
}

// --- Schedules (P12-D28) -----------------------------------------------------

/**
 * The scope target is split out of the transport shape so the service can
 * derive the one `scope_key`. A schedule cannot be half-configured: the caller
 * names a category, or a brand, or an ABC class, or nothing (rotation).
 */
export interface CountScheduleCreateInput {
  branchId?: string
  scope: CountScope
  categoryId?: string
  brandId?: string
  abcClass?: AbcClass
  frequency: CountFrequency
  firstDueAt?: string
  assignedTo?: string
}

export interface CountScheduleUpdateInput {
  frequency?: CountFrequency
  nextDueAt?: string
  assignedTo?: string | null
  isActive?: boolean
}

export interface CountScheduleListQuery {
  branchId?: string
  active?: boolean
  limit: number
  offset: number
}

export interface CountScheduleFilters {
  branchId: string | null
  active?: boolean | undefined
  limit: number
  offset: number
}

// --- ABC classes (P12-D29) ---------------------------------------------------

export interface AbcListQuery {
  branchId?: string
  abcClass?: AbcClass
}

export interface AbcRow {
  productId: string
  branchId: string
  sku: string
  productName: string
  class: AbcClass
  valueMinor: number
  soldMinor: number
  score: number
  isManual: boolean
  computedAt: Date
  updatedBy: string | null
  updatedAt: Date
}

export interface AbcManualInput {
  abcClass: AbcClass
  manual: boolean
  branchId?: string
}

export interface AbcThresholds {
  aThresholdBp: number
  bThresholdBp: number
}

export interface AbcRecomputeResult {
  updated: number
  skipped: number
}

// --- Accuracy (P12-D33) ------------------------------------------------------

export interface CountAccuracy {
  accuracyBp: number | null
  countedLines: number
  matchedLines: number
  countsPosted: number
  countsOnTime: number
  varianceValueMinor: number
}

export interface CountAccuracyQuery {
  branchId?: string
  from: string
  to: string
}
