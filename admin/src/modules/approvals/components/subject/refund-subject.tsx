import {
	formatCount,
	formatDateTime,
	formatTenderLabel,
	REFUND_RESTOCK_LABELS,
	TENDER_METHODS,
	type TenderMethod,
} from "@sceptre/shared"

import { StatusBadge, type StatusVariant } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
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
import type { ApprovalSubject } from "../../types"
import { refundReasonLabel, refundTenderStatusLabel } from "../../utils/approval"

type RefundSubjectArm = Extract<ApprovalSubject, { kind: "refund" }>

function tenderMethodLabel(method: string): string {
	return (TENDER_METHODS as readonly string[]).includes(method)
		? formatTenderLabel(method as TenderMethod)
		: method
}

function tenderStatusTone(status: string): StatusVariant {
	switch (status) {
		case "SETTLED":
			return "ok"
		case "PENDING":
			return "warn"
		case "FAILED":
		case "NEEDS_ATTENTION":
			return "danger"
		default:
			return "muted"
	}
}

function restockTone(restock: RefundSubjectArm["lines"][number]["restock"]): StatusVariant {
	switch (restock) {
		case "RESALABLE":
			return "ok"
		case "DAMAGED":
			return "warn"
		default:
			return "muted"
	}
}

/** The shared restock word, with the damage reason appended where the line carries one. */
function restockText(line: RefundSubjectArm["lines"][number]): string {
	const word = REFUND_RESTOCK_LABELS[line.restock]
	const reason = line.damageReason?.trim()
	return reason ? `${word} — ${reason}` : word
}

/**
 * A refund waiting for head office's acceptance (P13-D23).
 *
 * Nothing here can move money: the refund already happened at the till, and the decision only
 * records whether head office accepts it. The reviewer's question is therefore "what came back,
 * and has the customer actually been paid" — the lines answer the first, the tenders answer the
 * second.
 */
export function RefundSubject({
	subject,
	branchId,
	cashier,
	note,
}: {
	subject: RefundSubjectArm
	branchId: string
	/** The cashier who took the refund, from the approval's requester. */
	cashier: string
	/** The refund's note, carried as the approval's request note. */
	note: string | null
}) {
	const { branches } = useBranch()
	const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "Branch"
	const receipt = subject.receiptNumber.trim()

	const restock = [
		{
			key: "resalable",
			label: REFUND_RESTOCK_LABELS.RESALABLE,
			count: subject.restock.resalable,
			variant: "ok" as StatusVariant,
		},
		{
			key: "damaged",
			label: REFUND_RESTOCK_LABELS.DAMAGED,
			count: subject.restock.damaged,
			variant: "warn" as StatusVariant,
		},
		{
			key: "notReturned",
			label: REFUND_RESTOCK_LABELS.NOT_RETURNED,
			count: subject.restock.notReturned,
			variant: "muted" as StatusVariant,
		},
	]

	const pendingCount = subject.tenders.filter((tender) => tender.status === "PENDING").length
	const failedCount = subject.tenders.filter(
		(tender) => tender.status === "FAILED" || tender.status === "NEEDS_ATTENTION",
	).length
	const moneySummary =
		failedCount > 0
			? "At least one tender did not reach the customer."
			: pendingCount > 0
				? "At least one electronic tender is still on its way back to the customer."
				: subject.tenders.length > 0
					? "Every tender is settled."
					: null

	return (
		<Card>
			<CardHeader>
				<CardTitle>Refund {subject.number}</CardTitle>
				<CardDescription>
					{receipt ? `Receipt ${receipt}` : "Receipt number not recorded"} · {branchName} ·{" "}
					<time dateTime={subject.occurredAt} title={formatDateTime(subject.occurredAt)}>
						{formatDateTime(subject.occurredAt)}
					</time>
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4 text-sm">
				<dl className="grid gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/50 p-3">
						<dt className="text-muted-foreground">Refunded to the customer</dt>
						<dd className="text-2xl font-semibold tabular-nums">
							{formatGhs(subject.refundedMinor)}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Original sale total</dt>
						<dd className="tabular-nums">{formatGhs(subject.originalTotalMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Lines and items</dt>
						<dd className="tabular-nums">
							{formatCount(subject.lineCount)} {subject.lineCount === 1 ? "line" : "lines"} ·{" "}
							{formatCount(subject.itemCount)} {subject.itemCount === 1 ? "item" : "items"}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Approved by</dt>
						<dd>{subject.approvedBy}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Cashier who took it</dt>
						<dd>{cashier || "—"}</dd>
					</div>
				</dl>

				<section className="grid gap-2" aria-labelledby="refund-lines-heading">
					<h3 id="refund-lines-heading" className="font-medium">
						Lines
					</h3>
					<div className="min-w-0 overflow-x-auto rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Product</TableHead>
									<TableHead>SKU</TableHead>
									<TableHead className="text-right">Quantity</TableHead>
									<TableHead className="text-right">Line total</TableHead>
									<TableHead>Restock</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{subject.lines.length === 0 ? (
									<TableMessage colSpan={5} state="empty">
										No lines were recorded on this refund.
									</TableMessage>
								) : (
									// The arm carries no line id, so the row's position is the only key available.
									subject.lines.map((line, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: the arm has no line id
										<TableRow key={`${line.sku}-${index}`}>
											<TableCell className="font-medium">{line.productName}</TableCell>
											<TableCell className="font-mono text-xs">{line.sku}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(line.quantity)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.totalMinor)}
											</TableCell>
											<TableCell>
												<StatusBadge variant={restockTone(line.restock)}>
													{restockText(line)}
												</StatusBadge>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</section>

				<section className="grid gap-2" aria-labelledby="refund-restock-heading">
					<h3 id="refund-restock-heading" className="font-medium">
						What came back
					</h3>
					{subject.lineCount === 0 ? (
						<p className="text-muted-foreground">
							No restock decisions were recorded on this refund.
						</p>
					) : (
						<ul className="flex flex-wrap gap-2">
							{restock.map((item) => (
								<li key={item.key}>
									<StatusBadge variant={item.variant}>
										{item.label} · {formatCount(item.count)} {item.count === 1 ? "line" : "lines"}
									</StatusBadge>
								</li>
							))}
						</ul>
					)}
					<p className="text-xs text-muted-foreground">
						Only resalable goods went back into sellable stock. Damaged and kept goods posted no
						stock movement.
					</p>
				</section>

				<section className="grid gap-2" aria-labelledby="refund-tenders-heading">
					<h3 id="refund-tenders-heading" className="font-medium">
						How the money went back
					</h3>
					<div className="min-w-0 rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Method</TableHead>
									<TableHead className="text-right">Amount</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{subject.tenders.length === 0 ? (
									<TableMessage colSpan={3} state="empty">
										No tenders were recorded on this refund.
									</TableMessage>
								) : (
									// The subject arm carries no tender id (P13-D19 only sends method, amount and
									// status), so the row's position is the only key the console can derive.
									subject.tenders.map((tender, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: the arm has no tender id
										<TableRow key={`${tender.method}-${index}`}>
											<TableCell className="font-medium">
												{tenderMethodLabel(tender.method)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(tender.amountMinor)}
											</TableCell>
											<TableCell>
												<StatusBadge variant={tenderStatusTone(tender.status)}>
													{refundTenderStatusLabel(tender.status)}
												</StatusBadge>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
					{moneySummary ? <p className="text-xs text-muted-foreground">{moneySummary}</p> : null}
				</section>

				<section className="grid gap-1" aria-labelledby="refund-reason-heading">
					<h3 id="refund-reason-heading" className="font-medium">
						Why
					</h3>
					<p>{refundReasonLabel(subject.reasonCode)}</p>
					<p className="whitespace-pre-wrap break-words text-muted-foreground">
						{note && note.trim().length > 0 ? note : "No note was recorded."}
					</p>
				</section>
			</CardContent>
		</Card>
	)
}
