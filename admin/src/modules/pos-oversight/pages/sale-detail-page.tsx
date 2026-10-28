import { formatCount, formatDateTime, formatTenderLabel } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeft, FileQuestion, Printer, ShieldAlert } from "lucide-react"
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
import { receiptOptions, saleOptions } from "../api/oversight"
import { ReceiptCopyDocument } from "../components/receipt-copy"
import type { OversightSaleDetail, ReceiptCopy } from "../types"
import {
	conflictSeverityTone,
	conflictStatusLabel,
	conflictStatusTone,
	conflictTypeLabel,
	resolutionLabel,
} from "../utils/labels"

const routeApi = getRouteApi("/_authenticated/pos/sales/$saleId")

/** The one place a page asks the browser to print its receipt copy; no PDF is generated. */
function printCopy() {
	window.print()
}

/**
 * One sale: the document a reviewer reconciles, and the copy the till would have printed.
 *
 * The two panels read two endpoints and share no arithmetic. The document is for checking
 * the tender split against the refunds and conflicts; the copy is for checking the paper
 * on a manager's desk. Neither can write anything.
 */
export function SaleDetailPage() {
	const { saleId } = routeApi.useParams()
	const saleQuery = useQuery({ ...saleOptions(saleId), retry: false })
	const receiptQuery = useQuery({ ...receiptOptions(saleId), retry: false })

	const error = saleQuery.error instanceof ApiError ? saleQuery.error : null
	const denied = error?.status === 403
	const missing = error?.status === 404

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
				<div className="min-w-0">
					<Button variant="ghost" size="sm" className="-ml-2 mb-1" asChild>
						<Link to="/pos" search={{ tab: "sales" }}>
							<ArrowLeft aria-hidden="true" className="size-4" />
							Sales
						</Link>
					</Button>
					<h2 className="font-display text-xl tracking-[-0.015em]">
						{saleQuery.data ? saleQuery.data.sale.receiptNumber : "Sale"}
					</h2>
					{saleQuery.data ? (
						<p className="mt-1 text-sm text-muted-foreground">
							{saleQuery.data.sale.branchName} · {saleQuery.data.sale.terminalCode} ·{" "}
							{formatDateTime(saleQuery.data.sale.occurredAt)}
						</p>
					) : null}
				</div>
				<Button variant="outline" size="sm" asChild>
					<Link to="/pos" search={{ tab: "conflicts", saleId }}>
						Conflicts for this sale
					</Link>
				</Button>
			</div>

			{saleQuery.isLoading ? (
				<div className="grid gap-3" aria-busy="true">
					<output className="sr-only">Loading the sale</output>
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see this sale"
					description="It belongs to a branch your role does not cover. The API refuses the read; the console does not guess at the answer."
				/>
			) : missing ? (
				<EmptyState
					icon={FileQuestion}
					title="Sale not found"
					description="It may have been removed, or the link may be wrong. Return to the sales list to find the receipt."
				/>
			) : saleQuery.isError || !saleQuery.data ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">Couldn't load this sale.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The server did not answer. Try again in a moment.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void saleQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<SaleDocument detail={saleQuery.data} copy={receiptQuery.data ?? null} />
			)}

			{saleQuery.data ? (
				<section aria-labelledby="receipt-copy-heading" className="grid gap-2">
					<div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
						<h3 id="receipt-copy-heading" className="text-sm font-semibold">
							Receipt copy
						</h3>
						<Button type="button" variant="outline" size="sm" onClick={printCopy}>
							<Printer aria-hidden="true" className="size-4" />
							Print copy
						</Button>
					</div>

					{receiptQuery.isLoading ? (
						<Skeleton className="h-[420px] w-full max-w-[80mm]" />
					) : receiptQuery.isError ? (
						<div className="rounded-md border border-dashed p-3 print:hidden">
							<p className="text-sm text-destructive">Couldn't load the receipt copy.</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={() => void receiptQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					) : receiptQuery.data ? (
						<ReceiptCopyDocument copy={receiptQuery.data} />
					) : null}
				</section>
			) : null}
		</div>
	)
}

function SaleDocument({ detail, copy }: { detail: OversightSaleDetail; copy: ReceiptCopy | null }) {
	const { sale, lines, tenders, refunds, conflicts } = detail

	return (
		<Card className="print:hidden">
			<CardHeader>
				<CardTitle>Document</CardTitle>
				<CardDescription>
					{formatCount(sale.itemsSold)} items · {formatGhs(sale.totalMinor)} ·{" "}
					{formatGhs(sale.changeMinor)} change
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Receipt</dt>
						<dd className="font-mono text-xs">{sale.receiptNumber}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">When</dt>
						<dd>{formatDateTime(sale.occurredAt)}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Branch</dt>
						<dd>
							{sale.branchName} ({sale.branchCode})
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Terminal</dt>
						<dd>{sale.terminalCode}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Cashier</dt>
						<dd>{sale.cashierName}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Customer</dt>
						<dd>{sale.customerName ?? "—"}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Tax</dt>
						<dd className="tabular-nums">{formatGhs(sale.taxTotalMinor)}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">On credit</dt>
						<dd className="tabular-nums">{formatGhs(sale.creditMinor)}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Refunded</dt>
						<dd className="tabular-nums">{formatGhs(sale.refundedMinor)}</dd>
					</div>
				</dl>

				<section className="grid gap-2" aria-labelledby="sale-lines-heading">
					<h3 id="sale-lines-heading" className="font-medium">
						Lines
					</h3>
					<div className="min-w-0 overflow-x-auto rounded-md border">
						<Table>
							<caption className="sr-only">The sale's lines, as the receipt prints them</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Line</TableHead>
									<TableHead scope="col">SKU</TableHead>
									<TableHead scope="col">Item</TableHead>
									<TableHead scope="col" className="text-right">
										Qty
									</TableHead>
									<TableHead scope="col" className="text-right">
										Unit
									</TableHead>
									<TableHead scope="col" className="text-right">
										Line disc.
									</TableHead>
									<TableHead scope="col" className="text-right">
										Sale disc.
									</TableHead>
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
									<TableMessage colSpan={9} state="empty">
										No lines were recorded on this sale.
									</TableMessage>
								) : (
									lines.map((line) => (
										<TableRow key={line.lineNumber}>
											<TableCell className="text-muted-foreground">{line.lineNumber}</TableCell>
											<TableCell className="font-mono text-xs">{line.sku}</TableCell>
											<TableCell className="max-w-56 truncate font-medium">{line.name}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(line.quantity)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.unitPriceMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{line.lineDiscountMinor > 0 ? formatGhs(line.lineDiscountMinor) : "—"}
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{line.saleDiscountMinor > 0 ? formatGhs(line.saleDiscountMinor) : "—"}
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

				<section className="grid gap-2" aria-labelledby="sale-tenders-heading">
					<h3 id="sale-tenders-heading" className="font-medium">
						Tenders
					</h3>
					<div className="min-w-0 overflow-x-auto rounded-md border">
						<Table>
							<caption className="sr-only">The money that settled the sale</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Sequence</TableHead>
									<TableHead scope="col">Method</TableHead>
									<TableHead scope="col" className="text-right">
										Amount
									</TableHead>
									<TableHead scope="col">Reference</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{tenders.length === 0 ? (
									<TableMessage colSpan={4} state="empty">
										No tenders were recorded on this sale.
									</TableMessage>
								) : (
									tenders.map((tender) => (
										<TableRow key={tender.sequence}>
											<TableCell className="text-muted-foreground">{tender.sequence}</TableCell>
											<TableCell>{formatTenderLabel(tender.method)}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(tender.amountMinor)}
											</TableCell>
											<TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
												{tender.reference ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</section>

				<div className="grid gap-4 sm:grid-cols-2">
					<section className="grid gap-2" aria-labelledby="sale-refunds-heading">
						<h3 id="sale-refunds-heading" className="font-medium">
							Refunds against this sale
						</h3>
						{refunds.length === 0 ? (
							<p className="text-sm text-muted-foreground">No refund names this sale.</p>
						) : (
							<ul className="grid gap-1 text-sm">
								{refunds.map((refund) => (
									<li key={refund.id} className="flex justify-between gap-3">
										<Link
											to="/pos/refunds/$refundId"
											params={{ refundId: refund.id }}
											className="font-mono text-xs hover:underline"
										>
											{refund.number}
										</Link>
										<span className="tabular-nums">{formatGhs(refund.refundedMinor)}</span>
										<span className="text-muted-foreground">
											{formatDateTime(refund.occurredAt)}
										</span>
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="grid gap-2" aria-labelledby="sale-conflicts-heading">
						<h3 id="sale-conflicts-heading" className="font-medium">
							Conflicts on this sale
						</h3>
						{conflicts.length === 0 ? (
							<p className="text-sm text-muted-foreground">No sync conflict names this sale.</p>
						) : (
							<ul className="grid gap-1 text-sm">
								{conflicts.map((conflict) => (
									<li key={conflict.id}>
										<Link
											to="/pos"
											search={{ tab: "conflicts", saleId: sale.id }}
											className="flex flex-wrap items-center gap-2 hover:underline"
										>
											<StatusBadge variant={conflictSeverityTone(conflict.severity)}>
												{conflict.severity}
											</StatusBadge>
											<span>{conflictTypeLabel(conflict.type)}</span>
											<StatusBadge variant={conflictStatusTone(conflict.status)}>
												{conflictStatusLabel(conflict.status)}
											</StatusBadge>
										</Link>
										{conflict.resolutionCode ? (
											<p className="mt-1 text-xs text-muted-foreground">
												{resolutionLabel(conflict.resolutionCode)}
											</p>
										) : null}
									</li>
								))}
							</ul>
						)}
					</section>
				</div>

				{copy?.loyalty ? (
					<p className="text-sm text-muted-foreground">
						Loyalty: {formatCount(copy.loyalty.earnedPoints)} points earned ·{" "}
						{formatCount(copy.loyalty.redeemedPoints)} redeemed.
					</p>
				) : null}
			</CardContent>
		</Card>
	)
}
