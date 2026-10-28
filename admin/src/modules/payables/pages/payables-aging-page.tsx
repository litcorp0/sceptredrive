import { formatDay, toDateInputValue } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { ExportButton } from "#/components/common/export-button"
import { PrintButton } from "#/components/common/print-button"
import { PrintSheet } from "#/components/common/print-sheet"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { payablesAgingOptions } from "../api/payables"
import { PayablesAgingTable } from "../components/aging-table"
import { PayablesSummaryCards } from "../components/payables-summary-cards"
import type { AgingBuckets } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const EMPTY_BUCKETS: AgingBuckets = {
	current: 0,
	days1To30: 0,
	days31To60: 0,
	days61To90: 0,
	over90: 0,
}

const OVERDUE_KEYS = ["days1To30", "days31To60", "days61To90", "over90"] as const

/**
 * Payables aging as of a chosen day. Managers see their branch; admins pick a
 * branch or all of them. On-account credit never nets into the buckets.
 */
export function PayablesAgingPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	// undefined follows the header branch switcher; null means all branches.
	const [branchChoice, setBranchChoice] = useState<string | null | undefined>(undefined)
	const [asOf, setAsOf] = useState(() => toDateInputValue(new Date()))
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)

	const effectiveBranchId = canSelectBranch
		? branchChoice === undefined
			? activeBranchId
			: branchChoice
		: (session.user.branchId ?? null)

	const agingQuery = useQuery(payablesAgingOptions(effectiveBranchId, asOf, supplier?.id ?? null))

	const aging = agingQuery.data
	const totals = aging?.totals ?? EMPTY_BUCKETS
	const totalOutstandingMinor = aging?.totalOutstandingMinor ?? 0
	const totalOnAccountMinor = aging?.totalOnAccountMinor ?? 0
	const overdueMinor = OVERDUE_KEYS.reduce((sum, key) => sum + totals[key], 0)
	const invoicesOpen = (aging?.suppliers ?? []).reduce(
		(sum, supplierRow) => sum + supplierRow.invoices.length,
		0,
	)

	const errorMessage =
		agingQuery.error instanceof ApiError
			? agingQuery.error.message
			: "Couldn't load the payables aging report."

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-end gap-3 print:hidden">
				<div className="grid gap-1.5">
					<Label htmlFor="payables-aging-asof" className="text-xs text-muted-foreground">
						As of
					</Label>
					<Input
						id="payables-aging-asof"
						type="date"
						className="w-44"
						value={asOf}
						onChange={(event) => setAsOf(event.target.value)}
					/>
				</div>

				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="payables-aging-branch" className="text-xs text-muted-foreground">
							Branch
						</Label>
						<Select
							value={effectiveBranchId ?? "ALL"}
							onValueChange={(value) => setBranchChoice(value === "ALL" ? null : value)}
						>
							<SelectTrigger id="payables-aging-branch" className="w-52">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ALL">All branches</SelectItem>
								{branches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : null}

				<div className="grid w-64 gap-1.5">
					<Label className="text-xs text-muted-foreground">Supplier</Label>
					<SupplierCombobox value={supplier} onSelect={setSupplier} />
				</div>

				{supplier ? (
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto px-0 pb-2 text-muted-foreground"
						onClick={() => setSupplier(null)}
					>
						Clear supplier
					</Button>
				) : null}

				<div className="ml-auto flex gap-2 pb-1">
					<ExportButton
						path="/api/payables/aging/export"
						query={{
							branchId: effectiveBranchId ?? undefined,
							asOf: asOf || undefined,
							supplierId: supplier?.id,
						}}
						label="Payables aging"
						disabled={!aging}
					/>
					<PrintButton label="payables aging" disabled={!aging} />
				</div>
			</div>

			<PrintSheet
				title="Payables aging"
				meta={[
					{
						label: "Branch",
						value:
							branches.find((branch) => branch.id === effectiveBranchId)?.name ?? "All branches",
					},
					{ label: "As at", value: formatDay(aging?.asOf ?? asOf) },
					{
						label: "Supplier",
						value: supplier ? `${supplier.name} (${supplier.code})` : "All suppliers",
					},
				]}
			/>

			{agingQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading payables aging…</p>
			) : agingQuery.isError ? (
				<p className="text-sm text-destructive">{errorMessage}</p>
			) : (
				<>
					<PayablesSummaryCards
						totalOwedMinor={totalOutstandingMinor - totalOnAccountMinor}
						overdueMinor={overdueMinor}
						onAccountMinor={totalOnAccountMinor}
						invoicesOpen={invoicesOpen}
					/>
					<PayablesAgingTable
						suppliers={aging?.suppliers ?? []}
						totals={totals}
						totalOnAccountMinor={totalOnAccountMinor}
					/>
				</>
			)}
		</div>
	)
}
