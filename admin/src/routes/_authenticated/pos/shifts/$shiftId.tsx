import { createFileRoute } from "@tanstack/react-router"
import { ShiftDetailPage } from "#/modules/pos-oversight"

export const Route = createFileRoute("/_authenticated/pos/shifts/$shiftId")({
	component: ShiftDetailPage,
})
