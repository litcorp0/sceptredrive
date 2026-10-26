/**
 * `replenishment` — what to order and why, and which suppliers keep their promises (Phase 11,
 * Plan 10).
 *
 * No arithmetic happens in this module: the API returns the suggestion with every input it used,
 * and these pages render it. The routes live under `/procurement` because a route path is not a
 * module owner (`admin/src/modules/README.md`).
 *
 * The barrel is the only entry point.
 */
export { performanceKeys, replenishmentKeys } from "./api/keys"
export { performanceOptions, suggestionsOptions } from "./api/replenishment"
export { PerformanceRowDetail } from "./components/performance-row-detail"
export { type PerformancePeriod, PerformanceView } from "./components/performance-view"
export { ReplenishOrderDialog } from "./components/replenish-order-dialog"
export { SuggestionsView } from "./components/suggestions-view"
export { UnassignedRowActions } from "./components/unassigned-row-actions"
export { ReplenishmentPage } from "./pages/replenishment-page"
export { SupplierPerformancePage } from "./pages/supplier-performance-page"
export type {
	PerformanceQuery,
	ReplenishmentGroup,
	ReplenishmentResult,
	ReplenishmentRow,
	ReplenishmentTotals,
	SuggestionQuery,
	SuggestionSettings,
	SupplierPerformanceExclusions,
	SupplierPerformanceResult,
	SupplierPerformanceRow,
	SupplierPerformanceTotals,
} from "./types"
export { MetricTile } from "./ui/metric-tile"
export { SuggestionBasis } from "./ui/suggestion-basis"
export { formatBasis, formatLeadDays, reasonSentence } from "./utils/suggestion"
