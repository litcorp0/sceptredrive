import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { PaymentDetailsPanel } from "#/components/suppliers/payment-details-panel"
import { SupplierFormDialog } from "#/components/suppliers/supplier-form-dialog"
import {
	ArchiveSupplierDialog,
	ReactivateSupplierButton,
} from "#/components/suppliers/supplier-lifecycle-dialogs"
import { SupplierOverview } from "#/components/suppliers/supplier-overview"
import { SupplierProductsPanel } from "#/components/suppliers/supplier-products-panel"
import { Button } from "#/components/ui/button"
import { api } from "#/lib/api"
import type { Supplier } from "#/lib/api-types"
import { hasPermission } from "#/lib/role"

export const Route = createFileRoute("/_authenticated/suppliers/$supplierId")({
	component: SupplierDetailPage,
})

function SupplierDetailPage() {
	const { supplierId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const canEdit = hasPermission(session.user.role, "supplier.update")
	const canArchive = hasPermission(session.user.role, "supplier.archive")

	const [editOpen, setEditOpen] = useState(false)
	const [archiveOpen, setArchiveOpen] = useState(false)

	const supplierQuery = useQuery({
		queryKey: ["supplier", supplierId],
		queryFn: () => api.suppliers.get(supplierId),
	})

	const detail = supplierQuery.data
	const supplier = detail?.supplier

	if (supplierQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading supplier…</p>
	}

	if (supplierQuery.isError || !detail || !supplier) {
		return <p className="text-sm text-destructive">Couldn't load this supplier.</p>
	}

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Link
						to="/suppliers"
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
						Suppliers
					</Link>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<h2 className="text-lg font-semibold tracking-tight">{supplier.name}</h2>
						{supplierStatus(supplier)}
						<StatusBadge tone="zinc">
							<span className="font-mono">{supplier.code}</span>
						</StatusBadge>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						{supplier.contactName ?? "No contact"}
						{supplier.phone ? ` · ${supplier.phone}` : ""}
						{supplier.email ? ` · ${supplier.email}` : ""}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{canEdit ? (
						<Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
							Edit details
						</Button>
					) : null}
					{canArchive && supplier.status === "ACTIVE" ? (
						<Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
							Archive
						</Button>
					) : null}
					{canArchive && supplier.status === "ARCHIVED" ? (
						<ReactivateSupplierButton supplier={supplier} />
					) : null}
				</div>
			</div>

			<SupplierOverview supplier={supplier} />
			<PaymentDetailsPanel
				supplierId={supplier.id}
				paymentDetails={detail.paymentDetails}
				canEdit={canEdit}
			/>
			<SupplierProductsPanel
				supplierId={supplier.id}
				products={detail.products}
				canEdit={canEdit}
			/>

			<SupplierFormDialog open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />
			<ArchiveSupplierDialog open={archiveOpen} onOpenChange={setArchiveOpen} supplier={supplier} />
		</div>
	)
}

function supplierStatus(supplier: Supplier) {
	if (supplier.status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}
