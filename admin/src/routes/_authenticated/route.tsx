import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router"
import { AppShell } from "#/components/layout/app-shell"
import { BranchProvider } from "#/lib/branch-context"
import { getSession } from "#/lib/session.functions"

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const session = await getSession()

		if (!session) {
			throw redirect({ to: "/login", search: { redirect: location.href } })
		}

		if (session.user.mustChangePassword === true && location.pathname !== "/change-password") {
			throw redirect({ to: "/change-password" })
		}

		return { session }
	},
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
