import { formatDay, toDateInputValue } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { StatusBadge } from "#/components/common/status-badge"
// TODO(phase-8/11): payables component — this screen is payables'; Plan 11 moves it into
// `modules/payables` and flips these imports to `#/modules/payables`.
import { InvoiceStatusBadge } from "#/components/payables/invoice-status-badge"
import { PaymentFormDialog } from "#/components/payables/payment-form-dialog"
import { VoidInvoiceDialog } from "#/components/payables/void-invoice-dialog"
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
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { invoiceDetailOptions } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/invoices/$invoiceId")({
	component: InvoiceDetailPage,
})

function InvoiceDetailPage() {
	const { invoiceId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const { branches } = useBranch()
	const canVoid = hasPermission(session.user.role, "payable.void")
	const canPay = hasPermission(session.user.role, "payable.payment")
	const [voidOpen, setVoidOpen] = useState(false)
	const [paymentOpen, setPaymentOpen] = useState(false)

	const invoiceQuery = useQuery(invoiceDetailOptions(invoiceId))

	const detail = invoiceQuery.data
	const invoice = detail?.invoice

	if (invoiceQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading invoice…</p>
	}

	if (invoiceQuery.isError || !detail || !invoice) {
		return <p className="text-sm text-destructive">Couldn't load this invoice.</p>
	}

	const today = toDateInputValue(new Date())
	const branchName = branches.find((branch) => branch.id === invoice.branchId)?.name ?? "Branch"
	const overdue = invoice.status !== "VOID" && invoice.status !== "PAID" && invoice.dueDate < today
	const voidBlocked = invoice.amountPaidMinor !== 0

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Link
						to="/suppliers/invoices"
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
						Invoices
					</Link>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<h2 className="font-mono text-lg font-semibold tracking-tight">{invoice.number}</h2>
						<InvoiceStatusBadge status={invoice.status} overdue={overdue} />
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Supplier invoice {invoice.supplierInvoiceNumber} ·{" "}
						<Link
							to="/suppliers/$supplierId"
							params={{ supplierId: detail.supplier.id }}
							className="hover:underline"
						>
							{detail.supplier.name}
						</Link>{" "}
						· {branchName}
					</p>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Invoiced {formatDay(invoice.invoiceDate)} · due {formatDay(invoice.dueDate)}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{canPay && invoice.status !== "VOID" && invoice.outstandingMinor > 0 ? (
						<Button size="sm" onClick={() => setPaymentOpen(true)}>
							Record payment
						</Button>
					) : null}
					{canVoid && invoice.status !== "VOID" ? (
						<div className="grid justify-items-end gap-1">
							<Button
								size="sm"
								variant="outline"
								className="text-destructive hover:text-destructive"
								disabled={voidBlocked}
								onClick={() => setVoidOpen(true)}
							>
								Void invoice
							</Button>
							{voidBlocked ? (
								<span className="max-w-64 text-right text-xs text-muted-foreground">
									Void is blocked while {formatGhs(invoice.amountPaidMinor)} is allocated. Void the
									payment first.
								</span>
							) : null}
						</div>
					) : null}
				</div>
			</div>

			{invoice.status === "VOID" ? (
				<div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					Voided{invoice.voidReason ? ` (${invoice.voidReason.toLowerCase()})` : ""}
					{invoice.voidedAt ? ` on ${formatDay(invoice.voidedAt)}` : ""}
					{invoice.voidedBy ? ` by ${invoice.voidedBy}` : ""}.
				</div>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Lines</CardTitle>
					<CardDescription>
						Unit costs are tax-inclusive for the derived standard split; the server recomputes every
						total.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Product / description</TableHead>
									<TableHead className="w-20 text-right">Qty</TableHead>
									<TableHead className="w-32 text-right">Unit cost</TableHead>
									<TableHead className="w-32 text-right">Line total</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{detail.lines.map((line) => (
									<TableRow key={line.id}>
										<TableCell>
											<p className="font-medium">{line.productName ?? line.description ?? "—"}</p>
											{line.sku ? (
												<p className="font-mono text-xs text-muted-foreground">{line.sku}</p>
											) : null}
										</TableCell>
										<TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(line.unitCostMinor)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(line.lineTotalMinor)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>

					<div className="ml-auto w-full max-w-sm rounded-lg border bg-muted/30 p-3 text-sm">
						<TotalsRow label="Subtotal" minor={invoice.subtotalMinor} />
						<TotalsRow label="VAT 15%" minor={invoice.vatMinor} />
						<TotalsRow label="NHIL 2.5%" minor={invoice.nhilMinor} />
						<TotalsRow label="GETFund 2.5%" minor={invoice.getfundMinor} />
						<TotalsRow label="Total" minor={invoice.totalMinor} strong />
						<div className="mt-1 border-t pt-1.5">
							<TotalsRow label="Paid" minor={invoice.amountPaidMinor} />
							<TotalsRow label="Outstanding" minor={invoice.outstandingMinor} strong />
						</div>
					</div>

					{invoice.note ? (
						<p className="text-sm text-muted-foreground">Note: {invoice.note}</p>
					) : null}
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Goods receipt</CardTitle>
						<CardDescription>Stock received against this invoice.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm">
						{detail.receipt ? (
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="font-mono">{detail.receipt.number}</span>
								<Button variant="link" size="sm" className="h-auto px-0" asChild>
									<Link
										to="/inventory/receipts/$receiptId"
										params={{ receiptId: detail.receipt.id }}
									>
										Open receipt
									</Link>
								</Button>
							</div>
						) : (
							<p className="text-muted-foreground">Standalone invoice — no receipt linked.</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Allocations</CardTitle>
						<CardDescription>
							Payments applied to this invoice. Releases are negative history.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{detail.allocations.length === 0 ? (
							<p className="text-sm text-muted-foreground">No payments allocated yet.</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Payment</TableHead>
										<TableHead className="w-24">Method</TableHead>
										<TableHead className="w-28">Date</TableHead>
										<TableHead className="w-24">Kind</TableHead>
										<TableHead className="w-28 text-right">Amount</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{detail.allocations.map((allocation) => (
										<TableRow key={allocation.id}>
											<TableCell className="font-mono text-xs">
												{allocation.paymentNumber}
												{allocation.paymentStatus === "VOID" ? (
													<StatusBadge tone="zinc" className="ml-1">
														Void
													</StatusBadge>
												) : null}
											</TableCell>
											<TableCell className="text-muted-foreground">{allocation.method}</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDay(allocation.paidAt)}
											</TableCell>
											<TableCell>
												<StatusBadge tone={allocation.kind === "RELEASE" ? "red" : "blue"}>
													{allocation.kind === "RELEASE" ? "Release" : "Apply"}
												</StatusBadge>
											</TableCell>
											<TableCell
												className={
													allocation.amountMinor < 0
														? "text-right tabular-nums text-destructive"
														: "text-right tabular-nums"
												}
											>
												{allocation.amountMinor < 0
													? `−${formatGhs(-allocation.amountMinor)}`
													: formatGhs(allocation.amountMinor)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>

			<VoidInvoiceDialog open={voidOpen} onOpenChange={setVoidOpen} invoice={invoice} />
			<PaymentFormDialog
				open={paymentOpen}
				onOpenChange={setPaymentOpen}
				invoice={{
					id: invoice.id,
					number: invoice.number,
					supplierInvoiceNumber: invoice.supplierInvoiceNumber,
					supplierId: detail.supplier.id,
					supplierName: detail.supplier.name,
					branchId: invoice.branchId,
					outstandingMinor: invoice.outstandingMinor,
				}}
			/>
		</div>
	)
}

function TotalsRow({
	label,
	minor,
	strong = false,
}: {
	label: string
	minor: number
	strong?: boolean
}) {
	return (
		<div
			className={strong ? "flex justify-between py-0.5 font-medium" : "flex justify-between py-0.5"}
		>
			<span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
			<span className="tabular-nums">{formatGhs(minor)}</span>
		</div>
	)
}
