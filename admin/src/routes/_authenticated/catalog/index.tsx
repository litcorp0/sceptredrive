import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/catalog/")({
	beforeLoad: () => {
		throw redirect({ to: "/catalog/products" })
	},
})
