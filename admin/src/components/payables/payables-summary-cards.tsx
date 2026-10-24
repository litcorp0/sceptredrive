import { formatCount } from "@sceptre/shared"
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"

export function PayablesSummaryCards({
	totalOwedMinor,
	overdueMinor,
	onAccountMinor,
	invoicesOpen,
}: {
	totalOwedMinor: number
	overdueMinor: number
	onAccountMinor: number
	invoicesOpen: number
}) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader>
					<CardDescription>Total owed</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatGhs(totalOwedMinor)}</CardTitle>
					<p className="text-xs text-muted-foreground">outstanding less money on account</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Overdue</CardDescription>
					<CardTitle
						className={
							overdueMinor > 0 ? "text-2xl tabular-nums text-destructive" : "text-2xl tabular-nums"
						}
					>
						{formatGhs(overdueMinor)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">past the due date</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>On account</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatGhs(onAccountMinor)}</CardTitle>
					<p className="text-xs text-muted-foreground">unallocated payments held</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Open invoices</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatCount(invoicesOpen)}</CardTitle>
					<p className="text-xs text-muted-foreground">with an outstanding balance</p>
				</CardHeader>
			</Card>
		</div>
	)
}
