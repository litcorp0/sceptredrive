import { createFileRoute } from "@tanstack/react-router"
import { SupplierList } from "#/components/suppliers/supplier-list"

export const Route = createFileRoute("/_authenticated/suppliers/")({
	component: SuppliersTab,
})

function SuppliersTab() {
	const { session } = Route.useRouteContext()

	return <SupplierList role={session.user.role} />
}
