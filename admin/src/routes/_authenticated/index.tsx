import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "#/modules/dashboard"

export const Route = createFileRoute("/_authenticated/")({
	component: DashboardPage,
})
