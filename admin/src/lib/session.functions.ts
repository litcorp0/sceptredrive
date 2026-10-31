import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { env } from "#/env"
import type { Session } from "#/lib/auth-client"

/**
 * The API origin as the *server* sees it.
 *
 * When the console is served from its own origin and proxies `/api/*` (`API_URL`,
 * see `vite.config.ts`), the server should call the API directly instead of looping
 * through its own public origin. `VITE_API_URL` is the fallback, which is what local
 * development uses.
 */
const apiBaseUrl = process.env.API_URL?.trim().replace(/\/+$/, "") || env.VITE_API_URL

/**
 * Reads the current session from the API on the server, forwarding the
 * browser's cookie header. `disableCookieCache` keeps guards honest: role,
 * branch, and mustChangePassword changes take effect immediately instead
 * of after the 5-minute cookie cache expires.
 *
 * This is why the console needs the API cookie to be **first-party**: the only
 * cookie the server can read is the one the browser sent to the console. A
 * cross-origin API sets a host-only cookie the console never receives, and every
 * guard then treats a signed-in user as anonymous. See docs/STAGING-ONE-DAY.md §8.3.
 *
 * Never throws: a network failure is treated as an anonymous visitor.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => {
		const cookie = getRequestHeader("cookie")
		if (!cookie) return null

		try {
			const response = await fetch(`${apiBaseUrl}/api/auth/get-session?disableCookieCache=true`, {
				headers: { cookie, accept: "application/json" },
			})
			if (!response.ok) return null
			const data = (await response.json()) as Session | null
			return data ?? null
		} catch {
			return null
		}
	},
)
