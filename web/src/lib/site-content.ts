import type { SiteContent } from "@sceptre/shared"
import { SITE_FALLBACK } from "./site-fallback"
import { parseSiteContent } from "./site-schema"

export interface ReadSiteContentOptions {
	apiUrl: string
	/** Injectable for tests; defaults to the global fetch. */
	fetchImpl?: typeof fetch
	/**
	 * How long the API has to answer before this gives up (P20-D8).
	 *
	 * Six seconds, not two: the API runs on Render, and a cut-off that shorter than a
	 * cold start guarantees that every wake-up renders an empty site. This is a
	 * server-side read, so the cost of waiting is a slower first byte, not a stalled
	 * page — and `site-cache.ts` means only the first visit pays it.
	 */
	timeoutMs?: number
}

export const DEFAULT_SITE_TIMEOUT_MS = 6_000

/**
 * Reads the public endpoint. Returns `null` for every failure — a non-2xx response, a
 * timeout, a malformed payload, a network error.
 *
 * It no longer returns the bundled fallback itself. "The API did not answer" and "here is
 * the site" are different facts, and only the caller knows whether it is holding a better
 * answer from a minute ago; `site-cache.ts` decides what to render. Keeping this pure is
 * also what makes it testable without leaking state between cases.
 */
export async function readSiteContent({
	apiUrl,
	fetchImpl = fetch,
	timeoutMs = DEFAULT_SITE_TIMEOUT_MS,
}: ReadSiteContentOptions): Promise<SiteContent | null> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/api/public/site`, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		})
		if (!response.ok) return null

		const body = (await response.json()) as { content?: unknown }
		return parseSiteContent(body.content)
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

/** Kept for callers that need the bundled copy explicitly. */
export { SITE_FALLBACK }
