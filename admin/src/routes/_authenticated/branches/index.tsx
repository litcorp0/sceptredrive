import { createFileRoute } from "@tanstack/react-router"
import { BranchesPage } from "#/modules/branches"

export const Route = createFileRoute("/_authenticated/branches/")({
	component: BranchesPage,
})
