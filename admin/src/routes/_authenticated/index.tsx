import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { DashboardPage, dashboardSearchDefaults, dashboardSearchSchema } from "#/modules/dashboard"

export const Route = createFileRoute("/_authenticated/")({
	validateSearch: dashboardSearchSchema,
	search: { middlewares: [stripSearchParams(dashboardSearchDefaults)] },
	component: DashboardPage,
})
