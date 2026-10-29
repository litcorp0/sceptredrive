/**
 * The public site contract (Phase 16).
 *
 * The website is a marketing surface, not an inventory or customer surface: this
 * file names only what a visitor may see. Both the API projection and the web
 * loader import it, so a field cannot exist on one side and not the other.
 *
 * `updatedAt` is the newest content change the API knows about. It drives the
 * cache key and the social-image refresh, not a fact a visitor reads.
 */

export const SHOP_STATUSES = ['COMING_SOON', 'OPEN'] as const
export type ShopStatus = (typeof SHOP_STATUSES)[number]

export const SHOP_STATUS_LABELS: Record<ShopStatus, string> = {
  COMING_SOON: 'Online shop coming soon',
  OPEN: 'Shop open',
}

export function isShopStatus(value: unknown): value is ShopStatus {
  return typeof value === 'string' && (SHOP_STATUSES as readonly string[]).includes(value)
}

export interface SiteSocialLinks {
  /** Absolute https URL, or an empty string when the business has no account. */
  instagram: string
  facebook: string
  tiktok: string
}

/** A retail branch as the site may describe it. Warehouses never appear here. */
export interface SiteBranch {
  code: string
  name: string
  city: string
  area: string | null
  address: string | null
  phone: string | null
  /** Opening hours; empty until an admin sets them for the branch. */
  hours: string | null
  /** A map link; empty until set, in which case the site builds one from the address. */
  mapUrl: string | null
}

export interface SiteIdentity {
  name: string
  tagline: string
  heroHeading: string
  heroBody: string
  aboutBody: string
  /** Empty hides the announcement bar. */
  announcement: string
  shopStatus: ShopStatus
  /** Empty hides the corresponding action on the site. */
  contactEmail: string
  contactPhone: string
  whatsapp: string
  social: SiteSocialLinks
}

export interface SiteContent {
  site: SiteIdentity
  branches: SiteBranch[]
  /** ISO 8601; the newest content change, or the load time when all is default. */
  updatedAt: string
}
