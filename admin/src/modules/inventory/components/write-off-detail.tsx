import { formatDateTime, formatDay } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import type { WriteOffDetail as WriteOffDetailData } from "../types"
import { writeOffReasonLabel, writeOffStatusLabel, writeOffStatusTone } from "../utils/writeoff"
import { ApprovalSummaryCard } from "./approval-summary-card"

/**
 * The whole write-off document: what left the shelf, at what frozen cost, and who decided it.
 *
 * The lines and the total are the API's stored values — the console formats them and never
 * re-values a line. Withdrawing is offered only while the document is pending and only to the
 * person who raised it, which is the server's own rule.
 */
export function WriteOffDetail({
	detail,
	branchName,
	canWithdraw,
	withdrawing,
	onWithdraw,
}: {
	detail: WriteOffDetailData
	branchName: string | null
	canWithdraw: boolean
	withdrawing: boolean
	onWithdraw: () => void
}) {
	const { writeOff, lines, approval } = detail

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
				<StatusBadge variant={writeOffStatusTone(writeOff.status)}>
					{writeOffStatusLabel(writeOff.status)}
				</StatusBadge>
				<span>
					Raised {formatDay(writeOff.createdAt)}
					{writeOff.requestedBy ? ` by ${writeOff.requestedBy}` : ""}
				</span>
				{writeOff.postedAt ? <span>Posted {formatDateTime(writeOff.postedAt)}</span> : null}
				{writeOff.cancelledAt ? (
					<span>Cancelled {formatDateTime(writeOff.cancelledAt)}</span>
				) : null}
			</div>

			{writeOff.status === "PENDING_APPROVAL" ? (
				<StatusNote tone="info">
					Waiting for an admin's decision. Approving posts one stock movement per line at the
					frozen cost below; rejecting posts nothing.
				</StatusNote>
			) : writeOff.status === "APPROVED" ? (
				<StatusNote tone="ok">
					Posted. Every line has a movement in the stock ledger at the frozen unit cost.
				</StatusNote>
			) : writeOff.status === "REJECTED" ? (
				<StatusNote tone="danger">
					Rejected. No stock movement was posted; raise a new document if the loss still needs
					recording.
				</StatusNote>
			) : (
				<StatusNote tone="warn">
					Cancelled by the requester. No stock movement was posted.
				</StatusNote>
			)}

			<div className="grid gap-2 rounded-md border bg-muted/40 p-3 sm:grid-cols-3">
				<div>
					<p className="text-xs text-muted-foreground">Frozen value</p>
					<p className="text-lg font-medium tabular-nums">{formatGhs(writeOff.valueMinor)}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Branch</p>
					<p className="text-sm font-medium">{branchName ?? writeOff.branchName}</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Lines</p>
					<p className="text-sm font-medium tabular-nums">{writeOff.lineCount}</p>
				</div>
			</div>

			{writeOff.note ? (
				<p className="rounded-md border p-3 text-sm">
					<span className="text-muted-foreground">Note: </span>
					{writeOff.note}
				</p>
			) : null}

			<div className="min-w-0 rounded-md border">
				<Table className="min-w-[44rem]">
					<TableHeader>
						<TableRow>
							<TableHead>Product</TableHead>
							<TableHead>SKU</TableHead>
							<TableHead className="text-right">Quantity</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead className="text-right">Frozen unit cost</TableHead>
							<TableHead>Note</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{lines.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
									This write-off has no lines.
								</TableCell>
							</TableRow>
						) : (
							lines.map((line) => (
								<TableRow key={line.id}>
									<TableCell className="font-medium">{line.productName}</TableCell>
									<TableCell className="font-mono text-xs">{line.sku}</TableCell>
									<TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
									<TableCell>{writeOffReasonLabel(line.reason)}</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(line.unitCostMinor)}
									</TableCell>
									<TableCell className="text-muted-foreground">{line.note ?? "—"}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{approval ? (
				<ApprovalSummaryCard
					title="Approval"
					approval={approval}
					branchName={branchName ?? writeOff.branchName}
				/>
			) : null}

			{canWithdraw && writeOff.status === "PENDING_APPROVAL" ? (
				<div className="flex flex-wrap items-center justify-end gap-2">
					<p className="mr-auto text-xs text-muted-foreground">
						Only the person who raised this write-off can withdraw it while it is pending.
					</p>
					<Button
						type="button"
						variant="ghost"
						className="text-destructive hover:text-destructive"
						onClick={onWithdraw}
						disabled={withdrawing}
					>
						{withdrawing ? "Withdrawing…" : "Withdraw write-off"}
					</Button>
				</div>
			) : null}
		</div>
	)
}
