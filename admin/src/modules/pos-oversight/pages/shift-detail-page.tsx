import { formatCount, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeft, FileQuestion, ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
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
import { formatGhs } from "#/lib/format"
import { shiftOptions } from "../api/oversight"
import type { OversightShiftDetail, ShiftReportView } from "../types"
import {
	reviewStatusLabel,
	reviewStatusTone,
	shiftStatusTone,
	signedMoney,
	varianceTone,
} from "../utils/labels"

const routeApi = getRouteApi("/_authenticated/pos/shifts/$shiftId")

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-3">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="text-right tabular-nums">{value}</dd>
		</div>
	)
}

/**
 * A shift and the document it produced.
 *
 * A closed shift shows the **stored Z** and refuses to rebuild it; an open shift shows a
 * live X. `reportState: 'MISSING'` is a fact about the snapshot, not an error: the page
 * says the Z is absent instead of failing the screen a manager opened to find out.
 */
export function ShiftDetailPage() {
	const { shiftId } = routeApi.useParams()
	const shiftQuery = useQuery({ ...shiftOptions(shiftId), retry: false })

	const error = shiftQuery.error instanceof ApiError ? shiftQuery.error : null
	const denied = error?.status === 403
	const missing = error?.status === 404

	return (
		<div className="grid gap-4">
			<div className="min-w-0">
				<Button variant="ghost" size="sm" className="-ml-2 mb-1" asChild>
					<Link to="/pos" search={{ tab: "shifts" }}>
						<ArrowLeft aria-hidden="true" className="size-4" />
						Shifts
					</Link>
				</Button>
				<h2 className="font-display text-xl tracking-[-0.015em]">
					{shiftQuery.data ? shiftQuery.data.shift.number : "Shift"}
				</h2>
				{shiftQuery.data ? (
					<p className="mt-1 text-sm text-muted-foreground">
						{shiftQuery.data.shift.branchName} · {shiftQuery.data.shift.terminalCode} ·{" "}
						{shiftQuery.data.shift.cashierName}
					</p>
				) : null}
			</div>

			{shiftQuery.isLoading ? (
				<div className="grid gap-3" aria-busy="true">
					<output className="sr-only">Loading the shift</output>
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see this shift"
					description="It belongs to a branch your role does not cover. The API refuses the read; the console does not guess at the answer."
				/>
			) : missing ? (
				<EmptyState
					icon={FileQuestion}
					title="Shift not found"
					description="It may have been removed, or the link may be wrong. Return to the shift list to find the drawer."
				/>
			) : shiftQuery.isError || !shiftQuery.data ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">Couldn't load this shift.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The server did not answer. Try again in a moment.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void shiftQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<ShiftDocument detail={shiftQuery.data} />
			)}
		</div>
	)
}

function ShiftDocument({ detail }: { detail: OversightShiftDetail }) {
	const { shift, report, reportState, voids } = detail

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Shift</CardTitle>
					<CardDescription>The drawer document, as the server stores it.</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
						<div className="flex justify-between gap-3">
							<dt className="text-muted-foreground">Status</dt>
							<dd>
								<StatusBadge variant={shiftStatusTone(shift.status)}>
									{shift.status === "OPEN" ? "Open" : "Closed"}
								</StatusBadge>
							</dd>
						</div>
						<div className="flex justify-between gap-3">
							<dt className="text-muted-foreground">Review</dt>
							<dd>
								<StatusBadge variant={reviewStatusTone(shift.reviewStatus)}>
									{reviewStatusLabel(shift.reviewStatus)}
								</StatusBadge>
							</dd>
						</div>
						<Fact label="Opened" value={formatDateTime(shift.openedAt)} />
						<Fact
							label="Closed"
							value={shift.closedAt ? formatDateTime(shift.closedAt) : "Still open"}
						/>
						<Fact label="Opening float" value={formatGhs(shift.openingFloatMinor)} />
						<Fact
							label="Expected cash"
							value={
								shift.serverExpectedCashMinor === null
									? "—"
									: formatGhs(shift.serverExpectedCashMinor)
							}
						/>
						<Fact
							label="Counted cash"
							value={
								shift.countedCashMinor === null ? "Not counted" : formatGhs(shift.countedCashMinor)
							}
						/>
						<div className="flex justify-between gap-3">
							<dt className="text-muted-foreground">Variance</dt>
							<dd className="text-right">
								{shift.varianceMinor === null ? (
									"—"
								) : (
									<StatusBadge variant={varianceTone(shift.varianceMinor)}>
										{signedMoney(shift.varianceMinor)}
									</StatusBadge>
								)}
							</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

			{reportState === "MISSING" ? (
				<Card>
					<CardHeader>
						<CardTitle>Stored Z is missing</CardTitle>
						<CardDescription>
							This shift was closed but its report snapshot is not present. The console does not
							rebuild a Z from live rows: the report route refuses that on request, and the paper on
							the desk is the authority until the snapshot is restored.
						</CardDescription>
					</CardHeader>
				</Card>
			) : report ? (
				<ShiftReport report={report} reportState={reportState} />
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Abandoned carts</CardTitle>
					<CardDescription>
						{formatCount(voids.count)} carts · {formatCount(voids.itemCount)} items ·{" "}
						{formatGhs(voids.grossMinor)} at the till
					</CardDescription>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<Table>
						<caption className="sr-only">Carts abandoned before they became sales</caption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">When</TableHead>
								<TableHead scope="col">Cashier</TableHead>
								<TableHead scope="col">Reason</TableHead>
								<TableHead scope="col">Note</TableHead>
								<TableHead scope="col" className="text-right">
									Items
								</TableHead>
								<TableHead scope="col" className="text-right">
									Value
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{voids.rows.length === 0 ? (
								<TableMessage colSpan={6} state="empty">
									No carts were abandoned on this shift.
								</TableMessage>
							) : (
								voids.rows.map((voidRow) => (
									<TableRow key={voidRow.id}>
										<TableCell className="text-muted-foreground">
											<time dateTime={voidRow.occurredAt}>
												{formatDateTime(voidRow.occurredAt)}
											</time>
										</TableCell>
										<TableCell className="max-w-36 truncate">{voidRow.cashierName}</TableCell>
										<TableCell>{voidRow.reasonLabel}</TableCell>
										<TableCell className="max-w-56 truncate text-muted-foreground">
											{voidRow.label ?? "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatCount(voidRow.itemCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(voidRow.grossMinor)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	)
}

function ShiftReport({
	report,
	reportState,
}: {
	report: ShiftReportView
	reportState: OversightShiftDetail["reportState"]
}) {
	const stored = reportState === "STORED"

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{report.kind === "Z" ? "Z report" : "X report"}
					<StatusBadge variant={stored ? "muted" : "info"}>
						{stored ? "Stored snapshot" : "Live"}
					</StatusBadge>
				</CardTitle>
				<CardDescription>
					{formatDateTime(report.generatedAt)} ·{" "}
					{report.closedAt
						? `closed ${formatDateTime(report.closedAt)}`
						: "still open at the terminal"}
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-2">
				<section className="grid gap-1.5" aria-labelledby="report-sales-heading">
					<h3 id="report-sales-heading" className="font-medium">
						Sales
					</h3>
					<dl className="grid gap-1 text-sm">
						<Fact label="Sales" value={formatCount(report.saleCount)} />
						<Fact label="Items" value={formatCount(report.itemCount)} />
						<Fact label="Gross" value={formatGhs(report.grossMinor)} />
						<Fact label="Refunds" value={formatCount(report.refundCount)} />
						<Fact label="Refunded" value={formatGhs(report.refundMinor)} />
						<Fact label="Voided carts" value={formatCount(report.voidCount)} />
						<Fact label="Net" value={formatGhs(report.netMinor)} />
					</dl>
				</section>

				<section className="grid gap-1.5" aria-labelledby="report-tax-heading">
					<h3 id="report-tax-heading" className="font-medium">
						Tax
					</h3>
					<dl className="grid gap-1 text-sm">
						<Fact label="Taxable base" value={formatGhs(report.baseMinor)} />
						<Fact label="VAT" value={formatGhs(report.vatMinor)} />
						<Fact label="NHIL" value={formatGhs(report.nhilMinor)} />
						<Fact label="GETFund" value={formatGhs(report.getfundMinor)} />
						<Fact label="Tax total" value={formatGhs(report.taxTotalMinor)} />
					</dl>
				</section>

				<section className="grid gap-1.5" aria-labelledby="report-tenders-heading">
					<h3 id="report-tenders-heading" className="font-medium">
						Tenders
					</h3>
					<dl className="grid gap-1 text-sm">
						<Fact label="Cash" value={formatGhs(report.cashMinor)} />
						<Fact label="Credit" value={formatGhs(report.creditMinor)} />
						<Fact label="MoMo" value={formatGhs(report.momoMinor)} />
						<Fact label="Card" value={formatGhs(report.cardMinor)} />
						<Fact label="Bank transfer" value={formatGhs(report.bankTransferMinor)} />
						<Fact label="Change" value={formatGhs(report.changeMinor)} />
					</dl>
				</section>

				<section className="grid gap-1.5" aria-labelledby="report-drawer-heading">
					<h3 id="report-drawer-heading" className="font-medium">
						Drawer
					</h3>
					<dl className="grid gap-1 text-sm">
						<Fact label="Opening float" value={formatGhs(report.openingFloatMinor)} />
						<Fact label="Cash in" value={formatGhs(report.cashInMinor)} />
						<Fact label="Cash out" value={formatGhs(report.cashOutMinor)} />
						<Fact
							label="Cash refunds"
							value={
								report.cashRefundMinor === null ? "Not itemised" : formatGhs(report.cashRefundMinor)
							}
						/>
						<Fact
							label="Credit repaid (cash)"
							value={
								report.cashRepaymentMinor === null
									? "Not itemised"
									: formatGhs(report.cashRepaymentMinor)
							}
						/>
						<Fact label="Expected cash" value={formatGhs(report.expectedCashMinor)} />
						<Fact
							label="Counted cash"
							value={
								report.countedCashMinor === null
									? "Not counted"
									: formatGhs(report.countedCashMinor)
							}
						/>
						<div className="flex justify-between gap-3">
							<dt className="text-muted-foreground">Variance</dt>
							<dd className="text-right">
								{report.varianceMinor === null ? (
									"—"
								) : (
									<StatusBadge variant={varianceTone(report.varianceMinor)}>
										{signedMoney(report.varianceMinor)}
									</StatusBadge>
								)}
							</dd>
						</div>
					</dl>
					{report.cashRefundMinor === null ? (
						<p className="text-xs text-muted-foreground">
							This Z predates the cash-refund column, so the figure is not itemised rather than
							invented.
						</p>
					) : null}
					{report.cashRepaymentMinor === null ? (
						<p className="text-xs text-muted-foreground">
							This Z predates the credit-repayment column, so cash taken against credit is not
							itemised here. Its expected cash may read high by exactly that amount.
						</p>
					) : null}
				</section>
			</CardContent>
		</Card>
	)
}
