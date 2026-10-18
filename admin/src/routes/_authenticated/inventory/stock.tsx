import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/inventory/stock")({
	component: () => <Outlet />,
})
