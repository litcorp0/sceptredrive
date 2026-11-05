import type { SiteContent } from "@sceptre/shared"
import { createServerFn } from "@tanstack/react-start"
import { createSiteContentLoader } from "./site-cache"
import { DEFAULT_SITE_TIMEOUT_MS, readSiteContent } from "./site-content"

/**
 * The site's content, read on the server.
 *
 * A server function keeps the API host off the client and avoids a CORS entry
 * for a marketing page.
 *
 * The cache is short in development (an operator should see an edit immediately)
 * and a minute in production. What matters is what it does on failure (P20-D8): it
 * serves the last content it actually received, so a cold or restarting API can no
 * longer blank the branch list, and a failure is not cached, so the next request
 * retries instead of repeating the empty answer for a minute.
 */
const TTL_MS = import.meta.env.DEV ? 5_000 : 60_000

const timeoutMs = Number(process.env.SITE_FETCH_TIMEOUT_MS) || DEFAULT_SITE_TIMEOUT_MS

const loadSiteContent = createSiteContentLoader({
	ttlMs: TTL_MS,
	read: () =>
		readSiteContent({
			apiUrl: process.env.WEB_API_URL ?? "http://localhost:4000",
			timeoutMs,
		}),
})

export const getSiteContent = createServerFn({ method: "GET" }).handler(
	async (): Promise<SiteContent> => loadSiteContent(),
)
