import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/procurement/")({
	beforeLoad: () => {
		throw redirect({ to: "/procurement/orders" })
	},
})
