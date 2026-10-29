import { describe, expect, it } from "vitest"
import { SITE_FALLBACK } from "./site-fallback"
import { parseSiteContent } from "./site-schema"

describe("site content guard", () => {
	it("accepts the bundled fallback", () => {
		expect(parseSiteContent(SITE_FALLBACK)).not.toBeNull()
	})

	it("rejects a payload with a missing site", () => {
		const parsed = parseSiteContent({ branches: [], updatedAt: "x" })
		expect(parsed).toBeNull()
	})

	it("rejects a shop status outside the vocabulary", () => {
		const broken = {
			...SITE_FALLBACK,
			site: { ...SITE_FALLBACK.site, shopStatus: "SOON" },
		}
		expect(parseSiteContent(broken)).toBeNull()
	})

	it("rejects a branch with no code", () => {
		const broken = {
			...SITE_FALLBACK,
			branches: [{ ...SITE_FALLBACK.branches[0], code: "" }],
		}
		expect(parseSiteContent(broken)).toBeNull()
	})
})
