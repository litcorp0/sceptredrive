import { createFileRoute } from "@tanstack/react-router"
import { EvatPage, evatSearchSchema } from "#/modules/evat"

export const Route = createFileRoute("/_authenticated/evat")({
	validateSearch: evatSearchSchema,
	component: EvatPage,
})
