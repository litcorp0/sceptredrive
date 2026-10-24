import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { hasPermission } from "#/lib/role"
import { supplierDetailOptions } from "../api/suppliers"
import { PaymentDetailsPanel } from "../components/payment-details-panel"
import { SupplierFormDialog } from "../components/supplier-form-dialog"
import {
	ArchiveSupplierDialog,
	ReactivateSupplierButton,
} from "../components/supplier-lifecycle-dialogs"
import { SupplierOverview } from "../components/supplier-overview"
import { SupplierProductsPanel } from "../components/supplier-products-panel"
import { SupplierStatusBadge } from "../ui/supplier-status-badge"

const authenticatedRoute = getRouteApi("/_authenticated")
const supplierDetailRoute = getRouteApi("/_authenticated/suppliers/$supplierId")

/**
 * One supplier: its identity and terms, the payment destinations masked in the panel, and the
 * supplied products with their last cost. Every action is gated on the role's supplier permission,
 * and the lifecycle dialogs keep the server's archive/reactivate guards.
 */
export function SupplierDetailPage() {
	const { supplierId } = supplierDetailRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const canEdit = hasPermission(session.user.role, "supplier.update")
	const canArchive = hasPermission(session.user.role, "supplier.archive")

	const [editOpen, setEditOpen] = useState(false)
	const [archiveOpen, setArchiveOpen] = useState(false)

	const supplierQuery = useQuery(supplierDetailOptions(supplierId))

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
						<SupplierStatusBadge status={supplier.status} />
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
