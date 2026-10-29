import type { SiteBranch } from "@sceptre/shared"
import { describe, expect, it } from "vitest"
import { mailHref, mapsHref, partMessage, telHref, waHref } from "./contact"

const BRANCH: SiteBranch = {
	code: "ACC-SPX",
	name: "Accra Spintex",
	city: "Accra",
	area: "Spintex",
	address: null,
	phone: null,
	hours: null,
	mapUrl: null,
}

describe("contact links", () => {
	it("returns null for an empty phone", () => {
		expect(telHref("")).toBeNull()
		expect(telHref("   ")).toBeNull()
	})

	it("builds a tel link and keeps the leading plus", () => {
		expect(telHref("+233 30 255 5010")).toBe("tel:+233302555010")
	})

	it("builds a WhatsApp link with an encoded message", () => {
		expect(waHref("+233 24 400 0001", "Hello there")).toBe(
			"https://wa.me/233244000001?text=Hello%20there",
		)
	})

	it("rejects a number too short to dial", () => {
		expect(waHref("123", "hi")).toBeNull()
	})

	it("builds a mailto with an optional subject", () => {
		expect(mailHref("hello@sceptredrive.example")).toBe("mailto:hello@sceptredrive.example")
		expect(mailHref("hello@sceptredrive.example", "Parts")).toBe(
			"mailto:hello@sceptredrive.example?subject=Parts",
		)
		expect(mailHref("")).toBeNull()
	})

	it("prefers an explicit map url and otherwise searches the address parts", () => {
		expect(mapsHref({ ...BRANCH, mapUrl: "https://maps.example/x" })).toBe("https://maps.example/x")
		expect(mapsHref(BRANCH)).toBe(
			"https://www.google.com/maps/search/?api=1&query=Spintex%2C%20Accra",
		)
		expect(mapsHref({ ...BRANCH, area: null, city: "" })).toBeNull()
	})

	it("names the part in the WhatsApp message", () => {
		expect(partMessage("brake pads")).toContain("brake pads")
		expect(partMessage("  ")).toContain("help finding a part")
	})
})
