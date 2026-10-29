import { describe, expect, it } from "vitest"
import { readSiteContent } from "./site-content"
import { SITE_FALLBACK } from "./site-fallback"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

const BASE = "http://localhost:4000"

describe("site content loader", () => {
	it("returns the endpoint's content when it is valid", async () => {
		const content = {
			...SITE_FALLBACK,
			site: { ...SITE_FALLBACK.site, heroHeading: "Parts for every road." },
		}
		const fetchImpl = (async () => jsonResponse({ content })) as unknown as typeof fetch

		const result = await readSiteContent({ apiUrl: BASE, fetchImpl })
		expect(result.site.heroHeading).toBe("Parts for every road.")
	})

	it("falls back on a non-2xx response", async () => {
		const fetchImpl = (async () => jsonResponse({ error: "down" }, 503)) as unknown as typeof fetch
		const result = await readSiteContent({ apiUrl: BASE, fetchImpl })
		expect(result).toEqual(SITE_FALLBACK)
	})

	it("falls back on a malformed payload", async () => {
		const fetchImpl = (async () =>
			jsonResponse({ content: { site: { name: 1 } } })) as unknown as typeof fetch
		const result = await readSiteContent({ apiUrl: BASE, fetchImpl })
		expect(result).toEqual(SITE_FALLBACK)
	})

	it("falls back on a network error", async () => {
		const fetchImpl = (async () => {
			throw new Error("offline")
		}) as unknown as typeof fetch
		const result = await readSiteContent({ apiUrl: BASE, fetchImpl })
		expect(result).toEqual(SITE_FALLBACK)
	})

	it("strips a trailing slash from the API base", async () => {
		let called = ""
		const fetchImpl = (async (input: RequestInfo | URL) => {
			called = String(input)
			return jsonResponse({ content: SITE_FALLBACK })
		}) as unknown as typeof fetch

		await readSiteContent({ apiUrl: "http://localhost:4000/", fetchImpl })
		expect(called).toBe("http://localhost:4000/api/public/site")
	})
})
