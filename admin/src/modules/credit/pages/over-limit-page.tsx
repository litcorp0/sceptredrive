import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Users } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { TableMessage } from "#/components/common/table-message"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { overLimitListOptions } from "../api/credit"
import type { OverLimitSearch } from "../utils/credit"

const routeApi = getRouteApi("/_authenticated/customers/over-limit")
const PAGE_SIZE = 25
const ALL = "all"

/**
 * Customers whose balance is above their credit limit.
 *
 * The excess is the API's `overByMinor`, computed from the append-only ledger; the console only
 * formats it. This is the list behind the operations page's card, and Plan 12 extends it with the
 * limit-change form — the link to the customer profile is where a manager acts today.
 */
export function OverLimitPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { branches, canSelectBranch } = useBranch()
	const offset = search.offset ?? 0

	const customersQuery = useQuery(
		overLimitListOptions({ branchId: search.branchId, limit: PAGE_SIZE, offset }),
	)
	const denied = customersQuery.error instanceof ApiError && customersQuery.error.status === 403
	const rows = customersQuery.data?.customers ?? []
	const total = customersQuery.data?.total ?? 0

	function patch(next: Partial<OverLimitSearch>) {
		void navigate({ search: (prev: OverLimitSearch) => ({ ...prev, ...next }) })
	}

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Customers"
				title="Over the credit limit"
				description="Customers who already owe more than their limit. A limit change is an approval, decided like every other request."
			/>

			{denied ? (
				<EmptyState
					icon={Users}
					title="You cannot see credit limits"
					description="Your role does not include credit.read. Ask an administrator if you should be able to review this branch's exposure."
				/>
			) : (
				<>
					{canSelectBranch ? (
						<div className="flex flex-wrap items-end gap-3">
							<div className="grid gap-1.5">
								<Label htmlFor="over-limit-branch" className="text-xs text-muted-foreground">
									Branch
								</Label>
								<Select
									value={search.branchId ?? ALL}
									onValueChange={(value) =>
										patch({
											branchId: value === ALL ? undefined : value,
											offset: undefined,
										})
									}
								>
									<SelectTrigger id="over-limit-branch" className="w-52">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ALL}>All branches</SelectItem>
										{branches.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					) : null}

					<div className="min-w-0 rounded-md border">
						<Table className="min-w-[52rem]">
							<TableHeader>
								<TableRow>
									<TableHead>Customer</TableHead>
									<TableHead>Branch</TableHead>
									<TableHead>Phone</TableHead>
									<TableHead className="text-right">Limit</TableHead>
									<TableHead className="text-right">Balance</TableHead>
									<TableHead className="text-right">Over by</TableHead>
									<TableHead className="w-16" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{customersQuery.isLoading ? (
									<TableMessage colSpan={7} state="loading" rows={5}>
										Loading customers…
									</TableMessage>
								) : customersQuery.isError ? (
									<TableMessage colSpan={7} state="error">
										Couldn't load over-limit customers.
									</TableMessage>
								) : rows.length === 0 ? (
									<TableMessage colSpan={7} state="empty">
										No customer is over their limit in this branch.
									</TableMessage>
								) : (
									rows.map((row) => (
										<TableRow key={`${row.customerId}:${row.branchId}`}>
											<TableCell className="font-medium">{row.customerName}</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{branches.find((branch) => branch.id === row.branchId)?.name ?? "Branch"}
											</TableCell>
											<TableCell className="text-muted-foreground">{row.phone ?? "—"}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.limitMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.balanceMinor)}
											</TableCell>
											<TableCell className="text-right font-medium tabular-nums">
												{formatGhs(row.overByMinor)}
											</TableCell>
											<TableCell>
												<Link
													to="/customers/$id"
													params={{ id: row.customerId }}
													className="text-sm font-medium text-primary hover:underline"
													aria-label={`View ${row.customerName}`}
												>
													View
												</Link>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{customersQuery.isSuccess ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={offset}
							onOffsetChange={(next) => patch({ offset: next === 0 ? undefined : next })}
						/>
					) : null}
				</>
			)}
		</div>
	)
}
