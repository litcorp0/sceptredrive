/**
 * `credit` — credit limits and holds, the append-only ledger, repayments, the aging report and the
 * printable customer statement.
 *
 * Migration note (Phase 8): the section lived in `components/customers/` (six files) and in two
 * routes owned by the URL, not the domain — `customers/aging.tsx` (117 lines) and
 * `customers/$id.statement.tsx` (150 lines). Both are now pages here; the route files only route
 * (decisions D6, D9 — a move, not a rewrite).
 *
 * The API keys keep the pre-Phase-8 roots (`["credit-profiles"]`, `["credit-entries"]`,
 * `["aging"]`, `["statement"]`) because the dialogs invalidate them by prefix and the customer
 * profile reads the profile key by hand. Money stays integer minor units; `signedGhs` and the label
 * maps in `utils/credit.ts` keep formatting inside `lib/format`.
 *
 * The single legacy edge is marked in place: the customer profile
 * (`routes/_authenticated/customers/$id/index.tsx`) composes the ledger, the profile dialog and
 * both posting dialogs through this barrel, and Plan 09 moves that page.
 */
export {
	agingOptions,
	createCreditEntry,
	createRepayment,
	entryListOptions,
	overLimitListOptions,
	profileListOptions,
	requestCreditLimitIncrease,
	statementOptions,
	updateCreditProfile,
} from "./api/credit"
export { type CreditEntryFilters, creditKeys } from "./api/keys"
export { AgingTable } from "./components/aging-table"
export { CreditEntryDialog } from "./components/credit-entry-dialog"
export { CreditLedgerTable } from "./components/credit-ledger-table"
export { CreditProfileDialog } from "./components/credit-profile-dialog"
export { PendingLimitNote } from "./components/pending-limit-note"
export { RepaymentDialog } from "./components/repayment-dialog"
export { StatementView } from "./components/statement-view"
export { CreditAgingPage } from "./pages/credit-aging-page"
export { OverLimitPage } from "./pages/over-limit-page"
export { CreditStatementPage } from "./pages/credit-statement-page"
export type {
	AgingChargeRow,
	AgingCustomerRow,
	AgingQuery,
	AgingResult,
	BranchAging,
	CreditEntry,
	CreditEntryCreateInput,
	CreditEntryKind,
	CreditEntryListQuery,
	CreditEntryListResult,
	CreditLimitRequestInput,
	CreditLimitRequestResult,
	CreditMethod,
	CreditOverrideReason,
	CreditPostingResult,
	CreditProfile,
	CreditProfileListRow,
	CreditProfileUpdateInput,
	CreditReasonCode,
	CreditStatement,
	OverLimitListResult,
	OverLimitQuery,
	OverLimitRow,
	RepaymentCreateInput,
	StatementEntry,
	StatementQuery,
} from "./types"
export {
	AGING_BUCKET_KEYS,
	AGING_BUCKET_LABELS,
	AGING_BUCKET_SHORT,
	CREDIT_KIND_LABELS,
	CREDIT_KIND_TONES,
	CREDIT_METHOD_LABELS,
	CREDIT_OVERRIDE_LABELS,
	CREDIT_REASON_LABELS,
	overLimitSearchDefaults,
	overLimitSearchSchema,
	type OverLimitSearch,
	signedGhs,
} from "./utils/credit"
