import { createFileRoute } from "@tanstack/react-router"
import { OpeningDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/openings/$openingId")({
	component: OpeningDetailPage,
})
