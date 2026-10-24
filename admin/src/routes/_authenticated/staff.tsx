import { createFileRoute } from "@tanstack/react-router"
import { StaffPage } from "#/modules/staff"

export const Route = createFileRoute("/_authenticated/staff")({
	component: StaffPage,
})
