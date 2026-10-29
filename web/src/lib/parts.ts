/**
 * The ranges Sceptre Drive deals in — presentation copy, not inventory. The
 * business stocks lubricants, batteries, belts, filters, spark plugs and light
 * bulbs. This site does not sell them online; the index exists so a visitor
 * knows what the counter carries and where to find it.
 */
export interface PartFamily {
	slug: string
	code: string
	name: string
	summary: string
	examples: string[]
	/** Search aliases (singular/plural) that are not shown on the page. */
	aliases?: string[]
}

export const PART_FAMILIES: PartFamily[] = [
	{
		slug: "lubricants",
		code: "LUB",
		name: "Lubricants",
		summary: "Engine oils, gear oils and greases for the parts that move.",
		examples: ["Engine oil", "Gear oil", "Grease", "Brake fluid"],
		aliases: ["lubricant", "oil"],
	},
	{
		slug: "batteries",
		code: "BAT",
		name: "Batteries",
		summary: "Starting and auxiliary batteries for cars and light vehicles.",
		examples: ["Petrol & diesel", "Maintenance-free", "12V", "Terminals"],
		aliases: ["battery"],
	},
	{
		slug: "belts",
		code: "BLT",
		name: "Belts",
		summary: "Fan, alternator and timing belts in the common sizes.",
		examples: ["Fan belts", "Alternator belts", "Timing belts", "V-belts"],
		aliases: ["belt"],
	},
	{
		slug: "filters",
		code: "FLT",
		name: "Filters",
		summary: "Oil, air and fuel filters for routine service.",
		examples: ["Oil filters", "Air filters", "Fuel filters", "Cabin filters"],
		aliases: ["filter"],
	},
	{
		slug: "spark-plugs",
		code: "SPK",
		name: "Spark Plugs",
		summary: "Plugs for petrol engines, from standard to iridium.",
		examples: ["Standard", "Iridium", "Platinum", "Resistor"],
		aliases: ["plug", "spark plug"],
	},
	{
		slug: "light-bulbs",
		code: "LGT",
		name: "Light Bulbs",
		summary: "Head, tail and interior bulbs for the road and the dark.",
		examples: ["Headlights", "Tail lights", "Indicators", "Interior bulbs"],
		aliases: ["bulb", "bulbs", "light"],
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
			[
				family.name,
				family.code,
				family.summary,
				...family.examples,
				...(family.aliases ?? []),
			].join(" "),
		)
		return haystack.includes(needle)
	})
}

export function findPart(slug: string): PartFamily | null {
	return PART_FAMILIES.find((family) => family.slug === slug) ?? null
}
