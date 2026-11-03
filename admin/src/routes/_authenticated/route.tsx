import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router"
import { AppShell } from "#/components/layout/app-shell"
import { SessionUnavailablePage } from "#/components/layout/session-unavailable"
import { BranchProvider } from "#/lib/branch-context"
import { getSession, SessionUnavailableError } from "#/lib/session.functions"

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const lookup = await getSession()

		// Never treat "the API did not answer" as "signed out": that is what bounced people to the
		// login screen mid-shift with a valid cookie, on a cold start or a deploy restart.
		if (lookup.status === "unavailable") throw new SessionUnavailableError()

		if (lookup.status === "anonymous") {
			throw redirect({ to: "/login", search: { redirect: location.href } })
		}

		const { session } = lookup
		if (session.user.mustChangePassword === true && location.pathname !== "/change-password") {
			throw redirect({ to: "/change-password" })
		}

		return { session }
	},
	errorComponent: ({ reset }) => <SessionUnavailablePage reset={reset} />,
	component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
	const { session } = Route.useRouteContext()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	// The forced password change renders standalone, without the console shell.
	if (pathname === "/change-password") return <Outlet />

	return (
		<BranchProvider session={session}>
			<AppShell session={session} />
		</BranchProvider>
	)
}
