import { describe, expect, it } from "vitest"
import { absoluteUrl, siteUrl } from "./site-url"

describe("site url", () => {
	it("has no trailing slash", () => {
		expect(siteUrl().endsWith("/")).toBe(false)
	})

	it("builds an absolute url for a root path", () => {
		expect(absoluteUrl("/parts")).toBe(`${siteUrl()}/parts`)
	})

	it("adds the slash for a relative path", () => {
		expect(absoluteUrl("og.png")).toBe(`${siteUrl()}/og.png`)
	})
})
