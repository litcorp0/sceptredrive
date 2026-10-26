/**
 * The analytics read-model contract, mirrored from the API.
 *
 * Amounts are integer minor units (pesewas) and ratios are integer basis points; nothing in
 * this module converts them with arithmetic. Display formatting lives in `lib/format` and
 * `@sceptre/shared`.
 */

export type Granularity = "day" | "week" | "month"

export type AnalyticsTab =
	| "sales"
	| "products"
	| "inventory"
	| "credit"
	| "loyalty"
	| "payables"
	| "tax"

export interface AnalyticsPeriod {
	from: string
	to: string
	granularity: Granularity
	days: number
}

export interface MoneyDelta {
	currentMinor: number
	previousMinor: number
	deltaBp: number | null
}

export interface TaxSplit {
	baseMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	totalMinor: number
}

export interface SeriesPoint {
	bucketStart: string
	takeMinor: number
	taxTotalMinor: number
	salesCount: number
}

export interface TenderSlice {
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

export interface AnalyticsScope {
	branchId: string | null
	allBranches: boolean
}

export interface OverviewResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	comparison: { from: string; to: string }
	scope: AnalyticsScope
	totals: {
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
		refundsMinor: number
		refundCount: number
	}
	deltas: {
		take: MoneyDelta
		grossProfit: MoneyDelta
		salesCount: MoneyDelta
		avgBasket: MoneyDelta
		marginBpDelta: number | null
	}
	series: SeriesPoint[]
	tenderMix: TenderSlice[]
	topProducts: TopProduct[]
	categorySplit: CategorySlice[]
	branchRanking: BranchRank[]
	attention: {
		lowStockCount: number
		openConflictCount: number
		conflictsBySeverity: { low: number; medium: number; high: number }
		openShiftCount: number
		overLimitCreditCount: number
		expiringPoints: number
		expiringPointsValueMinor: number
	}
	syncHealth: {
		activeTerminals: number
		terminalsSeenToday: number
		revokedDevices30d: number
		avgUploadLagMinutes: number | null
		maxUploadLagMinutes: number | null
	}
	driftMinor: { revenue: number; tax: number }
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

export interface SalesResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	comparison: { from: string; to: string }
	scope: AnalyticsScope
	totals: {
		takeMinor: number
		salesCount: number
		avgBasketMinor: number
		itemsSold: number
		changeMinor: number
		tax: TaxSplit
	}
	deltas: { take: MoneyDelta; salesCount: MoneyDelta; avgBasket: MoneyDelta }
	series: SeriesPoint[]
	byBranch: LabelledTotal[]
	byTerminal: LabelledTotal[]
	byCashier: LabelledTotal[]
	byHour: Array<{ hour: number; takeMinor: number; salesCount: number }>
	rows: SalesRow[]
	total: number
}

export interface ProductsResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
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
	rows: Array<TopProduct & { salesCount: number }>
	total: number
	sort: "revenue" | "units" | "margin"
	direction: "asc" | "desc"
}

export interface TaxBucketPoint {
	bucketStart: string
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	totalMinor: number
}

export interface TaxResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
	totals: TaxSplit & { salesCount: number; standardLineTotalMinor: number }
	byBranch: Array<TaxSplit & { branchId: string; code: string; name: string }>
	byCategory: Array<{
		category: string
		baseMinor: number
		vatMinor: number
		nhilMinor: number
		getfundMinor: number
		totalMinor: number
		revenueBaseMinor: number
		lineTotalMinor: number
	}>
	series: TaxBucketPoint[]
	driftMinor: { revenue: number; tax: number }
	driftExplanation: string
	rates: { vatBp: number; nhilBp: number; getfundBp: number; totalBp: number; source: string }
}

/** Query shape every analytics request shares. */
export interface AnalyticsQuery {
	from: string
	to: string
	granularity: Granularity
	branchId?: string
}

export interface ReportQuery extends AnalyticsQuery {
	sort?: string
	direction?: "asc" | "desc"
	limit?: number
	offset?: number
}

export type ReportName =
	| "overview"
	| "sales"
	| "products"
	| "inventory"
	| "credit"
	| "loyalty"
	| "payables"
	| "tax"

export type ExportName =
	| "sales"
	| "products"
	| "inventory"
	| "credit"
	| "loyalty"
	| "payables"
	| "tax"

export interface InventoryResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
	totals: {
		stockValueMinor: number
		unitsOnHand: number
		distinctProducts: number
		lowStockCount: number
		outOfStockCount: number
		thresholdCount: number
	}
	byBranch: Array<{
		branchId: string
		code: string
		name: string
		stockValueMinor: number
		unitsOnHand: number
		lowStockCount: number
	}>
	flow: Array<{
		bucketStart: string
		receivedUnits: number
		soldUnits: number
		adjustedUnits: number
		receivedValueMinor: number
	}>
	topMovers: Array<{ productId: string; sku: string; name: string; unitsSold: number }>
	countAccuracy: {
		/** `null` — never 0 — when no line was counted in the window. */
		accuracyBp: number | null
		countedLines: number
		matchedLines: number
		countsPosted: number
		countsOnTime: number
		varianceValueMinor: number
	}
	deadStock: { count: number }
}

export interface CreditResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
	totals: {
		outstandingMinor: number
		limitMinor: number
		utilisationBp: number | null
		customersWithBalance: number
		overLimitCount: number
		onHoldCount: number
		overLimitExposureMinor: number
		ledgerBalanceMinor: number
		reconcileDriftMinor: number
	}
	series: Array<{
		bucketStart: string
		chargesMinor: number
		repaymentsMinor: number
		netMinor: number
	}>
	distribution: Array<{ label: string; count: number; balanceMinor: number }>
	byBranch: Array<{
		branchId: string
		code: string
		name: string
		outstandingMinor: number
		limitMinor: number
		overLimitCount: number
	}>
}

export interface LoyaltyResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
	totals: {
		issuedPoints: number
		redeemedPoints: number
		expiredPoints: number
		adjustedPoints: number
		outstandingPoints: number
		outstandingValueMinor: number
	}
	expiringSoon: { points: number; valueMinor: number; days: number }
	series: Array<{
		bucketStart: string
		issuedPoints: number
		redeemedPoints: number
		expiredPoints: number
	}>
	earnRate: { pointsPerCedi: number; earnPointsPerCedi: number; expiryMonths: number }
	byBranch: Array<{
		branchId: string
		code: string
		name: string
		earnedPoints: number
		redeemedPoints: number
		expiredPoints: number
	}>
}

export interface PayablesResponse {
	currency: "GHS"
	period: AnalyticsPeriod
	scope: AnalyticsScope
	totals: {
		outstandingMinor: number
		paidMinor: number
		overdueMinor: number
		invoicedMinor: number
		onAccountMinor: number
	}
	series: Array<{ bucketStart: string; invoicedMinor: number; paidMinor: number }>
	topSuppliers: Array<{
		supplierId: string
		code: string
		name: string
		outstandingMinor: number
		overdueMinor: number
	}>
	overdueBuckets: {
		current: number
		days1To30: number
		days31To60: number
		days61To90: number
		over90: number
	}
}
