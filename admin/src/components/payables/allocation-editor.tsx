import { formatDay, toDateInputValue } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { WandSparklesIcon } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { paymentOutstandingOptions, type SupplierInvoice } from "#/modules/payables"

/** invoiceId -> GHS amount string as typed by the operator. */
export type AllocationDraft = Record<string, string>

function utcMidnight(isoDay: string): number {
	const [year, month, day] = isoDay.split("-").map(Number)
	return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

function daysOverdue(dueDate: string, today: string): number {
	return Math.floor((utcMidnight(today) - utcMidnight(dueDate)) / 86_400_000)
}

function sortedByOldest(invoices: SupplierInvoice[]): SupplierInvoice[] {
	return [...invoices].sort(
		(a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number),
	)
}

export function allocationDraftsTotal(allocations: AllocationDraft): number {
	return Object.values(allocations).reduce((sum, value) => sum + (parseGhsToMinor(value) ?? 0), 0)
}

export function allocationDraftInputs(
	allocations: AllocationDraft,
): Array<{ invoiceId: string; amountMinor: number }> {
	return Object.entries(allocations)
		.map(([invoiceId, value]) => ({ invoiceId, amountMinor: parseGhsToMinor(value) ?? 0 }))
		.filter((row) => row.amountMinor > 0)
}

export function AllocationEditor({
	supplierId,
	branchId,
	paymentAmountMinor,
	allocations,
	onChange,
}: {
	supplierId: string | null
	branchId: string | null
	paymentAmountMinor: number
	allocations: AllocationDraft
	onChange: (next: AllocationDraft) => void
}) {
	const today = toDateInputValue(new Date())

	const invoicesQuery = useQuery(paymentOutstandingOptions(supplierId, branchId))

	const invoices = sortedByOldest(
		(invoicesQuery.data?.invoices ?? []).filter((invoice) => invoice.outstandingMinor > 0),
	)
	const allocatedMinor = allocationDraftsTotal(allocations)
	const onAccountMinor = Math.max(paymentAmountMinor - allocatedMinor, 0)
	const overAllocated = allocatedMinor > paymentAmountMinor

	function allocateOldestFirst() {
		let remaining = paymentAmountMinor
		const next: AllocationDraft = {}
		for (const invoice of invoices) {
			if (remaining <= 0) break
			const amount = Math.min(invoice.outstandingMinor, remaining)
			if (amount > 0) {
				next[invoice.id] = formatMinorPlain(amount)
				remaining -= amount
			}
		}
		onChange(next)
	}

	if (supplierId === null) {
		return (
			<p className="text-sm text-muted-foreground">
				Choose a supplier to see the invoices that can receive this payment.
			</p>
		)
	}

	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					Leave invoices blank to keep the remainder on account. One invoice can appear once.
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={invoices.length === 0 || paymentAmountMinor <= 0}
					onClick={allocateOldestFirst}
				>
					<WandSparklesIcon className="size-4" aria-hidden="true" />
					Allocate oldest first
				</Button>
			</div>

			{invoicesQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading outstanding invoices…</p>
			) : invoicesQuery.isError ? (
				<p className="text-sm text-destructive">Couldn't load outstanding invoices.</p>
			) : invoices.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No outstanding invoices for this supplier in the branch — the payment stays on account.
				</p>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Invoice</TableHead>
								<TableHead className="w-32">Due</TableHead>
								<TableHead className="w-24 text-right">Overdue</TableHead>
								<TableHead className="w-32 text-right">Outstanding</TableHead>
								<TableHead className="w-32">Allocate</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{invoices.map((invoice) => {
								const typed = allocations[invoice.id] ?? ""
								const parsed = parseGhsToMinor(typed)
								const tooMuch = parsed !== null && parsed > invoice.outstandingMinor
								const overdue = daysOverdue(invoice.dueDate, today)
								return (
									<TableRow key={invoice.id}>
										<TableCell>
											<p className="font-mono text-xs font-medium">{invoice.number}</p>
											<p className="text-xs text-muted-foreground">
												Supplier inv {invoice.supplierInvoiceNumber}
											</p>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDay(invoice.dueDate)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{overdue > 0 ? (
												<span className="text-destructive">{overdue} days</span>
											) : (
												"Current"
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(invoice.outstandingMinor)}
										</TableCell>
										<TableCell>
											<Input
												inputMode="decimal"
												placeholder="0.00"
												className="h-8"
												value={typed}
												aria-label={`Allocate to ${invoice.number}`}
												onChange={(event) =>
													onChange({ ...allocations, [invoice.id]: event.target.value })
												}
											/>
											{tooMuch ? (
												<p className="mt-1 text-xs text-destructive">
													Exceeds the outstanding amount.
												</p>
											) : null}
										</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			)}

			<div className="ml-auto grid w-full max-w-xs gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
				<div className="flex justify-between">
					<span className="text-muted-foreground">Allocated</span>
					<span className="tabular-nums">{formatGhs(allocatedMinor)}</span>
				</div>
				<div className="flex justify-between font-medium">
					<span>On account</span>
					<span className={overAllocated ? "tabular-nums text-destructive" : "tabular-nums"}>
						{overAllocated
							? `−${formatGhs(allocatedMinor - paymentAmountMinor)}`
							: formatGhs(onAccountMinor)}
					</span>
				</div>
				{overAllocated ? (
					<p className="text-xs text-destructive">
						Allocations exceed the payment amount. Reduce them before saving.
					</p>
				) : null}
			</div>
		</div>
	)
}
