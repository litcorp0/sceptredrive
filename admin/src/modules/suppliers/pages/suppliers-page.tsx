import { getRouteApi } from "@tanstack/react-router"
import { SupplierList } from "../components/supplier-list"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * The suppliers tab. The list is a connected component because it owns its search, pagination and
 * the create dialog; this page only resolves the session role the permission gates read.
 */
export function SuppliersPage() {
	const { session } = authenticatedRoute.useRouteContext()

	return <SupplierList role={session.user.role} />
}
