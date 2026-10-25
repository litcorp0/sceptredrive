import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { AnalyticsPage, analyticsSearchDefaults, analyticsSearchSchema } from "#/modules/analytics"

export const Route = createFileRoute("/_authenticated/analytics")({
	validateSearch: analyticsSearchSchema,
	search: { middlewares: [stripSearchParams(analyticsSearchDefaults)] },
	component: AnalyticsPage,
})
