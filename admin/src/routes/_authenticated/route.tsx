import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
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

		if (session.user.role === "ADMIN" && session.user.twoFactorEnabled !== true) {
			throw redirect({ to: "/two-factor", search: { setup: "1" } })
		}

		return { session }
	},
	component: Outlet,
})
