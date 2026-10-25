import { createFileRoute } from "@tanstack/react-router"
import { BranchDetailPage } from "#/modules/branches"

export const Route = createFileRoute("/_authenticated/branches/$id")({
	component: BranchDetailPage,
})
