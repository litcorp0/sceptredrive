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
	profileListOptions,
	statementOptions,
	updateCreditProfile,
} from "./api/credit"
export { type CreditEntryFilters, creditKeys } from "./api/keys"
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
	CreditMethod,
	CreditOverrideReason,
	CreditPostingResult,
	CreditProfile,
	CreditProfileListRow,
	CreditProfileUpdateInput,
	CreditReasonCode,
	CreditStatement,
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
	signedGhs,
} from "./utils/credit"
