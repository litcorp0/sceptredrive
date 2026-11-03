import type { SiteBranch } from "@sceptre/shared"
import { describe, expect, it } from "vitest"
import { ENQUIRY_MESSAGE, mailHref, mapsHref, telHref, waHref } from "./contact"

const BRANCH: SiteBranch = {
	code: "TEMA-01",
	name: "Tema",
	city: "Tema",
	area: "Community 1",
	address: null,
	phone: null,
	latitude: null,
	longitude: null,
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

	it("prefers an explicit map url, then coordinates, then an address search", () => {
		expect(mapsHref({ ...BRANCH, mapUrl: "https://maps.example/x" })).toBe("https://maps.example/x")
		expect(mapsHref({ ...BRANCH, latitude: 5.6698, longitude: -0.0166 })).toBe(
			"https://www.google.com/maps/dir/?api=1&destination=5.6698%2C-0.0166",
		)
		expect(mapsHref(BRANCH)).toBe(
			"https://www.google.com/maps/search/?api=1&query=Community%201%2C%20Tema",
		)
		expect(mapsHref({ ...BRANCH, area: null, city: "" })).toBeNull()
	})

	it("uses one general enquiry message, never an order", () => {
		expect(ENQUIRY_MESSAGE).toContain("enquiry")
		expect(ENQUIRY_MESSAGE.toLowerCase()).not.toContain("order")
	})
})
