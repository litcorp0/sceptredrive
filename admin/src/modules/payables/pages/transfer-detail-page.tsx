import { formatDateTime } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeftIcon, ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
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
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { payablesKeys } from "../api/keys"
import { transferDetailOptions, verifyTransfer } from "../api/payables"
import { TransferOtpForm } from "../components/transfer-otp-form"
import { TransferStatusBadge } from "../components/transfer-status-badge"

const authenticatedRoute = getRouteApi("/_authenticated")
const detailRoute = getRouteApi("/_authenticated/suppliers/transfers/$transferId")

/**
 * One transfer: the instruction, the plan, and the payment it did or did not post.
 *
 * `payment === null` is shown as "Not posted", never inferred from the status: a success without
 * a payment is money that moved and is not in the books, and a reversal with a payment is money
 * that came back while the payment still stands. Both are raised, not silently formatted away.
 */
export function TransferDetailPage() {
	const { transferId } = detailRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const queryClient = useQueryClient()

	const canTransfer = hasPermission(session.user.role, "payable.transfer")
	const detailQuery = useQuery(transferDetailOptions(transferId))
	const denied = detailQuery.error instanceof ApiError && detailQuery.error.status === 403

	const verifyMutation = useMutation({
		mutationFn: () => verifyTransfer(transferId),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: payablesKeys.transferDetail(transferId) }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.transfers }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.reconciliation }),
			])
		},
		onError: (error) => toastApiError(error),
	})

	if (detailQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading transfer…</p>
	}

	if (denied) {
		return (
			<EmptyState
				icon={ShieldAlert}
				title="You cannot see this transfer"
				description="This screen needs payable.read, and the transfer must belong to a branch you can read."
			/>
		)
	}

	if (detailQuery.isError || !detailQuery.data) {
		return <p className="text-sm text-destructive">Couldn&rsquo;t load this transfer.</p>
	}

	const { transfer, allocations, payment, attention } = detailQuery.data
	const branchName = branches.find((branch) => branch.id === transfer.branchId)?.name ?? "Branch"

	const history = [
		{ label: "Created", at: transfer.createdAt },
		transfer.finalizedAt ? { label: "Finalised", at: transfer.finalizedAt } : null,
		transfer.settledAt ? { label: "Settled", at: transfer.settledAt } : null,
		transfer.lastVerifiedAt ? { label: "Last verified", at: transfer.lastVerifiedAt } : null,
	].filter((row): row is { label: string; at: string } => row !== null)

	return (
		<div className="grid gap-4">
			<div>
				<Link
					to="/suppliers/transfers"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
					Supplier transfers
				</Link>
			</div>

			<PageHeader
				eyebrow="Suppliers"
				title={transfer.reference}
				description={`${formatGhs(transfer.amountMinor)} to ${transfer.supplierName} · ${branchName}`}
				actions={<TransferStatusBadge status={transfer.status} />}
			/>

			{attention ? (
				<div
					role="alert"
					className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
				>
					<p className="font-medium text-destructive">This transfer needs a person.</p>
					<p className="mt-1 text-muted-foreground">
						{transfer.status === "REVERSED"
							? "The money returned. The payment stands until somebody voids it — a webhook is not an authority to reverse a ledger entry."
							: "Paystack reported success but no payment was posted. Do not record one by hand; investigate before the books are touched."}
					</p>
				</div>
			) : null}

			{transfer.failureCode || transfer.failureMessage ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
					<p className="font-medium text-destructive">The provider&rsquo;s words</p>
					<p className="mt-1">
						{transfer.failureCode ? (
							<span className="font-mono text-xs">{transfer.failureCode}</span>
						) : null}
						{transfer.failureCode && transfer.failureMessage ? " · " : null}
						{transfer.failureMessage ?? "No message was recorded."}
					</p>
				</div>
			) : null}

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>The instruction</CardTitle>
						<CardDescription>What we asked Paystack to pay.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Supplier</span>
							<Link
								to="/suppliers/$supplierId"
								params={{ supplierId: transfer.supplierId }}
								className="text-right hover:underline"
							>
								{transfer.supplierName} ({transfer.supplierCode})
							</Link>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Method</span>
							<span>{transfer.method === "BANK" ? "Bank" : "Mobile money"}</span>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Amount</span>
							<span className="tabular-nums">{formatGhs(transfer.amountMinor)}</span>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Provider</span>
							<span className="font-mono text-xs">{transfer.provider}</span>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Provider transfer code</span>
							<span className="font-mono text-xs">{transfer.providerTransferCode ?? "—"}</span>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Initiated by</span>
							<span>{transfer.initiatedBy ?? "—"}</span>
						</div>
						<div className="flex justify-between gap-4">
							<span className="text-muted-foreground">Note</span>
							<span className="max-w-56 text-right">{transfer.note ?? "—"}</span>
						</div>
						{transfer.unallocatedMinor > 0 ? (
							<div className="flex justify-between gap-4 border-t pt-2">
								<span className="text-muted-foreground">Not allocated to invoices</span>
								<span className="tabular-nums">{formatGhs(transfer.unallocatedMinor)}</span>
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>What happened</CardTitle>
						<CardDescription>Every timestamp comes from the API payload.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 text-sm">
						<p>
							{transfer.status === "SUCCESS"
								? "The money moved."
								: transfer.status === "REVERSED"
									? "The money moved and then returned."
									: transfer.status === "AWAITING_OTP"
										? "Waiting for an OTP. Nothing has moved."
										: transfer.status === "PENDING"
											? "Sent to the provider. Nothing has moved yet."
											: "Nothing moved. The supplier is not paid."}
						</p>
						{history.length > 0 ? (
							<ul className="grid gap-1.5">
								{history.map((row) => (
									<li key={row.label} className="flex justify-between gap-4">
										<span className="text-muted-foreground">{row.label}</span>
										<span className="tabular-nums">{formatDateTime(row.at)}</span>
									</li>
								))}
							</ul>
						) : null}

						<div className="border-t pt-2">
							<p className="text-muted-foreground">Posted payment</p>
							{payment ? (
								<Link
									to="/suppliers/payments/$paymentId"
									params={{ paymentId: payment.payment.id }}
									className="font-mono text-xs font-medium hover:underline"
								>
									{payment.payment.number}
								</Link>
							) : (
								<p className="font-medium">Not posted</p>
							)}
						</div>

						{transfer.status === "AWAITING_OTP" && canTransfer ? (
							<div className="border-t pt-3">
								<TransferOtpForm
									transferId={transfer.id}
									onFinalized={() => {
										void detailQuery.refetch()
									}}
								/>
							</div>
						) : null}

						{canTransfer &&
						(transfer.status === "PENDING" || transfer.status === "AWAITING_OTP") ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={verifyMutation.isPending}
								onClick={() => verifyMutation.mutate()}
							>
								{verifyMutation.isPending ? "Checking…" : "Check status"}
							</Button>
						) : null}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>The plan</CardTitle>
					<CardDescription>
						What the transfer was meant to settle. The settlement re-reads each invoice, so the
						posting can differ; the difference appears above as unallocated money.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{allocations.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No invoices were planned; the whole amount lands on account.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Invoice</TableHead>
									<TableHead>Supplier invoice</TableHead>
									<TableHead className="text-right">Planned</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{allocations.map((allocation) => (
									<TableRow key={allocation.id}>
										<TableCell>
											<Link
												to="/suppliers/invoices/$invoiceId"
												params={{ invoiceId: allocation.invoiceId }}
												className="font-mono text-xs font-medium hover:underline"
											>
												{allocation.invoiceNumber}
											</Link>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{allocation.supplierInvoiceNumber}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(allocation.amountMinor)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
