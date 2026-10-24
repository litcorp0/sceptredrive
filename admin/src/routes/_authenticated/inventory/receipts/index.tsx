import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { TableMessage } from "#/components/common/table-message"
import { ReceiveDialog } from "#/components/inventory/receive-dialog"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
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

export const Route = createFileRoute("/_authenticated/inventory/receipts/")({
	component: ReceiptsTab,
})

const PAGE_SIZE = 20

function ReceiptsTab() {
	const { session } = Route.useRouteContext()
	const { activeBranchId, activeBranch, canSelectBranch } = useBranch()
	const canReceive = hasPermission(session.user.role, "inventory.receive")

	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [offset, setOffset] = useState(0)
	const [receiveOpen, setReceiveOpen] = useState(false)

	const filters = {
		branchId: activeBranchId ?? undefined,
		from: from || undefined,
		to: to || undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const receiptsQuery = useQuery({
		queryKey: ["inventory-receipts", filters],
		queryFn: () => api.inventory.receipts.list(filters),
	})

	const receipts = receiptsQuery.data?.receipts ?? []
	const total = receiptsQuery.data?.total ?? 0

	function resetOffset() {
		setOffset(0)
	}

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="receipt-from-filter">Received between</Label>
					<div className="flex items-center gap-1.5">
						<Input
							id="receipt-from-filter"
							type="date"
							value={from}
							onChange={(event) => {
								setFrom(event.target.value)
								resetOffset()
							}}
							aria-label="Received from"
						/>
						<Input
							type="date"
							value={to}
							onChange={(event) => {
								setTo(event.target.value)
								resetOffset()
							}}
							aria-label="Received to"
						/>
					</div>
				</div>

				{canReceive ? (
					<Button size="sm" className="ml-auto" onClick={() => setReceiveOpen(true)}>
						<PlusIcon className="size-4" aria-hidden="true" />
						Receive stock
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-28">Number</TableHead>
							{canSelectBranch ? <TableHead className="w-32">Branch</TableHead> : null}
							<TableHead>Supplier</TableHead>
							<TableHead className="w-36">Supplier inv #</TableHead>
							<TableHead className="w-20 text-right">Lines</TableHead>
							<TableHead className="w-32 text-right">Total cost</TableHead>
							<TableHead className="w-36">Received by</TableHead>
							<TableHead className="w-28">Received</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{receiptsQuery.isLoading ? (
							<TableMessage colSpan={canSelectBranch ? 8 : 7}>Loading receipts…</TableMessage>
						) : receiptsQuery.isError ? (
							<TableMessage colSpan={canSelectBranch ? 8 : 7} tone="error">
								Couldn't load goods receipts.
							</TableMessage>
						) : receipts.length === 0 ? (
							<TableMessage colSpan={canSelectBranch ? 8 : 7}>
								No goods receipts in this range.
							</TableMessage>
						) : (
							receipts.map((receipt) => (
								<TableRow key={receipt.id}>
									<TableCell>
										<Link
											to="/inventory/receipts/$receiptId"
											params={{ receiptId: receipt.id }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{receipt.number}
										</Link>
									</TableCell>
									{canSelectBranch ? (
										<TableCell className="text-muted-foreground">{receipt.branchCode}</TableCell>
									) : null}
									<TableCell className="max-w-48 truncate">
										{receipt.supplierId ? (
											<Link
												to="/suppliers/$supplierId"
												params={{ supplierId: receipt.supplierId }}
												className="hover:underline"
											>
												{receipt.supplierName ?? "—"}
											</Link>
										) : (
											(receipt.supplierName ?? "—")
										)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{receipt.supplierInvoiceNumber ?? "—"}
									</TableCell>
									<TableCell className="text-right tabular-nums">{receipt.lineCount}</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(receipt.totalCostMinor)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{receipt.createdBy ?? "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDay(receipt.createdAt)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />

			<ReceiveDialog
				open={receiveOpen}
				onOpenChange={setReceiveOpen}
				branchId={activeBranchId}
				branchName={activeBranch?.name ?? null}
				canPickSupplier={hasPermission(session.user.role, "supplier.read")}
			/>
		</section>
	)
}
