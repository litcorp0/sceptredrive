import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { InvoiceStatusBadge } from "#/components/payables/invoice-status-badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatDay, formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"

export const Route = createFileRoute("/_authenticated/inventory/receipts/$receiptId")({
	component: ReceiptDetailPage,
})

function ReceiptDetailPage() {
	const { receiptId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const { branches } = useBranch()
	const canViewPayables = hasPermission(session.user.role, "payable.read")
	const canManageInvoice = hasPermission(session.user.role, "payable.invoice.manage")

	const receiptQuery = useQuery({
		queryKey: ["inventory-receipt", receiptId],
		queryFn: () => api.inventory.receipts.get(receiptId),
	})

	const receipt = receiptQuery.data?.receipt

	const linkedInvoiceQuery = useQuery({
		queryKey: ["receipt-invoice", receiptId],
		queryFn: () => api.payables.invoices.list({ receiptId, limit: 1 }),
		enabled: canViewPayables,
	})
	const linkedInvoice = linkedInvoiceQuery.data?.invoices?.[0] ?? null

	if (receiptQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading receipt…</p>
	}

	if (receiptQuery.isError || !receipt) {
		return <p className="text-sm text-destructive">Couldn't load this receipt.</p>
	}

	const branchName = branches.find((branch) => branch.id === receipt.branchId)?.name ?? "Branch"
	const lines = receipt.lines ?? []

	return (
		<div className="grid gap-4">
			<div>
				<Link
					to="/inventory/receipts"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
					Receipts
				</Link>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<h2 className="font-mono text-lg font-semibold tracking-tight">{receipt.number}</h2>
				</div>
				<p className="mt-1 text-sm text-muted-foreground">
					{branchName} ·{" "}
					{receipt.supplierId ? (
						<Link
							to="/suppliers/$supplierId"
							params={{ supplierId: receipt.supplierId }}
							className="hover:underline"
						>
							{receipt.supplierName ?? "Supplier"}
						</Link>
					) : (
						(receipt.supplierName ?? "No supplier recorded")
					)}
					{receipt.supplierInvoiceNumber
						? ` · supplier invoice ${receipt.supplierInvoiceNumber}`
						: ""}
				</p>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Received {formatDay(receipt.createdAt)}
					{receipt.createdBy ? ` by ${receipt.createdBy}` : ""}
				</p>
			</div>

			{receipt.note ? (
				<div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					{receipt.note}
				</div>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Lines</CardTitle>
					<CardDescription>Immutable goods receipt; costs feed the moving average.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-32">SKU</TableHead>
									<TableHead>Product</TableHead>
									<TableHead className="w-20 text-right">Qty</TableHead>
									<TableHead className="w-32 text-right">Unit cost</TableHead>
									<TableHead className="w-32 text-right">Line total</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{lines.map((line) => (
									<TableRow key={line.id}>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{line.sku}
										</TableCell>
										<TableCell className="font-medium">{line.productName}</TableCell>
										<TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(line.unitCostMinor)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(line.quantity * line.unitCostMinor)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<div className="ml-auto flex w-full max-w-xs justify-between border-t pt-2 text-sm font-medium">
						<span>Total cost</span>
						<span className="tabular-nums">{formatGhs(receipt.totalCostMinor)}</span>
					</div>
				</CardContent>
			</Card>

			{canViewPayables ? (
				<Card>
					<CardHeader>
						<CardTitle>Supplier invoice</CardTitle>
						<CardDescription>
							One purchase invoice can be recorded against this receipt.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-sm">
						{linkedInvoice ? (
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<Link
										to="/suppliers/invoices/$invoiceId"
										params={{ invoiceId: linkedInvoice.id }}
										className="font-mono text-xs font-medium hover:underline"
									>
										{linkedInvoice.number}
									</Link>
									<InvoiceStatusBadge status={linkedInvoice.status} />
									<span className="text-muted-foreground">
										{formatGhs(linkedInvoice.totalMinor)}
									</span>
								</div>
								<Button variant="link" size="sm" className="h-auto px-0" asChild>
									<Link
										to="/suppliers/invoices/$invoiceId"
										params={{ invoiceId: linkedInvoice.id }}
									>
										Open invoice
									</Link>
								</Button>
							</div>
						) : (
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-muted-foreground">No supplier invoice recorded yet.</p>
								{canManageInvoice ? (
									<Button size="sm" asChild>
										<Link to="/suppliers/invoices/new" search={{ receiptId: receipt.id }}>
											Record supplier invoice
										</Link>
									</Button>
								) : null}
							</div>
						)}
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}
