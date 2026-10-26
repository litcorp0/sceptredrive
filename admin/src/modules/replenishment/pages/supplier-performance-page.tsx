import { accraIsoDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { performanceOptions } from "../api/replenishment"
import { type PerformancePeriod, PerformanceView } from "../components/performance-view"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * Which suppliers keep their promises.
 *
 * The period is three fixed windows; the branch comes from the shell. The API computes every rate
 * and returns the exclusions, so this page only owns the period state and the composition.
 */
export function SupplierPerformancePage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, activeBranch } = useBranch()
	const canRead = hasPermission(session.user.role, "procurement.read")
	const [periodDays, setPeriodDays] = useState<PerformancePeriod>(90)

	const window = useMemo(() => {
		const to = accraIsoDay()
		const from = accraIsoDay(Date.now() - (periodDays - 1) * 86_400_000)
		return { from, to }
	}, [periodDays])

	const performanceQuery = useQuery({
		...performanceOptions({
			branchId: activeBranchId ?? undefined,
			from: window.from,
			to: window.to,
		}),
		enabled: canRead && activeBranchId !== null,
	})

	if (!canRead) {
		return (
			<section>
				<p className="text-sm text-muted-foreground">
					You don't have permission to view supplier performance.
				</p>
			</section>
		)
	}

	if (activeBranchId === null) {
		return (
			<section>
				<p className="text-sm text-muted-foreground">
					Choose a branch from the header to see how its suppliers deliver.
				</p>
			</section>
		)
	}

	return (
		<section>
			<PageHeader
				title="Which suppliers deliver"
				description={`Branch: ${activeBranch?.name ?? "—"}. Rates, lead times and cost drift measured per purchase-order line.`}
			/>
			<PerformanceView
				data={performanceQuery.data ?? null}
				isLoading={performanceQuery.isLoading}
				isError={performanceQuery.isError}
				periodDays={periodDays}
				onPeriodChange={setPeriodDays}
				from={window.from}
				to={window.to}
			/>
		</section>
	)
}
