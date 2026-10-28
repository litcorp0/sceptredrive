import { formatCount, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
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
import { branchLabelFor } from "#/lib/branch-label"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { settingsListOptions } from "#/modules/settings"
import { transferReconciliationOptions } from "../api/payables"
import type {
	ReconciliationState,
	TransferReconciliationResult,
	TransferReconciliationRow,
} from "../types"
import { readFlag } from "../utils/flags"
import type { ReconciliationSearch } from "../utils/transfer-search"

const authenticatedRoute = getRouteApi("/_authenticated")
const reconciliationRoute = getRouteApi("/_authenticated/suppliers/reconciliation")

const STATE_LABELS: Record<ReconciliationState, string> = {
	manual: "Manual",
	settled: "Settled",
	unposted: "Unposted",
}

const STATE_VARIANTS = {
	manual: "muted",
	settled: "ok",
	unposted: "danger",
} as const

/**
 * Money out, and what happened to it.
 *
 * Three states in one table: a manual payment with no transfer, a transfer with the payment it
 * posted, and money that left the balance without a payment (or a transfer that failed before
 * it did). The figures and every state are the API's; the console filters rows and formats money.
 *
 * The totals always describe the whole period. Filtering to one state narrows the table and
 * says so, because a headline that quietly changed with a row filter would be a second ledger.
 */
export function ReconciliationPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const search = reconciliationRoute.useSearch()
	const navigate = reconciliationRoute.useNavigate()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	const canRead = hasPermission(session.user.role, "payable.read")
	const settingsQuery = useQuery(settingsListOptions())
	const transfersEnabled = readFlag(settingsQuery.data?.settings, "flag.supplierTransfers")

	const requestedBranch = canSelectBranch ? search.branchId : undefined
	const branchId =
		requestedBranch === "ALL" ? undefined : (requestedBranch ?? activeBranchId ?? undefined)

	const reportQuery = useQuery(
		transferReconciliationOptions({ branchId, from: search.from, to: search.to }),
	)
	const denied = reportQuery.error instanceof ApiError && reportQuery.error.status === 403
	const requestId = reportQuery.error instanceof ApiError ? reportQuery.error.requestId : undefined

	const report = reportQuery.data
	const rows = report?.rows ?? []
	const visible = search.state ? rows.filter((row) => row.state === search.state) : rows
	const columns = canSelectBranch ? 9 : 8

	function updateSearch(patch: Partial<ReconciliationSearch>) {
		void navigate({ search: (prev: ReconciliationSearch) => ({ ...prev, ...patch }) })
	}

	if (!canRead) {
		return (
			<div className="grid gap-4">
				<PageHeader eyebrow="Suppliers" title="Transfer reconciliation" />
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see the reconciliation"
					description="This screen needs payable.read. Ask an administrator if you need access."
				/>
			</div>
		)
	}

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Suppliers"
				title="Transfer reconciliation"
				description="Manual payments, settled transfers and money that left the provider balance but did not post — in one list, for one period."
			/>

			{!transfersEnabled ? (
				<output className="block rounded-md border border-dashed p-3 text-sm text-muted-foreground">
					Supplier transfers are switched off in settings. This view still shows what already
					happened.
				</output>
			) : null}

			{denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see this period"
					description="A transfer must belong to a branch you can read. Ask an administrator if you need access."
				/>
			) : (
				<>
					<ReconciliationTiles
						report={report}
						isLoading={reportQuery.isLoading}
						isError={reportQuery.isError}
					/>

					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<div className="grid gap-1.5">
							<Label htmlFor="reconciliation-state">State</Label>
							<Select
								value={search.state ?? "ALL"}
								onValueChange={(value) =>
									updateSearch({
										state: value === "ALL" ? undefined : (value as ReconciliationState),
									})
								}
							>
								<SelectTrigger id="reconciliation-state" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ALL">Every state</SelectItem>
									<SelectItem value="manual">Manual</SelectItem>
									<SelectItem value="settled">Settled</SelectItem>
									<SelectItem value="unposted">Unposted</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="reconciliation-branch">Branch</Label>
								<Select
									value={search.branchId ?? (activeBranchId === null ? "ALL" : activeBranchId)}
									onValueChange={(value) =>
										updateSearch({ branchId: value === "ALL" ? "ALL" : value })
									}
								>
									<SelectTrigger id="reconciliation-branch" className="w-full">
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

						<div className="grid gap-1.5">
							<Label htmlFor="reconciliation-from">Period</Label>
							<div className="flex items-center gap-1.5">
								<Input
									id="reconciliation-from"
									type="date"
									value={search.from ?? ""}
									onChange={(event) => updateSearch({ from: event.target.value || undefined })}
									aria-label="Period from"
								/>
								<Input
									type="date"
									value={search.to ?? ""}
									onChange={(event) => updateSearch({ to: event.target.value || undefined })}
									aria-label="Period to"
								/>
							</div>
						</div>
					</div>

					{search.state ? (
						<p className="text-xs text-muted-foreground">
							Showing {STATE_LABELS[search.state].toLowerCase()} rows only. The totals above cover
							the whole period.
						</p>
					) : null}

					<div className="rounded-lg border bg-card">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-24">State</TableHead>
									<TableHead>Supplier</TableHead>
									{canSelectBranch ? <TableHead className="w-24">Branch</TableHead> : null}
									<TableHead>Reference</TableHead>
									<TableHead className="w-28 text-right">Money out</TableHead>
									<TableHead className="w-32 text-right">Posted</TableHead>
									<TableHead className="w-28 text-right">Not allocated</TableHead>
									<TableHead className="w-36">When</TableHead>
									<TableHead className="w-40">Outcome</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{reportQuery.isLoading ? (
									<TableMessage colSpan={columns} state="loading" rows={6}>
										Loading the reconciliation…
									</TableMessage>
								) : reportQuery.isError ? (
									<TableMessage colSpan={columns} state="error">
										Couldn&rsquo;t load the reconciliation.
										{requestId ? ` Request ${requestId}.` : ""}
									</TableMessage>
								) : visible.length === 0 ? (
									<TableMessage colSpan={columns}>
										Nothing in this period matches these filters.
									</TableMessage>
								) : (
									visible.map((row) => (
										<ReconciliationTableRow
											key={`${row.state}-${row.transferId ?? row.paymentId ?? row.reference}`}
											row={row}
											showBranch={canSelectBranch}
											branchLabel={branchLabelFor(branches, { id: row.branchId })}
										/>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</>
			)}
		</div>
	)
}

function ReconciliationTiles({
	report,
	isLoading,
	isError,
}: {
	report: TransferReconciliationResult | undefined
	isLoading: boolean
	isError: boolean
}) {
	if (isLoading) {
		return (
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-busy="true">
				<output className="sr-only">Loading the reconciliation totals</output>
				{["settled", "manual", "unposted", "failed", "reversed"].map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-7 w-24" />
						</CardHeader>
					</Card>
				))}
			</div>
		)
	}

	if (isError || !report) {
		return (
			<p role="alert" className="text-sm text-destructive">
				The reconciliation totals are unavailable.
			</p>
		)
	}

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<Card>
				<CardHeader>
					<CardDescription>Settled</CardDescription>
					<CardTitle className="text-2xl tabular-nums">
						{formatGhs(report.totals.settledMinor)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">transfers with a posted payment</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Manual</CardDescription>
					<CardTitle className="text-2xl tabular-nums">
						{formatGhs(report.totals.manualMinor)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">recorded by hand, no transfer</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Unposted</CardDescription>
					<CardTitle
						className={
							report.totals.unpostedMinor > 0
								? "text-2xl tabular-nums text-destructive"
								: "text-2xl tabular-nums"
						}
					>
						{formatGhs(report.totals.unpostedMinor)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">left the balance, no payment</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Failed</CardDescription>
					<CardTitle className="text-2xl tabular-nums">
						{formatCount(report.totals.failedCount)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">nothing moved</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Reversed</CardDescription>
					<CardTitle className="text-2xl tabular-nums">
						{formatCount(report.totals.reversedCount)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">money returned</p>
				</CardHeader>
			</Card>
		</div>
	)
}

function ReconciliationTableRow({
	row,
	showBranch,
	branchLabel,
}: {
	row: TransferReconciliationRow
	showBranch: boolean
	branchLabel: string
}) {
	const reversedWithPayment = row.status === "REVERSED" && row.paymentId !== null
	const successWithoutPayment = row.status === "SUCCESS" && row.paymentId === null

	return (
		<TableRow className={row.attention ? "bg-destructive/5" : undefined}>
			<TableCell>
				<StatusBadge variant={STATE_VARIANTS[row.state]}>{STATE_LABELS[row.state]}</StatusBadge>
			</TableCell>
			<TableCell className="max-w-44">
				<Link
					to="/suppliers/$supplierId"
					params={{ supplierId: row.supplierId }}
					className="block truncate hover:underline"
				>
					{row.supplierName}
				</Link>
			</TableCell>
			{showBranch ? <TableCell className="text-muted-foreground">{branchLabel}</TableCell> : null}
			<TableCell>
				{row.transferId ? (
					<Link
						to="/suppliers/transfers/$transferId"
						params={{ transferId: row.transferId }}
						className="font-mono text-xs font-medium hover:underline"
					>
						{row.reference}
					</Link>
				) : row.paymentId ? (
					<Link
						to="/suppliers/payments/$paymentId"
						params={{ paymentId: row.paymentId }}
						className="font-mono text-xs font-medium hover:underline"
					>
						{row.reference}
					</Link>
				) : (
					<span className="font-mono text-xs">{row.reference}</span>
				)}
				{reversedWithPayment ? (
					<p className="mt-1 text-xs text-destructive">
						The money returned. The payment stands until somebody voids it.{" "}
						{row.paymentId ? (
							<Link
								to="/suppliers/payments/$paymentId"
								params={{ paymentId: row.paymentId }}
								className="underline"
							>
								Open the payment to void it
							</Link>
						) : null}
					</p>
				) : null}
				{successWithoutPayment ? (
					<p className="mt-1 text-xs text-destructive">
						Succeeded without a payment — investigate; do not record one by hand.
					</p>
				) : null}
			</TableCell>
			<TableCell className="text-right tabular-nums">{formatGhs(row.amountMinor)}</TableCell>
			<TableCell className="text-right tabular-nums">
				{row.paymentAmountMinor === null ? (
					<span className="text-muted-foreground">—</span>
				) : (
					formatGhs(row.paymentAmountMinor)
				)}
				{row.feeMinor !== null ? (
					<span className="mt-1 block text-xs text-muted-foreground">
						Fee {formatGhs(row.feeMinor)} (not netted)
					</span>
				) : null}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{row.unallocatedMinor > 0 ? (
					formatGhs(row.unallocatedMinor)
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</TableCell>
			<TableCell className="text-muted-foreground">{formatDateTime(row.occurredAt)}</TableCell>
			<TableCell className="text-xs text-muted-foreground">
				{row.failureCode ? <span className="font-mono">{row.failureCode}</span> : null}
				{row.failureCode && row.failureMessage ? " · " : null}
				{row.failureMessage ?? (row.status === null ? "Recorded by hand" : "—")}
			</TableCell>
		</TableRow>
	)
}
