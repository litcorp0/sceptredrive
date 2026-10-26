import { useQuery } from "@tanstack/react-query"
import { StatusBadge } from "#/components/common/status-badge"
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
import { formatGhs } from "#/lib/format"
import {
	writeOffDetailOptions,
	writeOffReasonLabel,
	writeOffStatusLabel,
	writeOffStatusTone,
} from "#/modules/inventory"
import type { ApprovalSubject } from "../../types"

type WriteOffSubjectArm = Extract<ApprovalSubject, { kind: "stock_write_off" }>

/**
 * A stock write-off waiting for an admin's decision.
 *
 * The value is frozen when the request is raised, and the lines carry the stored cost the
 * approved movement will use. The document's lines are read through the inventory barrel; the
 * arm itself carries the number and line count.
 */
export function WriteOffSubject({
	subject,
	amountMinor,
}: {
	subject: WriteOffSubjectArm
	amountMinor: number | null
}) {
	const detailQuery = useQuery(writeOffDetailOptions(subject.writeOffId))
	const detail = detailQuery.data
	const lines = detail?.lines ?? []
	const valueMinor = detail?.writeOff.valueMinor ?? amountMinor

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					Write-off {subject.number}
					{detail ? (
						<StatusBadge variant={writeOffStatusTone(detail.writeOff.status)}>
							{writeOffStatusLabel(detail.writeOff.status)}
						</StatusBadge>
					) : null}
				</CardTitle>
				<CardDescription>
					Approving posts one stock movement per line at the frozen cost. Rejecting posts nothing.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<div className="flex flex-wrap justify-between gap-2">
					<span className="text-muted-foreground">Frozen value</span>
					<span className="font-medium tabular-nums">
						{valueMinor === null ? "—" : formatGhs(valueMinor)}
					</span>
				</div>

				<div className="min-w-0 rounded-md border">
					<Table>
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
							{detailQuery.isLoading ? (
								<TableMessage colSpan={6} state="loading" rows={2}>
									Loading write-off lines…
								</TableMessage>
							) : detailQuery.isError ? (
								<TableMessage colSpan={6} state="error">
									Couldn't load the write-off lines.
								</TableMessage>
							) : lines.length === 0 ? (
								<TableMessage colSpan={6} state="empty">
									This write-off has no lines.
								</TableMessage>
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

				{detail ? (
					<p className="text-xs text-muted-foreground">
						The value is frozen at request time; the posted movements carry the same stored cost.
					</p>
				) : null}
			</CardContent>
		</Card>
	)
}
