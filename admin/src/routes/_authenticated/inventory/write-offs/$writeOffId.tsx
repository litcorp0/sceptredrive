import { createFileRoute } from "@tanstack/react-router"
import { WriteOffDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/write-offs/$writeOffId")({
	component: WriteOffDetailPage,
})
