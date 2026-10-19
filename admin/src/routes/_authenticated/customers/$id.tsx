import { createFileRoute, Outlet } from "@tanstack/react-router"

// Thin layout: `/customers/$id` renders its index (profile) and, later in this
// plan, the statement child at `/customers/$id/statement`.
export const Route = createFileRoute("/_authenticated/customers/$id")({
	component: () => <Outlet />,
})
