import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Inbox } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { ApprovalFilters } from "../components/approval-filters"
import { ApprovalTable } from "../components/approval-table"
import { approvalListOptions } from "../api/approvals"
import type { ApprovalSearch } from "../utils/approval"

const routeApi = getRouteApi("/_authenticated/approvals/")

const PAGE_SIZE = 25

/** The unified inbox: every pending request, oldest first unless the URL says otherwise. */
export function ApprovalsPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { activeBranchId, canSelectBranch } = useBranch()

	const offset = search.offset ?? 0
	// The default queue is pending. `ALL` is a URL value; the API receives no status.
	const status = search.status ?? "PENDING"
	// A manager's scope is the server's decision; a branchId in their URL is ignored, never
	// forwarded. An admin's absence of a choice follows the shell branch; `ALL` is explicit.
	const requestedBranch = canSelectBranch ? search.branchId : undefined
	const branchId =
		requestedBranch === "ALL" ? undefined : (requestedBranch ?? activeBranchId ?? undefined)
	const query = {
		type: search.type,
		status: status === "ALL" ? undefined : status,
		sort: search.sort,
		branchId,
		limit: PAGE_SIZE,
		offset,
	}

	const approvalsQuery = useQuery(approvalListOptions(query))
	const denied = approvalsQuery.error instanceof ApiError && approvalsQuery.error.status === 403

	const emptyMessage =
		status === "PENDING" ? "Nothing is waiting for a decision." : "No requests match these filters."

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Operations"
				title="Approvals"
				description="Every request in the organisation that needs a human decision, oldest first. Filters and paging live in the URL, so a queue can be shared."
			/>

			{denied ? (
				<EmptyState
					icon={Inbox}
					title="You cannot see approvals"
					description="Your role does not include approval.read. Ask an administrator if you should be able to review requests."
				/>
			) : (
				<>
					<ApprovalFilters
						search={search}
						onChange={(patch) => {
							void navigate({
								search: (prev: ApprovalSearch) => ({ ...prev, ...patch }),
							})
						}}
					/>

					<ApprovalTable
						result={approvalsQuery.data}
						isLoading={approvalsQuery.isLoading}
						isError={approvalsQuery.isError}
						emptyMessage={emptyMessage}
					/>

					{approvalsQuery.data && approvalsQuery.data.total > 0 ? (
						<Pagination
							total={approvalsQuery.data.total}
							limit={PAGE_SIZE}
							offset={offset}
							onOffsetChange={(next) => {
								void navigate({
									search: (prev: ApprovalSearch) => ({
										...prev,
										offset: next === 0 ? undefined : next,
									}),
								})
							}}
						/>
					) : null}
				</>
			)}
		</div>
	)
}
