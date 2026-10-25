/**
 * `dashboard` — the signed-in landing page.
 *
 * Phase 8 moved the 74-line route body here unchanged. Phase 9 replaces the page wholesale with
 * the executive dashboard and adds `analytics`, so treat everything except the barrel as
 * temporary.
 */

/** The dashboard shares the analytics period contract so the two pages cannot disagree. */
export {
	dashboardSearchDefaults,
	dashboardSearchSchema,
} from "#/modules/analytics"
export { NeedsAttention } from "./components/needs-attention"
export { RecentActivity } from "./components/recent-activity"
export { TillLine } from "./components/till-line"
export { DashboardPage } from "./pages/dashboard-page"
