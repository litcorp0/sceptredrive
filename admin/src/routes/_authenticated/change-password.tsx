import { createFileRoute } from "@tanstack/react-router"
import { ChangePasswordPage } from "#/modules/auth"

export const Route = createFileRoute("/_authenticated/change-password")({
	component: ChangePasswordPage,
})
