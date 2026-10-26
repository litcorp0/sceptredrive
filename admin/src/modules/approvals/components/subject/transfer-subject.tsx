import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
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
import { transferDetailOptions } from "#/modules/inventory"
import type { ApprovalSubject } from "../../types"

type TransferSubjectArm = Extract<ApprovalSubject, { kind: "transfer" }>

/**
 * A branch transfer waiting for the source manager's approval.
 *
 * The arm carries both branch ids and the line count; the lines themselves — including what the
 * source branch actually has on hand — are read through the inventory barrel, whose own access
 * check decides whether this actor may see the transfer at all.
 */
export function TransferSubject({
	subject,
	amountMinor,
}: {
	subject: TransferSubjectArm
	amountMinor: number | null
}) {
	const { branches } = useBranch()
	const transferQuery = useQuery(transferDetailOptions(subject.transferId))
	const transfer = transferQuery.data?.transfer
	const lines = transfer?.lines ?? []

	const branchName = (branchId: string, fallback: string) =>
		branches.find((branch) => branch.id === branchId)?.name ?? fallback

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{branchName(subject.fromBranchId, "Source branch")} →{" "}
					{branchName(subject.toBranchId, "Destination branch")}
				</CardTitle>
				<CardDescription>
					Approving lets the source branch dispatch the stock. Rejecting leaves every level
					untouched.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<div className="flex flex-wrap justify-between gap-2">
					<span className="text-muted-foreground">Goods value</span>
					<span className="font-medium tabular-nums">
						{amountMinor === null ? "—" : formatGhs(amountMinor)}
					</span>
				</div>

				<div className="min-w-0 rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Product</TableHead>
								<TableHead>SKU</TableHead>
								<TableHead className="text-right">Requested</TableHead>
								<TableHead className="text-right">On hand at source</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{transferQuery.isLoading ? (
								<TableMessage colSpan={4} state="loading" rows={2}>
									Loading transfer lines…
								</TableMessage>
							) : transferQuery.isError ? (
								<TableMessage colSpan={4} state="error">
									Couldn't load the transfer lines.
								</TableMessage>
							) : lines.length === 0 ? (
								<TableMessage colSpan={4} state="empty">
									This transfer has no lines.
								</TableMessage>
							) : (
								lines.map((line) => (
									<TableRow key={line.id}>
										<TableCell className="font-medium">{line.productName}</TableCell>
										<TableCell className="font-mono text-xs">{line.sku}</TableCell>
										<TableCell className="text-right tabular-nums">
											{line.quantityRequested}
										</TableCell>
										<TableCell className="text-right tabular-nums">{line.fromOnHand}</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>

				<Link
					to="/inventory/transfers/$transferId"
					params={{ transferId: subject.transferId }}
					className="w-fit text-sm font-medium text-primary hover:underline"
				>
					Open the transfer
				</Link>
			</CardContent>
		</Card>
	)
}
