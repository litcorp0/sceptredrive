/**
 * `analytics` — the read-model surface of the console.
 *
 * The dashboard reuses this module's chart shell, KPI tile, panel states, and overview query
 * through this barrel (cross-module use goes through `index.ts`, never a deep import).
 */

export {
	analyticsOverviewOptions,
	analyticsProductsOptions,
	analyticsReportOptions,
	analyticsSalesOptions,
	analyticsTaxOptions,
	downloadReport,
	refreshAnalytics,
} from "./api/analytics"
export { analyticsKeys } from "./api/keys"
export { ChartCard } from "./components/chart-card"
export { DeltaBadge } from "./components/delta-badge"
export { ExportButton } from "./components/export-button"
export { FilterBar } from "./components/filter-bar"
export { KpiRow, KpiTile } from "./components/kpi-tile"
export { PanelState } from "./components/panel-state"
export { SortableHead } from "./components/sortable-head"
export { TabNav } from "./components/tab-nav"
export { useAnalyticsBranch } from "./hooks/use-analytics-filters"
export { AnalyticsPage } from "./pages/analytics-page"
export type * from "./types"
export { cedisTick, moneyTooltip, pointsTooltip } from "./utils/format-chart"
export { usePrefersReducedMotion } from "./utils/motion"
export {
	ANALYTICS_TABS,
	analyticsSearchDefaults,
	analyticsSearchSchema,
	applyPreset,
	dashboardSearchDefaults,
	dashboardSearchSchema,
	GRANULARITIES,
	PERIOD_PRESETS,
	periodLabel,
	resolvePeriod,
	toAnalyticsQuery,
	toReportQuery,
} from "./utils/search"
