import { getRouteApi } from "@tanstack/react-router"
import { ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { ConflictsList } from "../components/conflicts-list"
import { OversightFilters } from "../components/oversight-filters"
import { RefundsList } from "../components/refunds-list"
import { SalesList } from "../components/sales-list"
import { ShiftsList } from "../components/shifts-list"
import type { PosSearch } from "../utils/search"
import { resolveTab } from "../utils/search"

const routeApi = getRouteApi("/_authenticated/pos/")
const authenticatedRoute = getRouteApi("/_authenticated")
const PAGE_SIZE = 20

/**
 * The `?tab=` list: sales, refunds, shifts or conflicts.
 *
 * The page is composition only. Each list owns its query and its loading, empty, error
 * and 403 states; the branch comes from the shell's switcher; every filter lives in the
 * URL, so a colleague can open the same view from a link.
 */
export function PosOversightPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId } = useBranch()
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const tab = resolveTab(search.tab)
	const canReadConflicts = hasPermission(session.user.role, "conflict.read")

	const scope = {
		branchId: activeBranchId ?? undefined,
		from: search.from,
		to: search.to,
		terminalId: search.terminalId,
		limit: PAGE_SIZE,
		offset: search.offset,
	}

	function update(patch: Partial<PosSearch>) {
		void navigate({
			search: (prev: Record<string, unknown>) => ({ ...prev, ...patch, offset: patch.offset }),
			replace: true,
		})
	}

	function setOffset(offset: number) {
		update({ offset: offset === 0 ? undefined : offset })
	}

	function clearFilters() {
		void navigate({ search: { tab }, replace: true })
	}

	if (tab === "conflicts" && !canReadConflicts) {
		return (
			<EmptyState
				icon={ShieldAlert}
				title="You cannot see the conflict queue"
				description="This screen needs conflict.read. The tab is hidden for a role that does not hold it, and the API refuses the read."
			/>
		)
	}

	return (
		<>
			<OversightFilters tab={tab} search={search} onChange={update} onClear={clearFilters} />

			{tab === "sales" ? (
				<SalesList
					query={{ ...scope, receiptNumber: search.receiptNumber }}
					onOffsetChange={setOffset}
					onClearFilters={clearFilters}
				/>
			) : null}

			{tab === "refunds" ? (
				<RefundsList
					query={{
						...scope,
						reasonCode: search.reasonCode,
						method: search.method,
						tenderStatus: search.tenderStatus,
					}}
					onOffsetChange={setOffset}
					onClearFilters={clearFilters}
				/>
			) : null}

			{tab === "shifts" ? (
				<ShiftsList
					query={{
						...scope,
						status: search.shiftStatus,
						reviewStatus: search.reviewStatus,
					}}
					onOffsetChange={setOffset}
					onClearFilters={clearFilters}
				/>
			) : null}

			{tab === "conflicts" ? (
				<ConflictsList
					query={{
						...scope,
						status: search.status,
						severity: search.severity,
						saleId: search.saleId,
						shiftId: search.shiftId,
					}}
					onOffsetChange={setOffset}
					onClearFilters={clearFilters}
				/>
			) : null}
		</>
	)
}
