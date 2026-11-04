import { createFileRoute, redirect } from "@tanstack/react-router"
import { SessionUnavailablePage } from "#/components/layout/session-unavailable"
import { SessionUnavailableError } from "#/lib/session.functions"
import { resolveSession } from "#/lib/session-cache"
import { LoginPage } from "#/modules/auth"

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async () => {
		const lookup = await resolveSession()

		// A signed-in user must not land here because the API was briefly unreachable.
		if (lookup.status === "unavailable") throw new SessionUnavailableError()
		if (lookup.status === "anonymous") return

		if (lookup.session.user.mustChangePassword === true) {
			throw redirect({ to: "/change-password" })
		}
		throw redirect({ to: "/" })
	},
	errorComponent: ({ reset }) => <SessionUnavailablePage reset={reset} />,
	component: LoginPage,
})
