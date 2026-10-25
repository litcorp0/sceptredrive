import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { PageHeader } from "#/components/common/page-header"
import { hasPermission } from "#/lib/role"
import { OrderForm } from "../components/order-form"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * Raise a draft purchase order. A draft commits nothing; submitting it applies the branch
 * approval limit, which is why the form stops at `Create draft`.
 */
export function OrderNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const navigate = useNavigate()
	const canCreate = hasPermission(session.user.role, "procurement.create")

	if (!canCreate) {
		return (
			<section className="mx-auto max-w-3xl">
				<BackLink />
				<p className="text-sm text-muted-foreground">
					You don't have permission to raise purchase orders.
				</p>
			</section>
		)
	}

	return (
		<section className="mx-auto max-w-4xl">
			<BackLink />
			<PageHeader
				title="New purchase order"
				description="Order goods from a supplier. The order is a draft until you submit it."
			/>
			<OrderForm
				mode="create"
				onSaved={(order) => {
					void navigate({
						to: "/procurement/orders/$orderId",
						params: { orderId: order.order.id },
					})
				}}
			/>
		</section>
	)
}

function BackLink() {
	return (
		<Link
			to="/procurement/orders"
			className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeftIcon className="size-4" aria-hidden="true" />
			Purchase orders
		</Link>
	)
}
