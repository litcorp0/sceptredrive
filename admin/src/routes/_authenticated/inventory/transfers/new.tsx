import { createFileRoute } from "@tanstack/react-router"
import { TransferNewPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/transfers/new")({
	component: TransferNewPage,
})
