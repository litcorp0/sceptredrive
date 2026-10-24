import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { StatusBadge } from "#/components/common/status-badge"
import { PaymentMethodBadge } from "#/components/payables/payment-method-badge"
import { VoidPaymentDialog } from "#/components/payables/void-payment-dialog"
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
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"

export const Route = createFileRoute("/_authenticated/suppliers/payments/$paymentId")({
	component: PaymentDetailPage,
})

function PaymentDetailPage() {
	const { paymentId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const { branches } = useBranch()
	const canVoid = hasPermission(session.user.role, "payable.void")
	const [voidOpen, setVoidOpen] = useState(false)

	const paymentQuery = useQuery({
		queryKey: ["supplier-payment", paymentId],
		queryFn: () => api.payables.payments.get(paymentId),
	})

	const detail = paymentQuery.data
	const payment = detail?.payment

	if (paymentQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading payment…</p>
	}

	if (paymentQuery.isError || !detail || !payment) {
		return <p className="text-sm text-destructive">Couldn't load this payment.</p>
	}

	const branchName = branches.find((branch) => branch.id === payment.branchId)?.name ?? "Branch"

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Link
						to="/suppliers/payments"
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
						Payments
					</Link>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<h2 className="font-mono text-lg font-semibold tracking-tight">{payment.number}</h2>
						{payment.status === "VOID" ? (
							<StatusBadge tone="zinc">Void</StatusBadge>
						) : (
							<StatusBadge tone="green">Completed</StatusBadge>
						)}
						<PaymentMethodBadge method={payment.method} />
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						<Link
							to="/suppliers/$supplierId"
							params={{ supplierId: detail.supplier.id }}
							className="hover:underline"
						>
							{detail.supplier.name}
						</Link>{" "}
						· {branchName} · paid {formatDay(payment.paidAt)}
					</p>
				</div>

				{canVoid && payment.status === "COMPLETED" ? (
					<Button
						size="sm"
						variant="outline"
						className="text-destructive hover:text-destructive"
						onClick={() => setVoidOpen(true)}
					>
						Void payment
					</Button>
				) : null}
			</div>

			{payment.status === "VOID" ? (
				<div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					Voided{payment.voidReason ? ` (${payment.voidReason.toLowerCase()})` : ""}
					{payment.voidedAt ? ` on ${formatDay(payment.voidedAt)}` : ""}
					{payment.voidedBy ? ` by ${payment.voidedBy}` : ""}.
				</div>
			) : null}

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Summary</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Amount</span>
							<span className="tabular-nums">{formatGhs(payment.amountMinor)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Allocated</span>
							<span className="tabular-nums">{formatGhs(detail.allocatedMinor)}</span>
						</div>
						<div className="flex justify-between font-medium">
							<span>On account</span>
							<span className="tabular-nums">{formatGhs(detail.unallocatedMinor)}</span>
						</div>
						{payment.reference ? (
							<div className="flex justify-between gap-3">
								<span className="text-muted-foreground">Reference</span>
								<span className="text-right">{payment.reference}</span>
							</div>
						) : null}
						{payment.note ? (
							<p className="border-t pt-2 text-muted-foreground">{payment.note}</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Allocations</CardTitle>
						<CardDescription>
							Invoices this payment covers; releases are negative history.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{detail.allocations.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Nothing allocated — the whole payment sits on account.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Invoice</TableHead>
										<TableHead className="w-24">Kind</TableHead>
										<TableHead className="w-28 text-right">Amount</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{detail.allocations.map((allocation) => (
										<TableRow key={allocation.id}>
											<TableCell>
												<Link
													to="/suppliers/invoices/$invoiceId"
													params={{ invoiceId: allocation.invoiceId }}
													className="font-mono text-xs hover:underline"
												>
													{allocation.invoiceNumber}
												</Link>
												<p className="text-xs text-muted-foreground">
													Supplier inv {allocation.supplierInvoiceNumber}
												</p>
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

			<VoidPaymentDialog open={voidOpen} onOpenChange={setVoidOpen} payment={detail} />
		</div>
	)
}
