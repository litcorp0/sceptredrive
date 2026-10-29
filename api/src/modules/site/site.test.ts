import { db } from '@sceptre/db'
import type { SiteContent } from '@sceptre/shared'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { branch } from '../org/branches.schema.ts'
import { setting } from '../platform/settings.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[site.test] database unavailable; integration tests skipped')

interface SitePayload {
  content: SiteContent
}

const FORBIDDEN_KEYS = new Set([
  'key',
  'source',
  'writableBy',
  'branchScoped',
  'id',
  'isActive',
  'type',
  'createdAt',
])

function collectKeys(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key)
      collectKeys(child, keys)
    }
  }
}

describe.skipIf(!available)('public site endpoint', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const suffix = randomToken(3)
  let adminCookie = ''
  let retailId = ''
  let inactiveId = ''

  async function createBranchAsAdmin(input: Record<string, unknown>): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(input),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { branch: { id: string } }
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function readSite(headers: Record<string, string> = {}): Promise<SitePayload> {
    const response = await app.request('/api/public/site', { headers })
    expect(response.status).toBe(200)
    return (await response.json()) as SitePayload
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN', name: 'Site Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    retailId = await createBranchAsAdmin({
      code: `W${suffix}-R`,
      name: `Site Retail ${suffix}`,
      type: 'RETAIL',
      city: 'Accra',
      area: 'Spintex',
      address: '14 Spintex Road',
      phone: '+233302555010',
    })

    await createBranchAsAdmin({
      code: `W${suffix}-H`,
      name: `Site Warehouse ${suffix}`,
      type: 'WAREHOUSE',
      city: 'Tema',
    })

    inactiveId = await createBranchAsAdmin({
      code: `W${suffix}-X`,
      name: `Site Closed ${suffix}`,
      type: 'RETAIL',
      city: 'Kumasi',
    })
    const deactivated = await app.request(`/api/branches/${inactiveId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(deactivated.status).toBe(200)
  })

  afterAll(async () => {
    await db
      .delete(setting)
      .where(inArray(setting.key, ['web.heroHeading', 'web.contactPhone', 'web.branchHours']))
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('serves without a session and with the short cache header', async () => {
    const response = await app.request('/api/public/site')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=300',
    )
  })

  it('returns the defaults before anyone edits the site', async () => {
    const { content } = await readSite()

    expect(content.site.name).toBe('Sceptre Drive')
    expect(content.site.shopStatus).toBe('COMING_SOON')
    expect(content.site.contactEmail).toBe('')
    expect(content.site.contactPhone).toBe('')
    expect(content.site.social).toEqual({ instagram: '', facebook: '', tiktok: '' })
    expect(new Date(content.updatedAt).toString()).not.toBe('Invalid Date')
  })

  it('lists active retail branches with their branch-master contact details', async () => {
    const { content } = await readSite()
    const codes = content.branches.map((row) => row.code)

    expect(codes).toContain(`W${suffix}-R`)
    expect(codes).not.toContain(`W${suffix}-H`)
    expect(codes).not.toContain(`W${suffix}-X`)

    const retail = content.branches.find((row) => row.code === `W${suffix}-R`)
    expect(retail?.address).toBe('14 Spintex Road')
    expect(retail?.phone).toBe('+233302555010')
    expect(retail?.city).toBe('Accra')
    expect(retail?.area).toBe('Spintex')
  })

  it('reflects an admin edit without a restart', async () => {
    const write = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'web.heroHeading', value: 'Parts for every road.' }),
    })
    expect(write.status).toBe(200)

    const { content } = await readSite()
    expect(content.site.heroHeading).toBe('Parts for every road.')
  })

  it('uses a branch override for hours and leaves other branches alone', async () => {
    const write = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        key: 'web.branchHours',
        value: 'Mon–Sat, 8:00–18:00',
        branchId: retailId,
      }),
    })
    expect(write.status).toBe(200)

    const { content } = await readSite()
    const retail = content.branches.find((row) => row.code === `W${suffix}-R`)
    expect(retail?.hours).toBe('Mon–Sat, 8:00–18:00')

    const other = content.branches.find((row) => row.code !== `W${suffix}-R`)
    if (other) expect(other.hours).toBeNull()
  })

  it('never exposes a settings key, source, id or internal field', async () => {
    const { content } = await readSite()
    const keys: string[] = []
    collectKeys(content, keys)
    const leaked = keys.filter((key) => FORBIDDEN_KEYS.has(key))
    expect(leaked).toEqual([])
  })

  it('rate limits the 121st request from one address', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.99' }
    let lastStatus = 0
    for (let index = 0; index < 121; index += 1) {
      const response = await app.request('/api/public/site', { headers })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })

  it('does not accept a write', async () => {
    const response = await app.request('/api/public/site', { method: 'POST' })
    expect([404, 405]).toContain(response.status)
  })
})
