import { createFileRoute } from "@tanstack/react-router"
import { WriteOffNewPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/write-offs/new")({
	component: WriteOffNewPage,
})
