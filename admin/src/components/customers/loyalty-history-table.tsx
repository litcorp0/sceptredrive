import { formatCount, formatDateTime } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import type { LoyaltyEntry } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import {
	LOYALTY_KIND_LABELS,
	LOYALTY_KIND_TONES,
	LOYALTY_REASON_LABELS,
	signedPoints,
} from "#/lib/loyalty"

/**
 * The loyalty ledger for one customer: recent entries in the order the API
 * returns them (newest first), with the signed points and where they landed.
 */
export function LoyaltyHistoryTable({
	entries,
	entryTotal,
	isLoading,
	isError,
}: {
	entries: LoyaltyEntry[]
	entryTotal: number
	isLoading: boolean
	isError: boolean
}) {
	const { branches } = useBranch()
	const branchName = (branchId: string | null) =>
		branchId === null ? "Global" : (branches.find((branch) => branch.id === branchId)?.name ?? "—")

	return (
		<section>
			<h3 className="mb-2 text-sm font-medium">History</h3>
			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-44">Date</TableHead>
							<TableHead className="w-28">Kind</TableHead>
							<TableHead className="w-24 text-right">Points</TableHead>
							<TableHead className="w-32">Reason</TableHead>
							<TableHead className="w-36">Branch</TableHead>
							<TableHead className="w-32">Reference</TableHead>
							<TableHead>Note</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableMessage colSpan={7}>Loading history…</TableMessage>
						) : isError ? (
							<TableMessage colSpan={7} tone="error">
								Couldn't load the loyalty history.
							</TableMessage>
						) : entries.length === 0 ? (
							<TableMessage colSpan={7}>No loyalty activity yet.</TableMessage>
						) : (
							entries.map((entry) => (
								<TableRow key={entry.id}>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDateTime(entry.occurredAt)}
									</TableCell>
									<TableCell>
										<StatusBadge tone={LOYALTY_KIND_TONES[entry.kind]}>
											{LOYALTY_KIND_LABELS[entry.kind]}
										</StatusBadge>
									</TableCell>
									<TableCell
										className={
											entry.pointsDelta < 0
												? "text-right tabular-nums font-medium text-amber-700"
												: "text-right tabular-nums font-medium text-emerald-700"
										}
									>
										{signedPoints(entry.pointsDelta)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{entry.reasonCode ? LOYALTY_REASON_LABELS[entry.reasonCode] : "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{branchName(entry.branchId)}
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{entry.referenceNumber ?? "—"}
									</TableCell>
									<TableCell className="max-w-64">
										{entry.note ? (
											<span className="line-clamp-1 text-muted-foreground" title={entry.note}>
												{entry.note}
											</span>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			{!isLoading && !isError && entryTotal > entries.length ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Showing the latest {entries.length} of {formatCount(entryTotal)} entries.
				</p>
			) : null}
		</section>
	)
}
