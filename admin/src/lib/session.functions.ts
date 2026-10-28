import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { env } from "#/env"
import type { Session } from "#/lib/auth-client"

/**
 * Reads the current session from the API on the server, forwarding the
 * browser's cookie header. `disableCookieCache` keeps guards honest: role,
 * branch, and mustChangePassword changes take effect immediately instead
 * of after the 5-minute cookie cache expires.
 *
 * Never throws: a network failure is treated as an anonymous visitor.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => {
		const cookie = getRequestHeader("cookie")
		if (!cookie) return null

		try {
			const response = await fetch(
				`${env.VITE_API_URL}/api/auth/get-session?disableCookieCache=true`,
				{ headers: { cookie, accept: "application/json" } },
			)
			if (!response.ok) return null
			const data = (await response.json()) as Session | null
			return data ?? null
		} catch {
			return null
		}
	},
)
