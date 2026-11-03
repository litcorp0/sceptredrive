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

/** A cold API does not answer in milliseconds; a hung one must not stall a navigation. */
const SESSION_TIMEOUT_MS = 8_000

/**
 * What the API said about the browser's session cookie.
 *
 * `unavailable` is the important one: the API did not answer, so the console knows *nothing*
 * about this session. Treating that as "anonymous" signed people out in the middle of a shift —
 * a cold start, a deploy restart, or a 429 from the auth rate limit would all bounce a signed-in
 * user to `/login` with a perfectly valid cookie still in the browser.
 */
export type SessionLookup =
	| { status: "authenticated"; session: Session }
	| { status: "anonymous" }
	| { status: "unavailable" }

/** Thrown by route guards so the failure reads as "cannot reach the server", not "signed out". */
export class SessionUnavailableError extends Error {
	constructor() {
		super("The server could not be reached, so your session could not be checked.")
		this.name = "SessionUnavailableError"
	}
}

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
 */
export const getSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<SessionLookup> => {
		const cookie = getRequestHeader("cookie")
		if (!cookie) return { status: "anonymous" }

		try {
			const response = await fetch(`${apiBaseUrl}/api/auth/get-session?disableCookieCache=true`, {
				headers: { cookie, accept: "application/json" },
				signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
			})

			// A rejected cookie is a real sign-out. Anything else non-2xx is the API talking about
			// itself (cold start 502, deploy restart, auth rate limit 429), not about the user.
			if (response.status === 401 || response.status === 403) return { status: "anonymous" }
			if (!response.ok) return { status: "unavailable" }

			const data = (await response.json()) as Partial<Session> | null

			// A 200 with no usable session is "anonymous"; a 200 whose body is not a session at all
			// means the API (or a proxy in front of it) answered something we cannot interpret.
			// Treating that as authenticated read `user` off an empty object and crashed the guard
			// with "Cannot read properties of undefined (reading 'mustChangePassword')".
			if (!data) return { status: "anonymous" }
			if (!data.session || !data.user) return { status: "unavailable" }

			return { status: "authenticated", session: data as Session }
		} catch {
			return { status: "unavailable" }
		}
	},
)
