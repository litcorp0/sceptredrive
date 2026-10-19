import { Link } from "@tanstack/react-router"
import { TableMessage } from "#/components/common/table-message"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import type { BranchAging } from "#/lib/api-types"
import { AGING_BUCKET_KEYS, AGING_BUCKET_LABELS, AGING_BUCKET_SHORT } from "#/lib/credit"
import { formatDay, formatGhs } from "#/lib/format"

const COLUMN_COUNT = AGING_BUCKET_KEYS.length + 3

/**
 * One branch's aging report. Buckets come from the server (fixed ranges from
 * each charge's due date); zero cells are muted dashes so the eye lands on real
 * money. Manager view: one branch. Admin: one per branch, or one per selected.
 */
export function AgingTable({ branch, asOf }: { branch: BranchAging; asOf: string }) {
	return (
		<div className="rounded-lg border bg-card">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
				<p className="font-medium">
					{branch.branch.name}
					<span className="ml-2 font-mono text-xs text-muted-foreground">{branch.branch.code}</span>
				</p>
				<p className="text-sm">
					<span className="text-muted-foreground">Outstanding: </span>
					<span className="font-semibold tabular-nums">{formatGhs(branch.totals.total)}</span>
				</p>
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Customer</TableHead>
						{AGING_BUCKET_KEYS.map((key) => (
							<TableHead key={key} className="w-20 text-right">
								<span title={AGING_BUCKET_LABELS[key]}>{AGING_BUCKET_SHORT[key]}</span>
							</TableHead>
						))}
						<TableHead className="w-24 text-right">Total</TableHead>
						<TableHead className="w-28">Oldest due</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{branch.customers.length === 0 ? (
						<TableMessage colSpan={COLUMN_COUNT}>
							No outstanding credit as of {formatDay(asOf)}.
						</TableMessage>
					) : (
						<>
							{branch.customers.map((customer) => (
								<TableRow key={customer.customerId}>
									<TableCell>
										<Link
											to="/customers/$id"
											params={{ id: customer.customerId }}
											className="font-medium hover:underline"
										>
											{customer.customerName}
										</Link>
									</TableCell>
									{AGING_BUCKET_KEYS.map((key) => (
										<TableCell key={key} className="text-right tabular-nums">
											{customer.buckets[key] === 0 ? (
												<span className="text-muted-foreground">—</span>
											) : (
												formatGhs(customer.buckets[key])
											)}
										</TableCell>
									))}
									<TableCell className="text-right font-medium tabular-nums">
										{formatGhs(customer.totalMinor)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{customer.oldestDueDate ? formatDay(customer.oldestDueDate) : "—"}
									</TableCell>
								</TableRow>
							))}
							<TableRow className="bg-muted/40 font-medium">
								<TableCell>Total</TableCell>
								{AGING_BUCKET_KEYS.map((key) => (
									<TableCell key={key} className="text-right tabular-nums">
										{branch.totals[key] === 0 ? (
											<span className="text-muted-foreground">—</span>
										) : (
											formatGhs(branch.totals[key])
										)}
									</TableCell>
								))}
								<TableCell className="text-right font-semibold tabular-nums">
									{formatGhs(branch.totals.total)}
								</TableCell>
								<TableCell />
							</TableRow>
						</>
					)}
				</TableBody>
			</Table>
		</div>
	)
}
