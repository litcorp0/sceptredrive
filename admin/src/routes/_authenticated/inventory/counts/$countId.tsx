import { createFileRoute } from "@tanstack/react-router"
import { CountDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/counts/$countId")({
	component: CountDetailPage,
})
