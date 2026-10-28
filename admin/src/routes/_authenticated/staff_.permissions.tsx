import { createFileRoute } from "@tanstack/react-router"
import { PermissionsPage } from "#/modules/staff"

export const Route = createFileRoute("/_authenticated/staff_/permissions")({
	component: PermissionsPage,
})
