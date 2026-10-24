import { createFileRoute } from "@tanstack/react-router"
import { TerminalsPage } from "#/modules/terminals"

export const Route = createFileRoute("/_authenticated/terminals")({
	component: TerminalsPage,
})
