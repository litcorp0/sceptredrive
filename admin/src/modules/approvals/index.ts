/**
 * `approvals` — the unified decision inbox.
 *
 * One screen lists every request that needs a human decision, one detail renders the subject's
 * evidence, and one dialog submits the decision. `canDecide` and `canWithdraw` are the server's
 * fields: the console never infers them from the actor's role.
 *
 * The procurement module imports this barrel for the pending product-submission panel and the
 * order detail's approval card. The direction is one way: this module reads transfers and
 * write-off documents from `inventory`, never from `procurement`.
 */
export {
	approvalDetailOptions,
	approvalListOptions,
	approvalSummaryOptions,
	decideApproval,
	getApproval,
	listApprovals,
	withdrawApproval,
} from "./api/approvals"
export { approvalKeys } from "./api/keys"
export { ApprovalDetailPanel } from "./components/approval-detail-panel"
export { ApprovalFilters } from "./components/approval-filters"
export { ApprovalTable } from "./components/approval-table"
export { DecisionDialog } from "./components/decision-dialog"
export { ApprovalDetailPage } from "./pages/approval-detail-page"
export { ApprovalsPage } from "./pages/approvals-page"
export type {
	ApprovalDecisionInput,
	ApprovalDetail,
	ApprovalListQuery,
	ApprovalListResult,
	ApprovalListRow,
	ApprovalRow,
	ApprovalSubject,
	ApprovalSummary,
} from "./types"
export {
	ageWords,
	amountText,
	APPROVAL_REASON_LABELS,
	APPROVAL_REASON_OPTIONS,
	APPROVAL_STATUS_LABELS,
	APPROVAL_TYPE_LABELS,
	approvalReasonLabel,
	approvalSearchDefaults,
	approvalSearchSchema,
	type ApprovalSearch,
	bandLabel,
	proposalMinor,
	proposalName,
	proposalText,
	signedAmountText,
	statusLabel,
	statusTone,
	subjectKindLabel,
	subjectSummary,
	typeLabel,
	typeTone,
	valueLabel,
} from "./utils/approval"
