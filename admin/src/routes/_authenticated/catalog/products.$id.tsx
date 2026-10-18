import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/catalog/products/$id")({
	component: () => null,
})
