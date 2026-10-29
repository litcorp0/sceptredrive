import type { SiteContent } from "@sceptre/shared"
import { SITE_FALLBACK } from "./site-fallback"
import { parseSiteContent } from "./site-schema"

export interface ReadSiteContentOptions {
	apiUrl: string
	/** Injectable for tests; defaults to the global fetch. */
	fetchImpl?: typeof fetch
	timeoutMs?: number
}

/**
 * Reads the public endpoint and never throws. A non-2xx response, a timeout, a
 * malformed payload and a network failure all resolve to the fallback, because
 * a marketing page that blanks on an API hiccup is worse than slightly stale
 * copy.
 */
export async function readSiteContent({
	apiUrl,
	fetchImpl = fetch,
	timeoutMs = 2_000,
}: ReadSiteContentOptions): Promise<SiteContent> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/api/public/site`, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		})
		if (!response.ok) return SITE_FALLBACK

		const body = (await response.json()) as { content?: unknown }
		return parseSiteContent(body.content) ?? SITE_FALLBACK
	} catch {
		return SITE_FALLBACK
	} finally {
		clearTimeout(timer)
	}
}
