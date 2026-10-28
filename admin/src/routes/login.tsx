import { createFileRoute, redirect } from "@tanstack/react-router"
import { getSession } from "#/lib/session.functions"
import { LoginPage } from "#/modules/auth"

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async () => {
		const session = await getSession()
		if (!session) return
		if (session.user.mustChangePassword === true) {
			throw redirect({ to: "/change-password" })
		}
		throw redirect({ to: "/" })
	},
	component: LoginPage,
})
