import type { SiteContent } from "@sceptre/shared"
import { createServerFn } from "@tanstack/react-start"
import { readSiteContent } from "./site-content"

/**
 * The site's content, read on the server.
 *
 * A server function keeps the API host off the client and avoids a CORS entry
 * for a marketing page. The in-process cache is deliberately short in
 * development (an operator should see an edit immediately) and a minute in
 * production (the response is public and cacheable end to end).
 */
const TTL_MS = import.meta.env.DEV ? 5_000 : 60_000

let cached: { at: number; content: SiteContent } | null = null

export const getSiteContent = createServerFn({ method: "GET" }).handler(
	async (): Promise<SiteContent> => {
		const now = Date.now()
		if (cached && now - cached.at < TTL_MS) return cached.content

		const content = await readSiteContent({
			apiUrl: process.env.WEB_API_URL ?? "http://localhost:4000",
		})
		cached = { at: now, content }
		return content
	},
)
