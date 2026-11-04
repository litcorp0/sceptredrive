import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "#/components/layout/app-shell"
import { SessionUnavailablePage } from "#/components/layout/session-unavailable"
import { BranchProvider } from "#/lib/branch-context"
import { SessionUnavailableError } from "#/lib/session.functions"
import { resolveSession, revalidateInBackground } from "#/lib/session-cache"

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		// `beforeLoad` runs on every navigation, so this reads the remembered answer first and
		// only pays for a server round trip when the console genuinely does not know who the
		// user is. See `session-cache.ts` for why that matters on a cold API.
		const lookup = await resolveSession()

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

	// A console left open all day is the case the cache cannot see: check again when the tab
	// comes back. Background only — it never holds a navigation, and a session that turns out
	// to be gone is caught by the next API call's 401.
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") revalidateInBackground()
		}
		window.addEventListener("focus", onVisible)
		document.addEventListener("visibilitychange", onVisible)
		return () => {
			window.removeEventListener("focus", onVisible)
			document.removeEventListener("visibilitychange", onVisible)
		}
	}, [])

	// The forced password change renders standalone, without the console shell.
	if (pathname === "/change-password") return <Outlet />

	return (
		<BranchProvider session={session}>
			<AppShell session={session} />
		</BranchProvider>
	)
}
