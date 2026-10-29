/**
 * The parts index is presentation copy, not inventory: it names the families a
 * counter carries and examples a person would ask for. There are no prices,
 * quantities or live stock here — the site does not know them, and a marketing
 * page that pretends to is worse than one that asks you to call.
 */
export interface PartFamily {
	slug: string
	code: string
	name: string
	summary: string
	examples: string[]
}

export const PART_FAMILIES: PartFamily[] = [
	{
		slug: "engine-drivetrain",
		code: "ENG",
		name: "Engine & Drivetrain",
		summary: "Filters, belts, gaskets and the parts that keep the engine turning.",
		examples: ["Oil filters", "Air filters", "Timing belts", "Gaskets"],
	},
	{
		slug: "brakes",
		code: "BRK",
		name: "Brakes",
		summary: "Pads, discs, shoes and fluid for a pedal that feels right.",
		examples: ["Brake pads", "Discs", "Shoes", "Brake fluid"],
	},
	{
		slug: "suspension-steering",
		code: "SUS",
		name: "Suspension & Steering",
		summary: "Shocks, bushings and joints for the roads you actually drive.",
		examples: ["Shock absorbers", "Bushings", "Tie rods", "Ball joints"],
	},
	{
		slug: "electrical-lighting",
		code: "ELC",
		name: "Electrical & Lighting",
		summary: "Batteries, plugs and the electrics that start the day.",
		examples: ["Batteries", "Spark plugs", "Bulbs", "Alternators"],
	},
	{
		slug: "filters-fluids",
		code: "FLT",
		name: "Filters & Fluids",
		summary: "Oil, coolant and the filters that keep them clean.",
		examples: ["Engine oil", "Coolant", "Fuel filters", "Brake fluid"],
	},
	{
		slug: "body-accessories",
		code: "BDY",
		name: "Body & Accessories",
		summary: "Wipers, mirrors and the small parts that finish a car.",
		examples: ["Wiper blades", "Mirrors", "Mats", "Care"],
	},
]

function normalize(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
}

/** Case- and diacritic-tolerant search over the family name, code and examples. */
export function filterParts(query: string): PartFamily[] {
	const needle = normalize(query)
	if (needle === "") return PART_FAMILIES

	return PART_FAMILIES.filter((family) => {
		const haystack = normalize(
			[family.name, family.code, family.summary, ...family.examples].join(" "),
		)
		return haystack.includes(needle)
	})
}

export function findPart(slug: string): PartFamily | null {
	return PART_FAMILIES.find((family) => family.slug === slug) ?? null
}
