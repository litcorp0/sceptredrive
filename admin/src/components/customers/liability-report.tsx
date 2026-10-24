import { formatCount, formatDay } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import type { LoyaltyLiabilityReport } from "#/modules/loyalty"

const NUMBER_COLUMNS = [
	"earnedPoints",
	"redeemedPoints",
	"clawedBackPoints",
	"adjustedPoints",
	"expiredPoints",
	"netPoints",
] as const

/**
 * Loyalty liability: what the points are worth, what moved per branch, and
 * which customers are in negative territory. The API already applied the
 * viewer's scope; this component only renders it.
 */
export function LiabilityReport({ report }: { report: LoyaltyLiabilityReport }) {
	const { branches } = useBranch()
	const branchName = (branchId: string | null) =>
		branchId === null
			? "Global (expiry)"
			: (branches.find((branch) => branch.id === branchId)?.name ?? "—")
	const branchCode = (branchId: string | null) =>
		branchId === null ? null : (branches.find((branch) => branch.id === branchId)?.code ?? null)

	const { activity } = report
	const totals = Object.fromEntries(
		NUMBER_COLUMNS.map((column) => [
			column,
			activity.rows.reduce((sum, row) => sum + row[column], 0),
		]),
	) as Record<(typeof NUMBER_COLUMNS)[number], number>

	return (
		<div className="grid gap-4">
			<div className="grid gap-4 sm:grid-cols-3">
				<Card>
					<CardHeader>
						<CardDescription>Outstanding points</CardDescription>
						<CardTitle className="text-2xl tabular-nums">
							{formatCount(report.outstandingPoints)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Liability</CardDescription>
						<CardTitle className="text-2xl tabular-nums">
							{formatGhs(report.outstandingValueMinor)}
						</CardTitle>
						<p className="text-xs text-muted-foreground">
							at {formatCount(report.pointsPerCedi)} points = GHS 1.00
						</p>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Expiring in 30 days</CardDescription>
						<CardTitle
							className={
								report.expiringSoonPoints > 0
									? "text-2xl tabular-nums text-amber-700"
									: "text-2xl tabular-nums"
							}
						>
							{formatCount(report.expiringSoonPoints)}
						</CardTitle>
						<p className="text-xs text-muted-foreground">points not yet redeemed or expired</p>
					</CardHeader>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Branch activity</CardTitle>
					<CardDescription>
						{activity.from || activity.to
							? `Entries from ${activity.from ? formatDay(activity.from) : "the beginning"} to ${activity.to ? formatDay(activity.to) : "now"}.`
							: "Every entry on record."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Branch</TableHead>
									<TableHead className="text-right">Earned</TableHead>
									<TableHead className="text-right">Redeemed</TableHead>
									<TableHead className="text-right">Clawed back</TableHead>
									<TableHead className="text-right">Adjusted</TableHead>
									<TableHead className="text-right">Expired</TableHead>
									<TableHead className="text-right">Net</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{activity.rows.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={7}
											className="h-16 text-center text-sm text-muted-foreground"
										>
											No loyalty activity in this range.
										</TableCell>
									</TableRow>
								) : (
									activity.rows.map((row) => (
										<TableRow key={row.branchId ?? "global"}>
											<TableCell>
												{branchName(row.branchId)}
												{branchCode(row.branchId) ? (
													<span className="ml-2 font-mono text-xs text-muted-foreground">
														{branchCode(row.branchId)}
													</span>
												) : null}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.earnedPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.redeemedPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.clawedBackPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.adjustedPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.expiredPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums font-medium">
												{formatCount(row.netPoints)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
							{activity.rows.length > 1 ? (
								<TableFooter>
									<TableRow>
										<TableCell>Total</TableCell>
										{NUMBER_COLUMNS.map((column) => (
											<TableCell key={column} className="text-right tabular-nums">
												{formatCount(totals[column])}
											</TableCell>
										))}
									</TableRow>
								</TableFooter>
							) : null}
						</Table>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Negative balances</CardTitle>
					<CardDescription>
						Clawbacks can take a balance below zero; review these with the customer.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{report.negativeBalances.length === 0 ? (
						<p className="text-sm text-muted-foreground">No negative balances.</p>
					) : (
						<ul className="divide-y rounded-lg border">
							{report.negativeBalances.map((row) => (
								<li
									key={row.customerId}
									className="flex items-center justify-between gap-3 px-3 py-2"
								>
									<div className="min-w-0">
										<Link
											to="/customers/$id"
											params={{ id: row.customerId }}
											className="truncate text-sm font-medium hover:underline"
										>
											{row.customerName}
										</Link>
										<p className="text-xs text-muted-foreground">{branchName(row.branchId)}</p>
									</div>
									<span className="tabular-nums text-sm font-medium text-destructive">
										{formatCount(row.balancePoints)} points
									</span>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
