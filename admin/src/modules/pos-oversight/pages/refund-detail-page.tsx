import {
	formatCount,
	formatDateTime,
	formatTenderLabel,
	REFUND_RESTOCK_LABELS,
} from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeft, FileQuestion, ShieldAlert, Undo2 } from "lucide-react"
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
import { refundOptions } from "../api/oversight"
import type { OversightRefundDetail } from "../types"
import { refundReasonLabel, refundTenderStatusLabel, refundTenderStatusTone } from "../utils/labels"

const routeApi = getRouteApi("/_authenticated/pos/refunds/$refundId")

/**
 * One refund: what came back, why, and where the money went.
 *
 * A refund that needed no approval says so rather than pretending the approval is
 * missing. The tender table is the money's state, including a provider refusal; nothing
 * on this page retries, voids or edits.
 */
export function RefundDetailPage() {
	const { refundId } = routeApi.useParams()
	const refundQuery = useQuery({ ...refundOptions(refundId), retry: false })

	const error = refundQuery.error instanceof ApiError ? refundQuery.error : null
	const denied = error?.status === 403
	const missing = error?.status === 404

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<Button variant="ghost" size="sm" className="-ml-2 mb-1" asChild>
						<Link to="/pos" search={{ tab: "refunds" }}>
							<ArrowLeft aria-hidden="true" className="size-4" />
							Refunds
						</Link>
					</Button>
					<h2 className="font-display text-xl tracking-[-0.015em]">
						{refundQuery.data ? refundQuery.data.refund.number : "Refund"}
					</h2>
					{refundQuery.data ? (
						<p className="mt-1 text-sm text-muted-foreground">
							{refundQuery.data.refund.branchName} · {refundQuery.data.refund.terminalCode} ·{" "}
							{formatDateTime(refundQuery.data.refund.occurredAt)}
						</p>
					) : null}
				</div>
			</div>

			{refundQuery.isLoading ? (
				<div className="grid gap-3" aria-busy="true">
					<output className="sr-only">Loading the refund</output>
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see this refund"
					description="It belongs to a branch your role does not cover. The API refuses the read; the console does not guess at the answer."
				/>
			) : missing ? (
				<EmptyState
					icon={FileQuestion}
					title="Refund not found"
					description="It may have been removed, or the link may be wrong. Return to the refund list to find the document."
				/>
			) : refundQuery.isError || !refundQuery.data ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">Couldn't load this refund.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The server did not answer. Try again in a moment.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void refundQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<RefundDocument detail={refundQuery.data} />
			)}
		</div>
	)
}

function RefundDocument({ detail }: { detail: OversightRefundDetail }) {
	const { refund, lines, tenders } = detail

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Undo2 aria-hidden="true" className="size-4" />
					{formatGhs(refund.refundedMinor)} refunded
				</CardTitle>
				<CardDescription>
					{refundReasonLabel(refund.reasonCode)} · {formatCount(refund.tenderCount)} tenders
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Receipt</dt>
						<dd>
							<Link
								to="/pos/sales/$saleId"
								params={{ saleId: refund.saleId }}
								className="font-mono text-xs hover:underline"
							>
								{refund.receiptNumber}
							</Link>
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">When</dt>
						<dd>{formatDateTime(refund.occurredAt)}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Branch</dt>
						<dd>
							{refund.branchName} ({refund.branchCode})
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Terminal</dt>
						<dd>{refund.terminalCode}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Approved by</dt>
						<dd>{refund.approvedBy ?? "—"}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Approved at</dt>
						<dd>{formatDateTime(refund.approvedAt)}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Approval</dt>
						<dd>
							{refund.approvalId ? (
								<Link
									to="/approvals/$approvalId"
									params={{ approvalId: refund.approvalId }}
									className="hover:underline"
								>
									Open approval
								</Link>
							) : (
								"Not required"
							)}
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Tax reversed</dt>
						<dd className="tabular-nums">{formatGhs(refund.taxTotalMinor)}</dd>
					</div>
				</dl>

				<section className="grid gap-1" aria-labelledby="refund-note-heading">
					<h3 id="refund-note-heading" className="font-medium">
						Why
					</h3>
					<p className="whitespace-pre-wrap break-words text-muted-foreground">
						{refund.note && refund.note.trim().length > 0 ? refund.note : "No note was recorded."}
					</p>
				</section>

				<section className="grid gap-2" aria-labelledby="refund-lines-heading">
					<h3 id="refund-lines-heading" className="font-medium">
						Lines
					</h3>
					<div className="min-w-0 overflow-x-auto rounded-md border">
						<Table>
							<caption className="sr-only">What came back on this refund</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Line</TableHead>
									<TableHead scope="col">SKU</TableHead>
									<TableHead scope="col">Product</TableHead>
									<TableHead scope="col" className="text-right">
										Qty
									</TableHead>
									<TableHead scope="col" className="text-right">
										Unit
									</TableHead>
									<TableHead scope="col">Restock</TableHead>
									<TableHead scope="col" className="text-right">
										Tax
									</TableHead>
									<TableHead scope="col" className="text-right">
										Total
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{lines.length === 0 ? (
									<TableMessage colSpan={8} state="empty">
										No lines were recorded on this refund.
									</TableMessage>
								) : (
									lines.map((line) => (
										<TableRow key={line.lineNumber}>
											<TableCell className="text-muted-foreground">{line.lineNumber}</TableCell>
											<TableCell className="font-mono text-xs">{line.sku}</TableCell>
											<TableCell className="max-w-56 truncate font-medium">
												{line.productName}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(line.quantity)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.unitPriceMinor)}
											</TableCell>
											<TableCell>
												<StatusBadge variant={line.restock === "RESALABLE" ? "ok" : "warn"}>
													{REFUND_RESTOCK_LABELS[line.restock]}
													{line.damageReason ? ` — ${line.damageReason}` : ""}
												</StatusBadge>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.taxTotalMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.totalMinor)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</section>

				<section className="grid gap-2" aria-labelledby="refund-tenders-heading">
					<h3 id="refund-tenders-heading" className="font-medium">
						How the money went back
					</h3>
					<div className="min-w-0 overflow-x-auto rounded-md border">
						<Table>
							<caption className="sr-only">The refund's tenders and their provider state</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Sequence</TableHead>
									<TableHead scope="col">Method</TableHead>
									<TableHead scope="col" className="text-right">
										Amount
									</TableHead>
									<TableHead scope="col">Status</TableHead>
									<TableHead scope="col">Settled</TableHead>
									<TableHead scope="col">Provider reference</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{tenders.length === 0 ? (
									<TableMessage colSpan={6} state="empty">
										No tenders were recorded on this refund.
									</TableMessage>
								) : (
									tenders.map((tender) => (
										<TableRow key={tender.sequence}>
											<TableCell className="text-muted-foreground">{tender.sequence}</TableCell>
											<TableCell>{formatTenderLabel(tender.method)}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(tender.amountMinor)}
											</TableCell>
											<TableCell>
												<StatusBadge variant={refundTenderStatusTone(tender.status)}>
													{refundTenderStatusLabel(tender.status)}
												</StatusBadge>
												{tender.failedMessage ? (
													<span className="mt-1 block text-xs text-destructive">
														{tender.failedMessage}
													</span>
												) : null}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{tender.settledAt ? formatDateTime(tender.settledAt) : "—"}
											</TableCell>
											<TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
												{tender.providerRefundReference ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</section>
			</CardContent>
		</Card>
	)
}
