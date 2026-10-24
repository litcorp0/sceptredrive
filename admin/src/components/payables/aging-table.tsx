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
import { formatGhs } from "#/lib/format"
import type { AgingBucketKey, AgingBuckets, PayableAgingSupplier } from "#/modules/payables"

const BUCKETS: Array<{ key: AgingBucketKey; label: string; short: string }> = [
	{ key: "current", label: "Not yet due", short: "Current" },
	{ key: "days1To30", label: "1–30 days past due", short: "1–30" },
	{ key: "days31To60", label: "31–60 days past due", short: "31–60" },
	{ key: "days61To90", label: "61–90 days past due", short: "61–90" },
	{ key: "over90", label: "Over 90 days past due", short: "90+" },
]

const COLUMN_COUNT = BUCKETS.length + 3

/**
 * Payables aging: one row per supplier with fixed due-date buckets as of the
 * chosen day. On-account credit is its own column — never netted into buckets.
 */
export function PayablesAgingTable({
	suppliers,
	totals,
	totalOnAccountMinor,
}: {
	suppliers: PayableAgingSupplier[]
	totals: AgingBuckets
	totalOnAccountMinor: number
}) {
	return (
		<div className="rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Supplier</TableHead>
						{BUCKETS.map((bucket) => (
							<TableHead key={bucket.key} className="w-20 text-right">
								<span title={bucket.label}>{bucket.short}</span>
							</TableHead>
						))}
						<TableHead className="w-28 text-right">On account</TableHead>
						<TableHead className="w-28 text-right">Total owed</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{suppliers.length === 0 ? (
						<TableMessage colSpan={COLUMN_COUNT}>
							No outstanding payables for this selection.
						</TableMessage>
					) : (
						<>
							{suppliers.map((supplier) => (
								<TableRow key={supplier.supplierId}>
									<TableCell>
										<Link
											to="/suppliers/invoices"
											search={{ supplierId: supplier.supplierId }}
											className="font-medium hover:underline"
										>
											{supplier.supplierName}
										</Link>
										<p className="text-xs text-muted-foreground">
											<span className="font-mono">{supplier.supplierCode}</span>
											{" · "}
											<Link
												to="/suppliers/$supplierId"
												params={{ supplierId: supplier.supplierId }}
												className="hover:underline"
											>
												Detail
											</Link>
										</p>
									</TableCell>
									{BUCKETS.map((bucket) => (
										<TableCell key={bucket.key} className="text-right tabular-nums">
											{supplier.buckets[bucket.key] === 0 ? (
												<span className="text-muted-foreground">—</span>
											) : (
												formatGhs(supplier.buckets[bucket.key])
											)}
										</TableCell>
									))}
									<TableCell className="text-right tabular-nums">
										{supplier.onAccountMinor === 0 ? (
											<span className="text-muted-foreground">—</span>
										) : (
											formatGhs(supplier.onAccountMinor)
										)}
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{formatGhs(supplier.totalOutstandingMinor - supplier.onAccountMinor)}
									</TableCell>
								</TableRow>
							))}
							<TableRow className="bg-muted/40 font-medium">
								<TableCell>Total</TableCell>
								{BUCKETS.map((bucket) => (
									<TableCell key={bucket.key} className="text-right tabular-nums">
										{totals[bucket.key] === 0 ? (
											<span className="text-muted-foreground">—</span>
										) : (
											formatGhs(totals[bucket.key])
										)}
									</TableCell>
								))}
								<TableCell className="text-right tabular-nums">
									{totalOnAccountMinor === 0 ? (
										<span className="text-muted-foreground">—</span>
									) : (
										formatGhs(totalOnAccountMinor)
									)}
								</TableCell>
								<TableCell className="text-right font-semibold tabular-nums">
									{formatGhs(
										suppliers.reduce(
											(sum, supplier) =>
												sum + supplier.totalOutstandingMinor - supplier.onAccountMinor,
											0,
										),
									)}
								</TableCell>
							</TableRow>
						</>
					)}
				</TableBody>
			</Table>
		</div>
	)
}
