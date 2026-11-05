import type { SiteContent } from "@sceptre/shared"
import { describe, expect, it } from "vitest"
import { createSiteContentLoader } from "./site-cache"
import { SITE_FALLBACK } from "./site-fallback"

/**
 * The behaviour that stopped a cold API from emptying the site (P20-D8).
 *
 * `SITE_FALLBACK` carries no branches, and it used to be cached for a full minute
 * whenever one request timed out — so a visitor who had just seen the branch list
 * would lose it on the next click.
 */

const LIVE: SiteContent = {
	...SITE_FALLBACK,
	branches: [
		{
			code: "TEM-MNZ",
			name: "Tema Community 1 Branch",
			city: "Tema",
			area: "Mankoadze",
			address: "Tema Mankoadze",
			phone: "0241234567",
			latitude: null,
			longitude: null,
			hours: null,
			mapUrl: null,
		},
	],
}

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
	let at = start
	return { now: () => at, advance: (ms) => (at += ms) }
}

describe("site content cache", () => {
	it("serves a success from the cache until the TTL expires", async () => {
		const time = clock()
		let reads = 0
		const load = createSiteContentLoader({
			ttlMs: 60_000,
			now: time.now,
			read: async () => {
				reads += 1
				return LIVE
			},
		})

		expect(await load()).toBe(LIVE)
		expect(await load()).toBe(LIVE)
		expect(reads).toBe(1)

		time.advance(60_001)
		await load()
		expect(reads).toBe(2)
	})

	it("keeps the last real branch list when the API stops answering", async () => {
		const time = clock()
		let answer: SiteContent | null = LIVE
		const load = createSiteContentLoader({
			ttlMs: 60_000,
			now: time.now,
			read: async () => answer,
		})

		await load()
		answer = null
		time.advance(60_001)

		const afterOutage = await load()
		expect(afterOutage).toBe(LIVE)
		expect(afterOutage.branches).toHaveLength(1)
	})

	it("does not cache a failure, so the next request retries", async () => {
		const time = clock()
		let answer: SiteContent | null = LIVE
		let reads = 0
		const load = createSiteContentLoader({
			ttlMs: 60_000,
			now: time.now,
			read: async () => {
				reads += 1
				return answer
			},
		})

		await load()
		answer = null
		time.advance(60_001)
		await load()

		// The very next call asks again rather than repeating the empty answer for a minute.
		answer = LIVE
		await load()
		expect(reads).toBe(3)
	})

	it("uses the bundled copy only when it has never reached the API", async () => {
		const load = createSiteContentLoader({
			ttlMs: 60_000,
			read: async () => null,
		})

		expect(await load()).toEqual(SITE_FALLBACK)
	})

	it("shares one in-flight read between callers", async () => {
		let reads = 0
		const load = createSiteContentLoader({
			ttlMs: 60_000,
			read: async () => {
				reads += 1
				return LIVE
			},
		})

		await Promise.all([load(), load(), load()])
		expect(reads).toBe(1)
	})
})
