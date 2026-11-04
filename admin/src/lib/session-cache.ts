import { getSession, type SessionLookup } from "#/lib/session.functions"

/**
 * One session check per visit, not one per click (P20-D2).
 *
 * `beforeLoad` on the console's authenticated layout runs on **every** navigation — that is
 * TanStack Router's documented contract, and neither `staleTime` nor `preloadStaleTime` can
 * suppress it (they govern loaders, not `beforeLoad`). Calling the API from inside it therefore
 * puts a serverless round trip in front of every sidebar click. When the API is a Render
 * instance that has spun down, that round trip is a 30–60 second cold start, and the page sits
 * on the old view while the URL has already changed.
 *
 * So the guard remembers what it already knows:
 *
 * - **Fresh** (younger than `SESSION_TTL_MS`): reuse the last answer, no network at all.
 * - **Stale but signed in**: render with it immediately and revalidate in the background —
 *   one flight, however many navigations are queued behind it.
 * - **Unknown** (first load, or after sign-out): wait for the network, because there is
 *   nothing to render the console with.
 *
 * This is not the authorization boundary. Every API request is authorized server-side against
 * the session cookie, and `apiRequest` already redirects on a 401. The guard decides what to
 * *paint*, not what the user may *do* — so a minute of staleness costs a stale sidebar entry
 * that the API will refuse, never access it should not have had.
 */

/** How long a check is trusted before a background revalidation is due. */
const SESSION_TTL_MS = 60_000

/**
 * How long a *blocking* check may take before the console says it cannot reach the server.
 *
 * The server function already caps its own API call at 8s; this covers the hop to that
 * function (a cold serverless instance), so a navigation can never hang indefinitely.
 */
const SESSION_CHECK_TIMEOUT_MS = 12_000

let last: SessionLookup | null = null
let checkedAt = 0
let inFlight: Promise<SessionLookup> | null = null

/** The last answer, but only when it was a real session. */
function knownSession(): SessionLookup | null {
	return last?.status === "authenticated" ? last : null
}

function isFresh(): boolean {
	return checkedAt > 0 && Date.now() - checkedAt < SESSION_TTL_MS
}

/**
 * Runs the real check, single-flight.
 *
 * Two navigations that arrive together (the preload lane and the navigation lane) share one
 * request instead of racing two cold starts.
 */
function check(): Promise<SessionLookup> {
	if (inFlight) return inFlight

	const run = withTimeout(getSession(), SESSION_CHECK_TIMEOUT_MS)
		.then((lookup) => {
			last = lookup
			checkedAt = Date.now()
			return lookup
		})
		.catch((): SessionLookup => {
			// A timeout is "cannot reach the server", never "signed out": bouncing someone to
			// the login screen mid-shift is the failure this whole guard exists to avoid.
			last = { status: "unavailable" }
			checkedAt = Date.now()
			return last
		})
		.finally(() => {
			inFlight = null
		})

	inFlight = run
	return run
}

function withTimeout(work: Promise<SessionLookup>, timeoutMs: number): Promise<SessionLookup> {
	return new Promise<SessionLookup>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("The session check did not answer in time")),
			timeoutMs,
		)
		work.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error: unknown) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

/** Forget everything: sign-out, or a sign-in that replaces the identity. */
export function forgetSession(): void {
	last = null
	checkedAt = 0
	inFlight = null
}

/**
 * What the authenticated layout's `beforeLoad` awaits.
 *
 * On the server this is the plain check: module state on a serverless instance is shared
 * between requests, so caching there would hand one user's session to the next.
 */
export async function resolveSession(): Promise<SessionLookup> {
	if (typeof window === "undefined") return getSession()

	const known = knownSession()
	if (known && isFresh()) return known

	if (known) {
		// Stale but usable: paint now, revalidate behind the page. The result is deliberately
		// not awaited — a page that already rendered must not be un-rendered by an answer that
		// arrives later. The next navigation picks it up, and a revoked session is refused by
		// the API in the meantime.
		void check()
		return known
	}

	// No session to render with. A recent anonymous/unavailable answer is reused so a burst of
	// navigations after a failure costs one timeout, not one each.
	if (last && isFresh()) return last

	return check()
}

/**
 * Revalidates on demand: a return to the tab is the moment a long-lived console most often
 * holds a session that has changed. Never blocks, never throws.
 */
export function revalidateInBackground(): void {
	if (typeof window === "undefined") return
	if (inFlight) return
	void check()
}
