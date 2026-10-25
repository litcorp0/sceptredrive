import type { PurchaseOrderStatus, ReplenishmentBasis } from '@sceptre/shared'

/**
 * Read models for the two questions a manager asks before ordering: what should
 * I buy, and who actually delivers.
 *
 * Nothing here is stored. Every figure is an aggregate over tables owned by
 * inventory, pos, suppliers and procurement, and every suggestion exposes the
 * inputs it used so the console can print the calculation instead of asking the
 * manager to trust it.
 */

/** One `stock_threshold` row joined to the facts a suggestion needs. */
export interface ReplenishmentFactRow {
  productId: string
  sku: string
  name: string
  supplierId: string | null
  supplierName: string | null
  /** `supplier_product.lead_time_days`; null when the link has none. */
  leadTimeDays: number | null
  /** `supplier_product.last_cost_minor`; null when there is no preferred link. */
  linkLastCostMinor: number | null
  /** `product.cost_price_minor` — the derived catalogue cost (P11-D13). */
  catalogueCostMinor: number
  minLevel: number
  maxLevel: number | null
  minOrderQuantity: number
  onHand: number | null
}

export interface ReplenishmentRow {
  productId: string
  sku: string
  name: string
  supplierId: string | null
  supplierName: string | null
  leadTimeDays: number
  leadTimeAssumed: boolean
  minLevel: number
  maxLevel: number | null
  minOrderQuantity: number
  onHand: number
  onOrder: number
  unitsSold: number
  velocityDays: number
  targetLevel: number
  coverageLevel: number
  position: number
  suggested: number
  basis: ReplenishmentBasis
  lastCostMinor: number
  suggestedValueMinor: number
}

export interface ReplenishmentGroup {
  /** Empty string for the Unassigned group (P11-D10). */
  supplierId: string
  supplierName: string
  /** The longest lead time in the group; the header is a summary, rows are exact. */
  leadTimeDays: number
  /** True when at least one row's lead time came from the default setting. */
  leadTimeAssumed: boolean
  rows: ReplenishmentRow[]
  suggestedUnits: number
  totalValueMinor: number
}

export interface ReplenishmentResult {
  branchId: string
  velocityDays: number
  groups: ReplenishmentGroup[]
  /** Rows with no preferred supplier; they cannot become a PO line until one is chosen. */
  unassigned: ReplenishmentGroup
  /** Over the returned rows, so the figures add up on screen. */
  totals: { rows: number; suggestedUnits: number; valueMinor: number }
  /** Rows matching the filter before `limit`/`offset`, so a truncated page says so. */
  totalRows: number
}

export interface ReplenishmentQuery {
  branchId?: string
  supplierId?: string
  onlySuggested: boolean
  q?: string
  limit: number
  offset: number
}

/** One purchase-order line in the performance window, with its dates resolved. */
export interface PerformanceLineFact {
  orderId: string
  /** The order's lifecycle state; the fill rate only counts orders that received. */
  status: PurchaseOrderStatus
  supplierId: string
  supplierCode: string
  supplierName: string
  lineId: string
  orderedQuantity: number
  receivedQuantity: number
  /** `purchase_order.expected_date` as `YYYY-MM-DD`. */
  expectedDate: string | null
  /** `purchase_order.sent_at` as an Accra (UTC) calendar day. */
  sentDate: string | null
  /** The first receipt against this line, as an Accra (UTC) calendar day. */
  firstReceiptDate: string | null
}

/** One receipt line, for last-cost drift. Only the two newest per product arrive. */
export interface ReceiptCostFact {
  supplierId: string | null
  productId: string
  unitCostMinor: number
  receivedAt: Date
}

export interface SupplierPerformanceRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  ordersCount: number
  linesCount: number
  onTimeLines: number
  lateLines: number
  /** Lines with no expected date: unmeasurable, counted so the denominator is visible. */
  noPromiseLines: number
  /** Lines with a promise but no receipt yet: excluded from the rate, named here. */
  noReceiptLines: number
  onTimeRateBasisPoints: number | null
  orderedUnits: number
  receivedUnits: number
  fillRateBasisPoints: number | null
  /** Tenths of a day; the console divides by 10 for display only. */
  promisedLeadDaysAverageTenths: number | null
  actualLeadDaysAverageTenths: number | null
  lastCostDriftMinor: number | null
  lastCostDriftBasisPoints: number | null
  lastCostAt: string | null
  driftComparableProducts: number
}

export interface SupplierPerformanceResult {
  branchId: string
  from: string
  to: string
  suppliers: SupplierPerformanceRow[]
  totals: {
    suppliers: number
    onTimeRateBasisPoints: number | null
    fillRateBasisPoints: number | null
  }
  /** What the figures could not measure, printed as exclusions rather than assumed. */
  exclusions: { ordersWithoutSendDate: number; linesWithoutReceipt: number }
}

export interface SupplierPerformanceQuery {
  branchId?: string
  supplierId?: string
  from?: string
  to?: string
}
