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
  /** The sale's own id: a receipt the console can open, not just read. */
  saleId: string
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

// --- Inventory valuation and movement (ANL-02) ------------------------------

export interface InventoryTotals {
  /** `Σ quantity_on_hand × avg_cost_minor` over the projection, in minor units. */
  stockValueMinor: number
  unitsOnHand: number
  distinctProducts: number
  /** At or below a configured threshold. The rule is `inventory.service.toStockRow`'s. */
  lowStockCount: number
  outOfStockCount: number
  /** Rows that have a threshold configured at all, so "low stock" has a denominator. */
  thresholdCount: number
}

export interface InventoryBranchRow {
  branchId: string
  code: string
  name: string
  stockValueMinor: number
  unitsOnHand: number
  lowStockCount: number
}

/**
 * Stock flow for the window.
 *
 * **Bucketed on `stock_movement.created_at`** — the ledger posting time, not the business
 * date. `stock_movement` has no `occurred_at` column, so a sale synced late lands in the
 * bucket it was posted in, exactly as the ledger records it.
 */
export interface InventoryFlowPoint {
  bucketStart: string
  receivedUnits: number
  soldUnits: number
  /** `ADJUSTMENT` plus `COUNT_VARIANCE`, signed as stored. */
  adjustedUnits: number
  transferredInUnits: number
  transferredOutUnits: number
  receivedValueMinor: number
}

export interface InventoryMover {
  productId: string
  sku: string
  name: string
  unitsSold: number
}

/**
 * Cycle-count accuracy for the window, from posted counts and the stock ledger
 * (P12-D33). The same six figures `GET /api/counts/accuracy` returns; the
 * analytics tab shows them without a second endpoint.
 */
export interface InventoryCountAccuracy {
  /** `null` — never `0` — when no line was counted in the window. */
  accuracyBp: number | null
  countedLines: number
  matchedLines: number
  countsPosted: number
  countsOnTime: number
  varianceValueMinor: number
}

export interface InventoryResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  totals: InventoryTotals
  byBranch: InventoryBranchRow[]
  flow: InventoryFlowPoint[]
  topMovers: InventoryMover[]
  countAccuracy: InventoryCountAccuracy
  /**
   * Product/branch rows holding stock with no movement in the window. A count only — the
   * list belongs to RPT-04 (Phase 14), so the field is an object the tab can grow into.
   */
  deadStock: { count: number }
}

// --- Credit (ANL-02) --------------------------------------------------------

/**
 * Utilisation buckets, labelled for direct display (D10): the chart legend and the table
 * both print `label` verbatim. `No limit` covers profiles with a zero limit.
 */
export type CreditUtilisationBucket = '0-50%' | '50-80%' | '80-100%' | '>100%' | 'No limit'

export interface CreditTotals {
  /** `Σ credit_profile.balance_minor` — the stored projection, including customer credit. */
  outstandingMinor: number
  limitMinor: number
  utilisationBp: number | null
  /** Profiles with a positive balance. Distribution counts add up to this. */
  customersWithBalance: number
  overLimitCount: number
  onHoldCount: number
  overLimitExposureMinor: number
  /** `Σ credit_ledger_entry.amount_minor` for the same scope: the append-only cross-check. */
  ledgerBalanceMinor: number
  /** `outstandingMinor − ledgerBalanceMinor`. Zero is the normal case; the tests assert it. */
  reconcileDriftMinor: number
}

export interface CreditSeriesPoint {
  bucketStart: string
  chargesMinor: number
  repaymentsMinor: number
  netMinor: number
}

export interface CreditBucket {
  label: CreditUtilisationBucket
  count: number
  balanceMinor: number
}

export interface CreditBranchRow {
  branchId: string
  code: string
  name: string
  outstandingMinor: number
  limitMinor: number
  overLimitCount: number
}

/** No customer id, name, or phone appears anywhere in this payload (D15). */
export interface CreditResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  totals: CreditTotals
  series: CreditSeriesPoint[]
  distribution: CreditBucket[]
  byBranch: CreditBranchRow[]
}

// --- Loyalty (ANL-02) -------------------------------------------------------

export interface LoyaltyTotals {
  issuedPoints: number
  redeemedPoints: number
  expiredPoints: number
  adjustedPoints: number
  clawedBackPoints: number
  /** From the loyalty account projection, valued with the owning service's rule. */
  outstandingPoints: number
  outstandingValueMinor: number
}

export interface LoyaltySeriesPoint {
  bucketStart: string
  issuedPoints: number
  redeemedPoints: number
  expiredPoints: number
}

/**
 * Per-branch activity. The global expiry postings carry no branch, so they are not a row
 * here; they remain part of the headline totals.
 */
export interface LoyaltyBranchRow {
  branchId: string
  code: string
  name: string
  earnedPoints: number
  redeemedPoints: number
  clawedBackPoints: number
  adjustedPoints: number
  expiredPoints: number
  netPoints: number
}

/** The programme's own numbers, so a chart legend never hard-codes them. */
export interface LoyaltyEarnRate {
  pointsPerCedi: number
  earnPointsPerCedi: number
  expiryMonths: number
}

export interface LoyaltyResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  totals: LoyaltyTotals
  expiringSoon: { points: number; valueMinor: number; days: number }
  series: LoyaltySeriesPoint[]
  earnRate: LoyaltyEarnRate
  byBranch: LoyaltyBranchRow[]
}

// --- Payables (ANL-02) ------------------------------------------------------

export interface PayablesTotals {
  outstandingMinor: number
  paidMinor: number
  overdueMinor: number
  invoicedMinor: number
  onAccountMinor: number
}

export interface PayablesSeriesPoint {
  bucketStart: string
  invoicedMinor: number
  paidMinor: number
}

export interface PayablesSupplierRow {
  supplierId: string
  code: string
  name: string
  outstandingMinor: number
  overdueMinor: number
}

export interface PayablesResponse {
  currency: 'GHS'
  period: Period
  scope: AnalyticsScopeView
  /** The ageing buckets as of today (Accra), from the payables service's own rule. */
  overdueBuckets: AgingBuckets
  totals: PayablesTotals
  series: PayablesSeriesPoint[]
  topSuppliers: PayablesSupplierRow[]
}

/** Mirrors `payables.types.AgingBuckets` without importing that module's types. */
export interface AgingBuckets {
  current: number
  days1To30: number
  days31To60: number
  days61To90: number
  over90: number
}
