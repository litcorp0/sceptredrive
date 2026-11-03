import { SHOP_STATUSES, type SiteContent } from "@sceptre/shared"
import { z } from "zod"

/**
 * The runtime guard for the public endpoint. The shared type is the contract;
 * this schema is the boundary check. A payload that does not match is treated
 * exactly like an outage — the bundled fallback renders.
 */
const branchSchema = z.object({
	code: z.string().min(1),
	name: z.string().min(1),
	city: z.string(),
	area: z.string().nullable(),
	address: z.string().nullable(),
	phone: z.string().nullable(),
	// Defaulted so a web deploy that lands before the API does not reject the payload and
	// fall back to the bundled content.
	latitude: z.number().nullable().default(null),
	longitude: z.number().nullable().default(null),
	hours: z.string().nullable(),
	mapUrl: z.string().nullable(),
})

export const siteContentSchema = z.object({
	site: z.object({
		name: z.string().min(1),
		tagline: z.string(),
		heroHeading: z.string().min(1),
		heroBody: z.string(),
		aboutBody: z.string(),
		announcement: z.string(),
		shopStatus: z.enum(SHOP_STATUSES),
		contactEmail: z.string(),
		contactPhone: z.string(),
		whatsapp: z.string(),
		social: z.object({
			instagram: z.string(),
			facebook: z.string(),
			tiktok: z.string(),
		}),
	}),
	branches: z.array(branchSchema),
	updatedAt: z.string(),
})

export function parseSiteContent(value: unknown): SiteContent | null {
	const parsed = siteContentSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}
