import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/inventory/")({
	beforeLoad: () => {
		throw redirect({ to: "/inventory/stock" })
	},
})
