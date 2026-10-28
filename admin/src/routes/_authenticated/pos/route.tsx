import { createFileRoute } from "@tanstack/react-router"
import { PosOversightLayout } from "#/modules/pos-oversight"

export const Route = createFileRoute("/_authenticated/pos")({
	component: PosOversightLayout,
})
