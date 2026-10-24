import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
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
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
// This screen is payables' even though its URL says suppliers; the supplier read stays on the
// suppliers barrel.
import { supplierDetailOptions } from "#/modules/suppliers"
import { paymentListOptions } from "../api/payables"
import { PaymentFormDialog } from "../components/payment-form-dialog"
import { PaymentMethodBadge } from "../components/payment-method-badge"
import type { SupplierPaymentMethod, SupplierPaymentStatus } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")
const paymentsRoute = getRouteApi("/_authenticated/suppliers/payments/")

const PAGE_SIZE = 20

/**
 * Supplier payments, filtered and paged. Amount, allocated and on-account figures are the API's
 * `amountMinor`, `allocatedMinor` and `unallocatedMinor`; the console never nets them itself.
 */
export function PaymentsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { supplierId } = paymentsRoute.useSearch()
	const navigate = paymentsRoute.useNavigate()
	const { branches, activeBranchId, canSelectBranch } = useBranch()
	const canRecord = hasPermission(session.user.role, "payable.payment")

	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [method, setMethod] = useState<"ALL" | SupplierPaymentMethod>("ALL")
	const [status, setStatus] = useState<"ALL" | SupplierPaymentStatus>("ALL")
	const [branchFilter, setBranchFilter] = useState(activeBranchId ?? "all")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [offset, setOffset] = useState(0)
	const [dialogOpen, setDialogOpen] = useState(false)

	const initialSupplierQuery = useQuery({
		...supplierDetailOptions(supplierId as string),
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
		method: method === "ALL" ? undefined : method,
		status: status === "ALL" ? undefined : status,
		from: from || undefined,
		to: to || undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const paymentsQuery = useQuery(paymentListOptions(filters))

	const payments = paymentsQuery.data?.payments ?? []
	const total = paymentsQuery.data?.total ?? 0

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
			<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
					<Label htmlFor="payment-method-filter">Method</Label>
					<Select
						value={method}
						onValueChange={(value) => {
							setMethod(value as "ALL" | SupplierPaymentMethod)
							resetOffset()
						}}
					>
						<SelectTrigger id="payment-method-filter" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All methods</SelectItem>
							<SelectItem value="CASH">Cash</SelectItem>
							<SelectItem value="BANK">Bank</SelectItem>
							<SelectItem value="MOMO">MoMo</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="payment-status-filter">Status</Label>
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus(value as "ALL" | SupplierPaymentStatus)
							resetOffset()
						}}
					>
						<SelectTrigger id="payment-status-filter" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All statuses</SelectItem>
							<SelectItem value="COMPLETED">Completed</SelectItem>
							<SelectItem value="VOID">Void</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="payment-branch-filter">Branch</Label>
						<Select
							value={branchFilter}
							onValueChange={(value) => {
								setBranchFilter(value)
								resetOffset()
							}}
						>
							<SelectTrigger id="payment-branch-filter" className="w-full">
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
					<Label htmlFor="payment-from-filter">Paid at</Label>
					<div className="flex items-center gap-1.5">
						<Input
							id="payment-from-filter"
							type="date"
							value={from}
							onChange={(event) => {
								setFrom(event.target.value)
								resetOffset()
							}}
							aria-label="Paid from"
						/>
						<Input
							type="date"
							value={to}
							onChange={(event) => {
								setTo(event.target.value)
								resetOffset()
							}}
							aria-label="Paid to"
						/>
					</div>
				</div>
			</div>

			<div className="mb-3 flex justify-end">
				{canRecord ? (
					<Button size="sm" onClick={() => setDialogOpen(true)}>
						<PlusIcon className="size-4" aria-hidden="true" />
						Record payment
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-28">Number</TableHead>
							<TableHead>Supplier</TableHead>
							{canSelectBranch ? <TableHead className="w-28">Branch</TableHead> : null}
							<TableHead className="w-24">Method</TableHead>
							<TableHead className="w-28">Paid at</TableHead>
							<TableHead className="w-28 text-right">Amount</TableHead>
							<TableHead className="w-28 text-right">Allocated</TableHead>
							<TableHead className="w-28 text-right">On account</TableHead>
							<TableHead className="w-24">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{paymentsQuery.isLoading ? (
							<TableMessage colSpan={canSelectBranch ? 9 : 8}>Loading payments…</TableMessage>
						) : paymentsQuery.isError ? (
							<TableMessage colSpan={canSelectBranch ? 9 : 8} tone="error">
								Couldn't load supplier payments.
							</TableMessage>
						) : payments.length === 0 ? (
							<TableMessage colSpan={canSelectBranch ? 9 : 8}>
								No payments match these filters.
							</TableMessage>
						) : (
							payments.map((payment) => (
								<TableRow key={payment.id}>
									<TableCell>
										<Link
											to="/suppliers/payments/$paymentId"
											params={{ paymentId: payment.id }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{payment.number}
										</Link>
									</TableCell>
									<TableCell className="max-w-48">
										<Link
											to="/suppliers/$supplierId"
											params={{ supplierId: payment.supplierId }}
											className="block truncate hover:underline"
										>
											{payment.supplierName}
										</Link>
									</TableCell>
									{canSelectBranch ? (
										<TableCell className="text-muted-foreground">{payment.branchCode}</TableCell>
									) : null}
									<TableCell>
										<PaymentMethodBadge method={payment.method} />
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDay(payment.paidAt)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(payment.amountMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-muted-foreground">
										{formatGhs(payment.allocatedMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(payment.unallocatedMinor)}
									</TableCell>
									<TableCell>
										{payment.status === "VOID" ? (
											<StatusBadge tone="zinc">Void</StatusBadge>
										) : (
											<StatusBadge tone="green">Completed</StatusBadge>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />

			<PaymentFormDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				initialSupplier={supplier}
			/>
		</section>
	)
}
