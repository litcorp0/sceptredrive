import { createFileRoute, redirect } from "@tanstack/react-router"
import { getAuthPolicy } from "#/lib/auth-policy"
import { getSession } from "#/lib/session.functions"
import { TwoFactorPage } from "#/modules/auth"

export const Route = createFileRoute("/two-factor")({
	validateSearch: (search: Record<string, unknown>): { setup?: string; redirect?: string } => ({
		setup: search.setup === "1" ? "1" : undefined,
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async () => {
		const session = await getSession()
		if (session?.user.twoFactorEnabled === true) {
			throw redirect({ to: "/" })
		}
		const policy = await getAuthPolicy()
		return { session, policy }
	},
	component: TwoFactorPage,
})
