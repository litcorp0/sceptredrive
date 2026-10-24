import { db } from '@gikautos/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  signIn,
} from '../../test/integration.ts'
import { app } from '../app.ts'
import { user as userTable } from '../modules/identity/staff.schema.ts'
import { setting } from '../modules/platform/settings.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[auth-policy.test] database unavailable; integration tests skipped')

/**
 * The public auth policy drives the console's forced-TOTP guard. The guard that
 * makes the flag mandatory for admins must itself require the acting admin to
 * have 2FA, or enabling it locks them out of the settings page.
 */
describe.skipIf(!available)('auth policy', () => {
  const createdUserIds: string[] = []
  let adminCookie = ''
  let adminId = ''

  async function policy(): Promise<boolean> {
    const response = await app.request('/api/auth/policy')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { requireTwoFactor: boolean }
    return body.requireTwoFactor
  }

  async function setRequireTwoFactor(value: boolean): Promise<Response> {
    return app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'auth.requireTwoFactor', value }),
    })
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminId = admin.id
    adminCookie = await signIn(admin.email)
    await db.delete(setting).where(eq(setting.key, 'auth.requireTwoFactor'))
  })

  afterAll(async () => {
    await db.delete(setting).where(eq(setting.key, 'auth.requireTwoFactor'))
    for (const userId of createdUserIds) await deleteTestUser(userId)
  })

  it('defaults to off', async () => {
    expect(await policy()).toBe(false)
  })

  it('refuses to make 2FA mandatory while the admin has none', async () => {
    const response = await setRequireTwoFactor(true)
    expect(response.status).toBe(403)
    expect(await policy()).toBe(false)
  })

  it('allows an enrolled admin to turn it on and off', async () => {
    await db.update(userTable).set({ twoFactorEnabled: true }).where(eq(userTable.id, adminId))

    const enabled = await setRequireTwoFactor(true)
    expect(enabled.status).toBe(200)
    expect(await policy()).toBe(true)

    const disabled = await setRequireTwoFactor(false)
    expect(disabled.status).toBe(200)
    expect(await policy()).toBe(false)
  })
})
