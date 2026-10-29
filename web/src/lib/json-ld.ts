import type { SiteContent } from "@sceptre/shared"
import { absoluteUrl } from "./site-url"

/**
 * One graph for the business and its branches. `AutoPartsStore` is a
 * `LocalBusiness`, so each branch is a `department` with its own address and
 * hours rather than a second competing business entity.
 */
export function siteJsonLd(site: SiteContent) {
	const social = [
		site.site.social.instagram,
		site.site.social.facebook,
		site.site.social.tiktok,
	].filter((value) => value !== "")

	return {
		"@context": "https://schema.org",
		"@type": "AutoPartsStore",
		name: site.site.name,
		url: absoluteUrl("/"),
		image: absoluteUrl("/og.png"),
		description: site.site.tagline,
		...(site.site.contactPhone ? { telephone: site.site.contactPhone } : {}),
		...(site.site.contactEmail ? { email: site.site.contactEmail } : {}),
		...(social.length > 0 ? { sameAs: social } : {}),
		department: site.branches.map((branch) => ({
			"@type": "AutoPartsStore",
			name: branch.name,
			...((branch.phone ?? site.site.contactPhone)
				? { telephone: branch.phone ?? site.site.contactPhone }
				: {}),
			address: {
				"@type": "PostalAddress",
				...(branch.address ? { streetAddress: branch.address } : {}),
				addressLocality: branch.city,
				...(branch.area ? { addressRegion: branch.area } : {}),
				addressCountry: "GH",
			},
			...(branch.hours ? { openingHours: branch.hours } : {}),
			...(branch.mapUrl ? { hasMap: branch.mapUrl } : {}),
		})),
	}
}

/** JSON.stringify, with `<` escaped so the payload cannot close the script tag. */
export function serializeJsonLd(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c")
}
