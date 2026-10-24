import { createFileRoute } from "@tanstack/react-router"
import { ResetPasswordPage } from "#/modules/auth"

export const Route = createFileRoute("/reset-password")({
	validateSearch: (search: Record<string, unknown>): { token?: string } => ({
		token: typeof search.token === "string" ? search.token : undefined,
	}),
	component: ResetPasswordPage,
})
