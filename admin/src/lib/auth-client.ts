import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import { env } from "#/env"

/**
 * Better Auth client for the Sceptre Drive API. The API is the only auth provider;
 * this client talks to it directly (dev: cross-origin with CORS credentials;
 * production: same-site behind Caddy).
 *
 * The two-factor plugin intentionally has no global redirect callback: the
 * login page inspects `twoFactorRedirect` in its onSuccess handler so this
 * module never needs to import the router (which would create a cycle).
 */
export const authClient = createAuthClient({
	baseURL: `${env.VITE_API_URL}/api/auth`,
	plugins: [
		inferAdditionalFields({
			user: {
				role: { type: "string" },
				branchId: { type: "string" },
				staffId: { type: "string" },
				phone: { type: "string" },
				isActive: { type: "boolean" },
				mustChangePassword: { type: "boolean" },
				twoFactorEnabled: { type: "boolean" },
			},
		}),
		twoFactorClient(),
	],
})

export type Session = typeof authClient.$Infer.Session
export type SessionUser = Session["user"]
