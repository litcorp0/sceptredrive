import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { settingsListOptions } from "#/modules/settings"
import { evatHealthOptions, evatListOptions, evatSummaryOptions } from "../api/evat"
import { EvatDetailSheet } from "../components/evat-detail-sheet"
import { EvatFilters } from "../components/evat-filters"
import { EvatTable } from "../components/evat-table"
import { EvatHealthLine } from "../components/health-line"
import { EvatSummaryTiles } from "../components/summary-tiles"
import type { EvatListQuery } from "../types"
import { readFlag } from "../utils/flags"
import type { EvatSearch } from "../utils/search"

const routeApi = getRouteApi("/_authenticated/evat")

const PAGE_SIZE = 25

/**
 * Every E-VAT submission, its attempts, its GRA code and its deadline.
 *
 * The summary, the list and the health line each read one API answer; nothing here adds up rows
 * to invent a total. A submission can be retrying and overdue at once (P14-D36), so the deadline
 * is a badge beside the status rather than a state that replaces it.
 */
export function EvatPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { session } = routeApi.useRouteContext()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	const canRead = hasPermission(session.user.role, "evat.read")
	const canRetry = hasPermission(session.user.role, "evat.retry")

	const settingsQuery = useQuery({ ...settingsListOptions(), enabled: canRead })
	const submissionFlag = readFlag(settingsQuery.data?.settings, "flag.evatSubmission")

	const requestedBranch = canSelectBranch ? search.branchId : undefined
	const branchId =
		requestedBranch === "ALL" ? undefined : (requestedBranch ?? activeBranchId ?? undefined)

	const query: EvatListQuery = {
		branchId,
		status: search.status,
		kind: search.kind,
		overdue: search.overdue === undefined ? undefined : search.overdue === "true",
		from: search.from,
		to: search.to,
		limit: PAGE_SIZE,
		offset: search.offset ?? 0,
	}

	const listQuery = useQuery({ ...evatListOptions(query), enabled: canRead })
	const summaryQuery = useQuery({ ...evatSummaryOptions(), enabled: canRead })
	const healthQuery = useQuery({ ...evatHealthOptions(), enabled: canRead })

	const denied = listQuery.error instanceof ApiError && listQuery.error.status === 403
	const requestId = listQuery.error instanceof ApiError ? listQuery.error.requestId : undefined
	const total = listQuery.data?.total ?? 0
	const filtered =
		search.status !== undefined ||
		search.kind !== undefined ||
		search.overdue !== undefined ||
		search.from !== undefined ||
		search.to !== undefined

	function updateSearch(patch: Partial<EvatSearch>) {
		void navigate({ search: (prev: EvatSearch) => ({ ...prev, ...patch }) })
	}

	if (!canRead) {
		return (
			<div className="grid gap-4">
				<PageHeader eyebrow="System" title="E-VAT submissions" />
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see E-VAT submissions"
					description="This screen needs evat.read. Ask an administrator if you need access."
				/>
			</div>
		)
	}

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="System"
				title="E-VAT submissions"
				description="Every invoice and refund sent to GRA, its attempts, its certificate and its deadline. A refusal is shown in the provider's own words; a retry is an administrator's decision."
			/>

			{!submissionFlag ? (
				<output className="block rounded-md border border-dashed p-3 text-sm text-muted-foreground">
					Submission is switched off in settings. Documents are not being queued.
				</output>
			) : null}

			<EvatHealthLine
				health={healthQuery.data?.health}
				isLoading={healthQuery.isLoading}
				isError={healthQuery.isError}
			/>

			<EvatSummaryTiles
				summary={summaryQuery.data}
				isLoading={summaryQuery.isLoading}
				isError={summaryQuery.isError}
				requestId={
					summaryQuery.error instanceof ApiError ? summaryQuery.error.requestId : undefined
				}
			/>

			{denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see these submissions"
					description="A submission must belong to a branch you can read. Ask an administrator if you need access."
				/>
			) : (
				<>
					<EvatFilters
						search={search}
						branches={branches}
						canSelectBranch={canSelectBranch}
						activeBranchId={activeBranchId}
						onChange={updateSearch}
					/>

					<EvatTable
						page={listQuery.data}
						isLoading={listQuery.isLoading}
						isError={listQuery.isError}
						requestId={requestId}
						branches={branches}
						showBranch={canSelectBranch}
						onOpen={(submissionId) => updateSearch({ submissionId })}
						emptyMessage={
							filtered
								? "No E-VAT submissions match these filters."
								: "No documents have been queued yet. A submission is created when a sale or refund commits."
						}
					/>

					{total > 0 ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={search.offset ?? 0}
							onOffsetChange={(offset) =>
								updateSearch({ offset: offset === 0 ? undefined : offset })
							}
						/>
					) : null}
				</>
			)}

			<EvatDetailSheet
				submissionId={search.submissionId ?? null}
				canRetry={canRetry}
				branches={branches}
				onClose={() => updateSearch({ submissionId: undefined })}
			/>
		</div>
	)
}
