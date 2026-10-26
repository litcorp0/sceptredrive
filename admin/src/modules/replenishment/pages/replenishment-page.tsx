import { formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { SearchIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Switch } from "#/components/ui/switch"
import { useBranch } from "#/lib/branch-context"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { suggestionsOptions } from "../api/replenishment"
import { SuggestionsView } from "../components/suggestions-view"

const authenticatedRoute = getRouteApi("/_authenticated")

const PAGE_LIMIT = 200

/**
 * What to order at the active branch.
 *
 * The branch comes from the shell and the API scopes every row. The switch, supplier and search
 * are query parameters, so the API decides which rows exist; the screen only keeps the controls
 * and renders the response, including the settings it echoes back.
 */
export function ReplenishmentPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, activeBranch } = useBranch()
	const canRead = hasPermission(session.user.role, "procurement.read")
	const canCreate = hasPermission(session.user.role, "procurement.create")
	const canEditLevels = hasPermission(session.user.role, "inventory.threshold")
	const canChooseSupplier = hasPermission(session.user.role, "supplier.update")

	const [onlySuggested, setOnlySuggested] = useState(true)
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [search, setSearch] = useState("")

	const debouncedSearch = useDebouncedValue(search, 300)
	const query = debouncedSearch.trim()
	const hasFilters = supplier !== null || query.length >= 2

	const filters = {
		branchId: activeBranchId ?? undefined,
		supplierId: supplier?.id,
		onlySuggested,
		q: query.length >= 2 ? query : undefined,
		limit: PAGE_LIMIT,
		offset: 0,
	}

	const suggestionsQuery = useQuery({
		...suggestionsOptions(filters),
		enabled: canRead && activeBranchId !== null,
	})

	const shouldProbe =
		onlySuggested &&
		!hasFilters &&
		suggestionsQuery.isSuccess &&
		(suggestionsQuery.data?.totalRows ?? 0) === 0

	// With the switch on, an empty payload cannot say whether the branch has no thresholds or
	// simply nothing to order. One unfiltered probe answers that without changing the main query.
	const probeQuery = useQuery({
		...suggestionsOptions({ ...filters, onlySuggested: false, limit: 1 }),
		enabled: canRead && activeBranchId !== null && shouldProbe,
	})

	const hasThresholds = !shouldProbe
		? true
		: probeQuery.isSuccess
			? (probeQuery.data?.totalRows ?? 0) > 0
			: null

	const data = suggestionsQuery.data
	const headerDescription = data
		? `Branch: ${activeBranch?.name ?? "—"}. Computed from the last ${formatCount(data.settings.velocityDays)} days of sales at this branch, the supplier's lead time, and a ${formatCount(data.settings.safetyDays)}-day safety buffer. Where a supplier has no lead time, ${formatCount(data.settings.defaultLeadDays)} days is assumed.`
		: `Branch: ${activeBranch?.name ?? "—"}. Reading the last sales window, the supplier lead times and the safety buffer.`

	if (!canRead) {
		return (
			<section>
				<p className="text-sm text-muted-foreground">
					You don't have permission to view replenishment suggestions.
				</p>
			</section>
		)
	}

	if (activeBranchId === null) {
		return (
			<section>
				<PageHeader
					title="What to order"
					description="Computed per branch. Choose a branch from the header to see what this branch needs."
				/>
				<p className="text-sm text-muted-foreground">
					Choose a branch from the header to see what to order.
				</p>
			</section>
		)
	}

	return (
		<section>
			<PageHeader title="What to order" description={headerDescription} />

			<div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				<div className="grid gap-1.5">
					<Label>Supplier</Label>
					<SupplierCombobox value={supplier} onSelect={setSupplier} />
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="replenishment-search">Search</Label>
					<div className="relative">
						<SearchIcon
							className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							id="replenishment-search"
							className="pl-8"
							placeholder="Name or SKU…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
					<p className="text-xs text-muted-foreground">Two characters or more.</p>
				</div>

				<div className="flex items-end gap-2 pb-2">
					<Switch
						id="replenishment-only-suggested"
						checked={onlySuggested}
						onCheckedChange={setOnlySuggested}
					/>
					<Label htmlFor="replenishment-only-suggested">Only items that need ordering</Label>
				</div>
			</div>

			<SuggestionsView
				data={data ?? null}
				isLoading={suggestionsQuery.isLoading}
				isError={suggestionsQuery.isError}
				onlySuggested={onlySuggested}
				hasFilters={hasFilters}
				hasThresholds={hasThresholds}
				thresholdsCheckFailed={shouldProbe && probeQuery.isError}
				branchId={activeBranchId}
				canCreate={canCreate}
				canEditLevels={canEditLevels}
				canChooseSupplier={canChooseSupplier}
				computedAt={suggestionsQuery.dataUpdatedAt}
			/>
		</section>
	)
}
