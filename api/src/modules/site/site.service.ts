import type { SiteBranch, SiteContent, SiteIdentity } from '@sceptre/shared'
import { listPublicBranchContacts } from '../org/branches.service.ts'
import { getSettingValue } from '../platform/settings.service.ts'

/**
 * The website's content, resolved from the settings registry and the branch
 * master.
 *
 * Every field is constructed explicitly. The settings service returns typed
 * values, but this mapper is also the whitelist: an internal key cannot leak by
 * being spread, and the public payload never carries `source`, `writableBy` or a
 * branch id. A test asserts that property.
 */

/** Empty optional strings are hidden by the site, not rendered as blank actions. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function resolveIdentity(): Promise<SiteIdentity> {
  const [
    name,
    tagline,
    heroHeading,
    heroBody,
    aboutBody,
    announcement,
    shopStatus,
    contactEmail,
    contactPhone,
    whatsapp,
    instagram,
    facebook,
    tiktok,
  ] = await Promise.all([
    getSettingValue('web.siteName'),
    getSettingValue('web.tagline'),
    getSettingValue('web.heroHeading'),
    getSettingValue('web.heroBody'),
    getSettingValue('web.aboutBody'),
    getSettingValue('web.announcement'),
    getSettingValue('web.shopStatus'),
    getSettingValue('web.contactEmail'),
    getSettingValue('web.contactPhone'),
    getSettingValue('web.whatsapp'),
    getSettingValue('web.instagram'),
    getSettingValue('web.facebook'),
    getSettingValue('web.tiktok'),
  ])

  return {
    name,
    tagline,
    heroHeading,
    heroBody,
    aboutBody,
    announcement,
    shopStatus,
    contactEmail,
    contactPhone,
    whatsapp,
    social: { instagram, facebook, tiktok },
  }
}

async function resolveBranches(): Promise<SiteBranch[]> {
  const rows = await listPublicBranchContacts()

  return Promise.all(
    rows.map(async (row) => {
      const [hours, mapUrl] = await Promise.all([
        getSettingValue('web.branchHours', { branchId: row.id }),
        getSettingValue('web.branchMapUrl', { branchId: row.id }),
      ])

      return {
        code: row.code,
        name: row.name,
        city: row.city,
        area: row.area,
        address: row.address,
        phone: row.phone,
        latitude: row.latitude,
        longitude: row.longitude,
        hours: optional(hours),
        mapUrl: optional(mapUrl),
      }
    }),
  )
}

/**
 * `updatedAt` is the load time: the settings service resolves the effective
 * value without exposing the row's timestamp, and a marketing page does not need
 * to claim when a sentence changed. It only drives the cache and social-image
 * refresh.
 */
export async function getSiteContent(): Promise<SiteContent> {
  const [site, branches] = await Promise.all([resolveIdentity(), resolveBranches()])
  return { site, branches, updatedAt: new Date().toISOString() }
}
