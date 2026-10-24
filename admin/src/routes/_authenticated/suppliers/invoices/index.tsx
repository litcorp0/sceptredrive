import { formatDay, toDateInputValue } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { TableMessage } from "#/components/common/table-message"
import { InvoiceStatusBadge } from "#/components/payables/invoice-status-badge"
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
import { Switch } from "#/components/ui/switch"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { SupplierInvoice, SupplierInvoiceStatus } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
// TODO(phase-8/11): this screen is payables'; Plan 11 moves it into modules/payables and keeps the
// supplier read through the suppliers barrel.
import { getSupplier } from "#/modules/suppliers"

export const Route = createFileRoute("/_authenticated/suppliers/invoices/")({
	validateSearch: (search: Record<string, unknown>): { supplierId?: string } => ({
		supplierId: typeof search.supplierId === "string" ? search.supplierId : undefined,
	}),
	component: InvoicesTab,
})

const PAGE_SIZE = 20

function InvoicesTab() {
	const { session } = Route.useRouteContext()
	const { supplierId } = Route.useSearch()
	const navigate = Route.useNavigate()
	const { branches, activeBranchId, canSelectBranch } = useBranch()
	const canManage = hasPermission(session.user.role, "payable.invoice.manage")

	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [status, setStatus] = useState<"ALL" | SupplierInvoiceStatus>("ALL")
	const [branchFilter, setBranchFilter] = useState(activeBranchId ?? "all")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [overdue, setOverdue] = useState(false)
	const [offset, setOffset] = useState(0)

	const initialSupplierQuery = useQuery({
		queryKey: ["supplier", supplierId],
		queryFn: () => getSupplier(supplierId as string),
		enabled: Boolean(supplierId) && supplier === null,
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

	const effectiveSupplierId = supplier?.id ?? supplierId

	const filters = {
		supplierId: effectiveSupplierId,
		branchId: canSelectBranch && branchFilter !== "all" ? branchFilter : undefined,
		status: status === "ALL" ? undefined : status,
		overdue: overdue ? true : undefined,
		from: from || undefined,
		to: to || undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const invoicesQuery = useQuery({
		queryKey: ["supplier-invoices", filters],
		queryFn: () => api.payables.invoices.list(filters),
	})

	const invoices = invoicesQuery.data?.invoices ?? []
	const total = invoicesQuery.data?.total ?? 0
	const today = toDateInputValue(new Date())

	function resetOffset() {
		setOffset(0)
	}

	function clearSupplier() {
		setSupplier(null)
		if (supplierId) void navigate({ search: {}, replace: true })
		resetOffset()
	}

	return (
		<section>
			<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="grid gap-1.5">
					<Label>Supplier</Label>
					<SupplierCombobox
						value={supplier}
						onSelect={(next) => {
							setSupplier(next)
							resetOffset()
						}}
					/>
					{supplier ? (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="h-auto justify-start px-0 text-muted-foreground"
							onClick={clearSupplier}
						>
							Clear supplier
						</Button>
					) : null}
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="invoice-status-filter">Status</Label>
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus(value as "ALL" | SupplierInvoiceStatus)
							resetOffset()
						}}
					>
						<SelectTrigger id="invoice-status-filter" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All statuses</SelectItem>
							<SelectItem value="OPEN">Open</SelectItem>
							<SelectItem value="PARTIAL">Partial</SelectItem>
							<SelectItem value="PAID">Paid</SelectItem>
							<SelectItem value="VOID">Void</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="invoice-branch-filter">Branch</Label>
						<Select
							value={branchFilter}
							onValueChange={(value) => {
								setBranchFilter(value)
								resetOffset()
							}}
						>
							<SelectTrigger id="invoice-branch-filter" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All branches</SelectItem>
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
					<Label htmlFor="invoice-from-filter">Invoice date</Label>
					<div className="flex items-center gap-1.5">
						<Input
							id="invoice-from-filter"
							type="date"
							value={from}
							onChange={(event) => {
								setFrom(event.target.value)
								resetOffset()
							}}
							aria-label="Invoice date from"
						/>
						<Input
							type="date"
							value={to}
							onChange={(event) => {
								setTo(event.target.value)
								resetOffset()
							}}
							aria-label="Invoice date to"
						/>
					</div>
				</div>
			</div>

			<div className="mb-3 flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<Switch
						id="invoice-overdue-filter"
						checked={overdue}
						onCheckedChange={(checked) => {
							setOverdue(checked)
							resetOffset()
						}}
					/>
					<Label htmlFor="invoice-overdue-filter" className="text-sm text-muted-foreground">
						Overdue only
					</Label>
				</div>

				{canManage ? (
					<Button size="sm" className="ml-auto" asChild>
						<Link to="/suppliers/invoices/new" search={{ supplierId: effectiveSupplierId }}>
							<PlusIcon className="size-4" aria-hidden="true" />
							New invoice
						</Link>
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-28">Number</TableHead>
							<TableHead>Supplier</TableHead>
							<TableHead className="w-32">Supplier inv #</TableHead>
							{canSelectBranch ? <TableHead className="w-28">Branch</TableHead> : null}
							<TableHead className="w-28">Invoiced</TableHead>
							<TableHead className="w-28">Due</TableHead>
							<TableHead className="w-28 text-right">Total</TableHead>
							<TableHead className="w-24 text-right">Paid</TableHead>
							<TableHead className="w-28 text-right">Outstanding</TableHead>
							<TableHead className="w-32">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{invoicesQuery.isLoading ? (
							<TableMessage colSpan={canSelectBranch ? 10 : 9}>Loading invoices…</TableMessage>
						) : invoicesQuery.isError ? (
							<TableMessage colSpan={canSelectBranch ? 10 : 9} tone="error">
								Couldn't load supplier invoices.
							</TableMessage>
						) : invoices.length === 0 ? (
							<TableMessage colSpan={canSelectBranch ? 10 : 9}>
								No invoices match these filters.
							</TableMessage>
						) : (
							invoices.map((invoice) => (
								<TableRow key={invoice.id}>
									<TableCell>
										<Link
											to="/suppliers/invoices/$invoiceId"
											params={{ invoiceId: invoice.id }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{invoice.number}
										</Link>
									</TableCell>
									<TableCell className="max-w-48">
										<Link
											to="/suppliers/$supplierId"
											params={{ supplierId: invoice.supplierId }}
											className="block truncate hover:underline"
										>
											{invoice.supplierName}
										</Link>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{invoice.supplierInvoiceNumber}
									</TableCell>
									{canSelectBranch ? (
										<TableCell className="text-muted-foreground">{invoice.branchCode}</TableCell>
									) : null}
									<TableCell className="text-muted-foreground">
										{formatDay(invoice.invoiceDate)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDay(invoice.dueDate)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(invoice.totalMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-muted-foreground">
										{formatGhs(invoice.amountPaidMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(invoice.outstandingMinor)}
									</TableCell>
									<TableCell>
										<InvoiceStatusBadge
											status={invoice.status}
											overdue={isOverdue(invoice, today)}
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
		</section>
	)
}

function isOverdue(invoice: SupplierInvoice, today: string): boolean {
	if (invoice.status === "VOID" || invoice.status === "PAID") return false
	return invoice.dueDate < today
}
