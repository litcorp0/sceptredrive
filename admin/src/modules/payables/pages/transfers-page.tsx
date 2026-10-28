import { formatDay, TRANSFER_STATUS_LABELS, TRANSFER_STATUSES } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon, ShieldAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
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
import { settingsListOptions } from "#/modules/settings"
import { supplierDetailOptions } from "#/modules/suppliers"
import { transferListOptions } from "../api/payables"
import { TransferDialog } from "../components/transfer-dialog"
import { TransferStatusBadge } from "../components/transfer-status-badge"
import type { TransferStatus } from "../types"
import { readFlag } from "../utils/flags"
import type { TransferSearch } from "../utils/transfer-search"

const authenticatedRoute = getRouteApi("/_authenticated")
const transfersRoute = getRouteApi("/_authenticated/suppliers/transfers/")

const PAGE_SIZE = 20

/**
 * The transfer intents, filtered and paged. A row is an instruction, not a payment: only
 * `SUCCESS` rows carry a settled date, and the detail screen links the payment when one exists.
 */
export function TransfersPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const search = transfersRoute.useSearch()
	const navigate = transfersRoute.useNavigate()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	const canTransfer = hasPermission(session.user.role, "payable.transfer")

	const settingsQuery = useQuery(settingsListOptions())
	const transfersEnabled = readFlag(settingsQuery.data?.settings, "flag.supplierTransfers")

	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)
	const autoOpened = useRef(false)

	const initialSupplierQuery = useQuery({
		...supplierDetailOptions(search.supplierId as string),
		enabled: Boolean(search.supplierId) && supplier === null,
	})
	useEffect(() => {
		const data = initialSupplierQuery.data
		if (!data || supplier !== null) return
		setSupplier({
			id: data.supplier.id,
			code: data.supplier.code,
			name: data.supplier.name,
			paymentTermDays: data.supplier.paymentTermDays,
		})
	}, [initialSupplierQuery.data, supplier])

	// A supplier's payment-detail row links here with `?dialog=transfer`; wait for the
	// supplier to resolve so the dialog opens with the right one, and open it once.
	useEffect(() => {
		if (search.dialog !== "transfer") {
			autoOpened.current = false
			return
		}
		if (autoOpened.current) return
		if (search.supplierId && supplier === null) return
		autoOpened.current = true
		setDialogOpen(true)
	}, [search.dialog, search.supplierId, supplier])

	const requestedBranch = canSelectBranch ? search.branchId : undefined
	const branchId =
		requestedBranch === "ALL" ? undefined : (requestedBranch ?? activeBranchId ?? undefined)

	const filters = {
		supplierId: supplier?.id ?? search.supplierId,
		branchId,
		status: search.status,
		from: search.from,
		to: search.to,
		limit: PAGE_SIZE,
		offset: search.offset ?? 0,
	}

	const transfersQuery = useQuery(transferListOptions(filters))
	const denied = transfersQuery.error instanceof ApiError && transfersQuery.error.status === 403
	const requestId =
		transfersQuery.error instanceof ApiError ? transfersQuery.error.requestId : undefined
	const transfers = transfersQuery.data?.transfers ?? []
	const total = transfersQuery.data?.total ?? 0
	const columns = canSelectBranch ? 8 : 7

	function updateSearch(patch: Partial<TransferSearch>) {
		void navigate({ search: (prev: TransferSearch) => ({ ...prev, ...patch }) })
	}

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Suppliers"
				title="Supplier transfers"
				description="What we asked Paystack to pay, and what happened. A transfer is an instruction; the payment appears only after the provider confirms the money moved."
				actions={
					transfersEnabled ? (
						<>
							<Button asChild size="sm" variant="outline">
								<Link to="/suppliers/reconciliation">Reconciliation</Link>
							</Button>
							{canTransfer ? (
								<Button size="sm" onClick={() => setDialogOpen(true)}>
									<PlusIcon className="size-4" aria-hidden="true" />
									Transfer
								</Button>
							) : null}
						</>
					) : undefined
				}
			/>

			{!transfersEnabled ? (
				<output className="block rounded-md border border-dashed p-3 text-sm text-muted-foreground">
					Supplier transfers are switched off in settings. Record payments by hand instead.
				</output>
			) : null}

			{denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see supplier transfers"
					description="This screen needs payable.read. Ask an administrator if you need access."
				/>
			) : (
				<>
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
						<div className="grid gap-1.5">
							<Label>Supplier</Label>
							<SupplierCombobox
								value={supplier}
								onSelect={(next) => {
									setSupplier(next)
									updateSearch({ supplierId: next?.id, offset: undefined })
								}}
							/>
							{supplier ? (
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-auto justify-start px-0 text-muted-foreground"
									onClick={() => {
										setSupplier(null)
										updateSearch({ supplierId: undefined, offset: undefined })
									}}
								>
									Clear supplier
								</Button>
							) : null}
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="transfer-status-filter">Status</Label>
							<Select
								value={search.status ?? "ALL"}
								onValueChange={(value) =>
									updateSearch({
										status: value === "ALL" ? undefined : (value as TransferStatus),
										offset: undefined,
									})
								}
							>
								<SelectTrigger id="transfer-status-filter" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ALL">All statuses</SelectItem>
									{TRANSFER_STATUSES.map((status) => (
										<SelectItem key={status} value={status}>
											{TRANSFER_STATUS_LABELS[status]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="transfer-branch-filter">Branch</Label>
								<Select
									value={search.branchId ?? (activeBranchId === null ? "ALL" : activeBranchId)}
									onValueChange={(value) =>
										updateSearch({
											branchId: value === "ALL" ? "ALL" : value,
											offset: undefined,
										})
									}
								>
									<SelectTrigger id="transfer-branch-filter" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="ALL">All branches</SelectItem>
										{branches.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}

						<div className="grid gap-1.5">
							<Label htmlFor="transfer-from-filter">Created</Label>
							<div className="flex items-center gap-1.5">
								<Input
									id="transfer-from-filter"
									type="date"
									value={search.from ?? ""}
									onChange={(event) =>
										updateSearch({ from: event.target.value || undefined, offset: undefined })
									}
									aria-label="Created from"
								/>
								<Input
									type="date"
									value={search.to ?? ""}
									onChange={(event) =>
										updateSearch({ to: event.target.value || undefined, offset: undefined })
									}
									aria-label="Created to"
								/>
							</div>
						</div>
					</div>

					<div className="rounded-lg border bg-card">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Reference</TableHead>
									<TableHead>Supplier</TableHead>
									{canSelectBranch ? <TableHead className="w-28">Branch</TableHead> : null}
									<TableHead className="w-28 text-right">Amount</TableHead>
									<TableHead className="w-32">Status</TableHead>
									<TableHead className="w-28">Created</TableHead>
									<TableHead className="w-28">Settled</TableHead>
									<TableHead className="w-40">Failure</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{transfersQuery.isLoading ? (
									<TableMessage colSpan={columns} state="loading" rows={6}>
										Loading transfers…
									</TableMessage>
								) : transfersQuery.isError ? (
									<TableMessage colSpan={columns} state="error">
										Couldn&rsquo;t load supplier transfers.
										{requestId ? ` Request ${requestId}.` : ""}
									</TableMessage>
								) : transfers.length === 0 ? (
									<TableMessage colSpan={columns}>No transfers match these filters.</TableMessage>
								) : (
									transfers.map((transfer) => (
										<TableRow key={transfer.id}>
											<TableCell>
												<Link
													to="/suppliers/transfers/$transferId"
													params={{ transferId: transfer.id }}
													className="font-mono text-xs font-medium hover:underline"
												>
													{transfer.reference}
												</Link>
											</TableCell>
											<TableCell className="max-w-48">
												<Link
													to="/suppliers/$supplierId"
													params={{ supplierId: transfer.supplierId }}
													className="block truncate hover:underline"
												>
													{transfer.supplierName}
												</Link>
											</TableCell>
											{canSelectBranch ? (
												<TableCell className="text-muted-foreground">
													{branches.find((branch) => branch.id === transfer.branchId)?.code ?? "—"}
												</TableCell>
											) : null}
											<TableCell className="text-right tabular-nums">
												{formatGhs(transfer.amountMinor)}
											</TableCell>
											<TableCell>
												<TransferStatusBadge status={transfer.status} />
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDay(transfer.createdAt)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{transfer.settledAt ? formatDay(transfer.settledAt) : "—"}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{transfer.failureCode ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{total > 0 ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={search.offset ?? 0}
							onOffsetChange={(offset) =>
								updateSearch({ offset: offset === 0 ? undefined : offset })
							}
						/>
					) : null}
				</>
			)}

			{transfersEnabled && canTransfer ? (
				<TransferDialog
					open={dialogOpen}
					onOpenChange={(open) => {
						setDialogOpen(open)
						if (!open && search.dialog) {
							updateSearch({ dialog: undefined, paymentDetailId: undefined })
						}
					}}
					initialSupplier={supplier}
					fixedSupplierId={search.dialog === "transfer" ? (search.supplierId ?? null) : null}
					initialPaymentDetailId={search.paymentDetailId ?? ""}
				/>
			) : null}
		</div>
	)
}
