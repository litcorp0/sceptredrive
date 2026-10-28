/**
 * `evat` — the GRA submission surface (P14-D33 … P14-D40).
 *
 * One screen: the queue's counts, every submission with its deadline and GRA code, and the
 * certificate when there is one. The provider is a mock in this phase and the seam is named, so
 * the console shows the provider's own words rather than pretending a certificate exists.
 *
 * Reads need `evat.read`; a retry needs `evat.retry`, which only an admin holds. The
 * `flag.evatSubmission` setting is consumed here as a notice only: the bottom edge in the sale
 * and refund writers is the server, and a flag the console alone honoured would still queue.
 */
export {
	evatDetailOptions,
	evatHealthOptions,
	evatListOptions,
	getEvatHealth,
	getEvatSubmission,
	getEvatSummary,
	listEvatSubmissions,
	retryEvatSubmission,
} from "./api/evat"
export { evatKeys } from "./api/keys"
export { EvatDetailSheet } from "./components/evat-detail-sheet"
export { EVAT_KIND_LABELS, EvatFilters } from "./components/evat-filters"
export { EvatStatusBadge, OverdueBadge } from "./components/evat-status-badge"
export { EvatTable } from "./components/evat-table"
export { EvatHealthLine } from "./components/health-line"
export { EvatSummaryTiles } from "./components/summary-tiles"
export { EvatPage } from "./pages/evat-page"
export type {
	EvatCertificateView,
	EvatHealth,
	EvatListQuery,
	EvatSubmissionPage,
	EvatSubmissionView,
	EvatSummary,
} from "./types"
export {
	type EvatSearch,
	evatSearchSchema,
} from "./utils/search"
