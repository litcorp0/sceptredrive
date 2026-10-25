/**
 * The analytics contract.
 *
 * Read-only by design: this module owns no tables (`analytics.schema.ts` is empty) and
 * every number it returns is an aggregate over ledgers and projections another module
 * owns. `00-DECISIONS.md` P9-D10 records the boundary those queries respect.
 *
 * Numeric rules, without exception:
 * - money is integer **minor units** (pesewas), never a float and never cedis;
 * - a ratio or a period-over-period change is integer **basis points** (1240 = +12.40%);
 * - a ratio with no denominator is `null`, because "no previous period" is not "no change";
 * - bucket keys are `YYYY-MM-DD` calendar days in Africa/Accra, so no client has to convert
 *   a timestamp and shift a day.
 */

export type Granularity = 'day' | 'week' | 'month'

export interface AnalyticsQuery {
  from: string
  to: string
  granularity: Granularity
  branchId?: string
}

/** One period-over-period comparison. `deltaBp` is null when the previous figure is zero. */
export interface MoneyDelta {
  currentMinor: number
  previousMinor: number
  deltaBp: number | null
}

export interface Period {
  from: string
  to: string
  granularity: Granularity
  days: number
}

export interface SeriesPoint {
  /** `2026-10-24` — the Accra calendar day (or ISO week/month start) the bucket begins. */
  bucketStart: string
  takeMinor: number
  taxTotalMinor: number
  salesCount: number
}

export interface TaxSplit {
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  totalMinor: number
}

export interface TenderSlice {
  /** `CASH`, `CREDIT`, and any future electronic method. Cash is derived, not summed. */
  method: string
  amountMinor: number
}

export interface TopProduct {
  productId: string
  sku: string
  name: string
  quantity: number
  revenueBaseMinor: number
  costMinor: number
  grossProfitMinor: number
  marginBp: number | null
}

export interface CategorySlice {
  categoryId: string | null
  name: string
  revenueBaseMinor: number
  quantity: number
}

export interface BranchRank {
  branchId: string
  code: string
  name: string
  takeMinor: number
  salesCount: number
}

export interface AttentionSummary {
  lowStockCount: number
  openConflictCount: number
  conflictsBySeverity: { low: number; medium: number; high: number }
  openShiftCount: number
  overLimitCreditCount: number
  expiringPoints: number
  expiringPointsValueMinor: number
}

export interface SyncHealth {
  activeTerminals: number
  terminalsSeenToday: number
  revokedDevices30d: number
  avgUploadLagMinutes: number | null
  maxUploadLagMinutes: number | null
}

export interface AnalyticsScopeView {
  /** Null means every branch (admins); otherwise the one branch in scope. */
  branchId: string | null
  allBranches: boolean
}

export interface OverviewTotals {
  takeMinor: number
  revenueBaseMinor: number
  grossProfitMinor: number
  marginBp: number | null
  tax: TaxSplit
  salesCount: number
  avgBasketMinor: number
  itemsSold: number
  changeMinor: number
  cashMinor: number
  electronicMinor: number
  creditMinor: number
  /** Reserved for Phase 13. Always 0 until refunds exist; never rendered as a figure yet. */
  refundsMinor: number
  /** Reserved for Phase 13, as above. */
  refundCount: number
}

export interface OverviewDeltas {
  take: MoneyDelta
  grossProfit: MoneyDelta
  salesCount: MoneyDelta
  avgBasket: MoneyDelta
  marginBpDelta: number | null
}

export interface OverviewResponse {
  currency: 'GHS'
  period: Period
  comparison: { from: string; to: string }
  scope: AnalyticsScopeView
  totals: OverviewTotals
  deltas: OverviewDeltas
  series: SeriesPoint[]
  tenderMix: TenderSlice[]
  topProducts: TopProduct[]
  categorySplit: CategorySlice[]
  branchRanking: BranchRank[]
  attention: AttentionSummary
  syncHealth: SyncHealth
  /**
   * Header figures minus line figures. Header totals are the charged money; line totals are
   * the server recomputation, so they differ for sales stored with `TOTAL_MISMATCH`. Zero is
   * the normal case and the reconciliation tests assert it for the demo data.
   */
  driftMinor: { revenue: number; tax: number }
}

/** A window is half-open: `[from, toExclusive)`. */
export interface AnalyticsWindow {
  from: Date
  toExclusive: Date
}

/** `null` means every branch (admins); otherwise the one branch in scope. */
export type AnalyticsBranchScope = string | null

// --- Sales report (RPT-01) ---------------------------------------------------

export type SalesSort = 'date' | 'take' | 'count'
export type SortDirection = 'asc' | 'desc'

export interface ReportQuery extends AnalyticsQuery {
  sort?: string
  direction?: SortDirection
  limit?: number
  offset?: number
}

export interface LabelledTotal {
  id: string | null
  label: string
  takeMinor: number
  salesCount: number
  taxTotalMinor: number
}

export interface SalesRow {
  receiptNumber: string
  occurredAt: string
  branchCode: string
  terminalCode: string
  cashierStaffId: string
  cashierName: string
  itemsSold: number
  takeMinor: number
  taxTotalMinor: number
  changeMinor: number
}

export interface HourSlice {
  hour: number
  takeMinor: number
  salesCount: number
}

export interface SalesTotals {
  takeMinor: number
  salesCount: number
  avgBasketMinor: number
  itemsSold: number
  changeMinor: number
  tax: TaxSplit
}

export interface SalesResponse {
  currency: 'GHS'
  period: Period
  comparison: { from: string; to: string }
  scope: AnalyticsScopeView
  totals: SalesTotals
  deltas: { take: MoneyDelta; salesCount: MoneyDelta; avgBasket: MoneyDelta }
  series: SeriesPoint[]
  byBranch: LabelledTotal[]
  byTerminal: LabelledTotal[]
  byCashier: LabelledTotal[]
  byHour: HourSlice[]
  rows: SalesRow[]
  total: number
}

// --- Product performance (RPT-03) -------------------------------------------

export type ProductSort = 'revenue' | 'units' | 'margin'

export interface ProductRow extends TopProduct {
  salesCount: number
}

export interface ProductsResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  totals: {
    revenueBaseMinor: number
    costMinor: number
    grossProfitMinor: number
    marginBp: number | null
    unitsSold: number
    distinctProducts: number
  }
  top: TopProduct[]
  concentration: { top5RevenueBp: number | null }
  byCategory: CategorySlice[]
  rows: ProductRow[]
  total: number
  sort: ProductSort
  direction: SortDirection
}

// --- Tax (RPT-02) -----------------------------------------------------------

export interface TaxBucketPoint {
  bucketStart: string
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  totalMinor: number
}

export interface TaxCategoryRow {
  category: string
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  totalMinor: number
  revenueBaseMinor: number
  lineTotalMinor: number
}

export interface TaxBranchRow extends TaxSplit {
  branchId: string
  code: string
  name: string
}

export interface TaxResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  totals: TaxSplit & { salesCount: number; standardLineTotalMinor: number }
  byBranch: TaxBranchRow[]
  byCategory: TaxCategoryRow[]
  series: TaxBucketPoint[]
  driftMinor: { revenue: number; tax: number }
  driftExplanation: string
  rates: { vatBp: number; nhilBp: number; getfundBp: number; totalBp: number; source: string }
}
