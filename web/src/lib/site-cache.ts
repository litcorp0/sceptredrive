import type { SiteContent } from "@sceptre/shared"
import { SITE_FALLBACK } from "./site-fallback"

export interface SiteContentLoaderOptions {
	/** Reads the API. `null` means "the API did not answer" — never a fallback. */
	read: () => Promise<SiteContent | null>
	/** How long a successful read is reused without asking again. */
	ttlMs: number
	now?: () => number
	fallback?: SiteContent
}

/**
 * The public site's content, cached per server instance (P20-D8).
 *
 * Two rules, and the bug they fix:
 *
 * - **A success is cached** for `ttlMs`, so the site does not ask the API on every
 *   page view.
 * - **A failure is never cached, and never beats a success.** It returns the last
 *   content this instance actually received, and only falls back to the bundled
 *   copy if it has never received any. This is what stopped a cold API from
 *   replacing a working branch list with the empty fallback: the fallback used to
 *   be written into the cache for a full minute, so one aborted request emptied
 *   the site.
 *
 * The fallback is still the honest answer for a brand-new instance that has never
 * reached the API — the site must render, and it must not invent branches.
 */
export function createSiteContentLoader({
	read,
	ttlMs,
	now = Date.now,
	fallback = SITE_FALLBACK,
}: SiteContentLoaderOptions): () => Promise<SiteContent> {
	let cached: { at: number; content: SiteContent } | null = null
	let inFlight: Promise<SiteContent> | null = null

	return async function load(): Promise<SiteContent> {
		const at = now()
		if (cached && at - cached.at < ttlMs) return cached.content
		// One flight per instance: a burst of page views during a cold start should not
		// each wait out their own timeout.
		if (inFlight) return inFlight

		inFlight = read()
			.then((content) => {
				if (content) {
					cached = { at, content }
					return content
				}
				// Stale beats empty: the last real branch list is a better answer than a
				// blank section, and the cache timestamp is deliberately not advanced, so
				// the next request retries and the API wakes up.
				return cached?.content ?? fallback
			})
			.finally(() => {
				inFlight = null
			})

		return inFlight
	}
}
