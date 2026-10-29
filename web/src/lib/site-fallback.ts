import type { SiteContent } from "@sceptre/shared"

/**
 * The site must render even when the API is down, the network is slow, or the
 * endpoint returns something unexpected. This is a complete, honest page's
 * worth of content — no invented phone numbers, no invented branches.
 *
 * The copy mirrors the API's defaults, which are the values the operator sees
 * before their first edit. When the API is reachable it always wins.
 *
 * TODO(operator): real address/hours/phone come from Settings → Website and the
 * branch form. Nothing here should be replaced with a made-up value.
 */
export const SITE_FALLBACK: SiteContent = {
	site: {
		name: "Sceptre Drive",
		tagline:
			"Lubricants, batteries, belts, filters, spark plugs and light bulbs for the cars you drive.",
		heroHeading: "Parts that keep Ghana moving.",
		heroBody:
			"Lubricants, batteries, belts, filters, spark plugs and light bulbs — the parts a car needs to keep moving. See the range, find a branch, and visit the counter.",
		aboutBody:
			"Sceptre Drive supplies lubricants, batteries, belts, filters, spark plugs and light bulbs across Ghana. We stock genuine, OEM-matched and quality aftermarket parts for everyday drivers, workshops and fleets. Every part is recorded, so a counter can trace what you bought and help you match it again.",
		announcement: "",
		shopStatus: "COMING_SOON",
		contactEmail: "",
		contactPhone: "",
		whatsapp: "",
		social: { instagram: "", facebook: "", tiktok: "" },
	},
	branches: [
		{
			code: "ACC-SPX",
			name: "Accra Spintex",
			city: "Accra",
			area: "Spintex",
			address: null,
			phone: null,
			hours: null,
			mapUrl: null,
		},
	],
	updatedAt: "2026-10-29T00:00:00.000Z",
}
