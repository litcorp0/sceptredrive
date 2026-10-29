import { describe, expect, it } from "vitest"
import { filterParts, findPart, PART_FAMILIES } from "./parts"

describe("parts index", () => {
	it("returns every family for an empty query", () => {
		expect(filterParts("")).toHaveLength(PART_FAMILIES.length)
		expect(filterParts("   ")).toHaveLength(PART_FAMILIES.length)
	})

	it("lists exactly the six ranges the business deals in", () => {
		expect(PART_FAMILIES.map((family) => family.name)).toEqual([
			"Lubricants",
			"Batteries",
			"Belts",
			"Filters",
			"Spark Plugs",
			"Light Bulbs",
		])
	})

	it("matches a family by name", () => {
		const results = filterParts("battery")
		expect(results.map((family) => family.name)).toContain("Batteries")
	})

	it("matches an example across families", () => {
		const names = filterParts("oil filter").map((family) => family.name)
		expect(names).toContain("Filters")
	})

	it("is case-insensitive and ignores surrounding space", () => {
		expect(filterParts("  LUB  ").map((family) => family.code)).toEqual(["LUB"])
	})

	it("normalises accents in the query", () => {
		expect(filterParts("café")).toEqual([])
		expect(filterParts("spark").length).toBeGreaterThanOrEqual(1)
	})

	it("returns nothing for a query no family carries", () => {
		expect(filterParts("brake pads")).toEqual([])
		expect(filterParts("carburettor rebuild kit 1974")).toEqual([])
	})

	it("finds a family by slug", () => {
		expect(findPart("batteries")?.code).toBe("BAT")
		expect(findPart("nope")).toBeNull()
	})
})
