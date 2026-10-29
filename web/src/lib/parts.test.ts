import { describe, expect, it } from "vitest"
import { filterParts, findPart, PART_FAMILIES } from "./parts"

describe("parts index", () => {
	it("returns every family for an empty query", () => {
		expect(filterParts("")).toHaveLength(PART_FAMILIES.length)
		expect(filterParts("   ")).toHaveLength(PART_FAMILIES.length)
	})

	it("matches a family by name", () => {
		const results = filterParts("brake")
		expect(results.map((family) => family.name)).toContain("Brakes")
	})

	it("matches an example across families", () => {
		const names = filterParts("oil filter").map((family) => family.name)
		expect(names.length).toBeGreaterThanOrEqual(1)
	})

	it("is case-insensitive and ignores surrounding space", () => {
		expect(filterParts("  BRK  ").map((family) => family.code)).toEqual(["BRK"])
	})

	it("normalises accents in the query", () => {
		expect(filterParts("café")).toEqual([])
		expect(filterParts("suspension").length).toBeGreaterThanOrEqual(1)
	})

	it("returns nothing for a query no family carries", () => {
		expect(filterParts("carburettor rebuild kit 1974")).toEqual([])
	})

	it("finds a family by slug", () => {
		expect(findPart("brakes")?.code).toBe("BRK")
		expect(findPart("nope")).toBeNull()
	})
})
