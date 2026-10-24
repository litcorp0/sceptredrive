import { createFileRoute } from "@tanstack/react-router"
import { TransferDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/transfers/$transferId")({
	component: TransferDetailPage,
})
