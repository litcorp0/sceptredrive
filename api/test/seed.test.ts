import { db } from '@gikautos/db'
import { branch, setting, terminal, user as userTable } from '@gikautos/db/schema'
import { seedAdmin, seedDemo } from '@gikautos/db/seed'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app.ts'
import { databaseAvailable, signIn } from './integration.ts'

const available = await databaseAvailable()
if (!available) console.warn('[seed.test] database unavailable; integration tests skipped')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@gikautos.test'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'test-admin-password-123'
const DEMO_MANAGER_EMAIL = 'manager@gikautos.local'
const DEMO_CASHIER_EMAIL = 'cashier@gikautos.local'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'
const SEEDED_EMAILS = [ADMIN_EMAIL, DEMO_MANAGER_EMAIL, DEMO_CASHIER_EMAIL]

describe.skipIf(!available)('database seeds', () => {
  afterAll(async () => {
    await db.delete(userTable).where(inArray(userTable.email, SEEDED_EMAILS))
    await db.delete(terminal).where(inArray(terminal.code, ['ACC-SPX-T01', 'ACC-WH1-T01']))
    await db.delete(branch).where(inArray(branch.code, ['ACC-SPX', 'ACC-WH1']))
    await db.delete(setting).where(inArray(setting.key, ['staff.idPrefix', 'receipt.header']))
  })

  it('creates the admin idempotently and the admin can sign in', async () => {
    const first = await seedAdmin()
    expect(first).toBe('created')

    const second = await seedAdmin()
    expect(second).toBe('skipped')

    const cookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)
    expect(cookie.length).toBeGreaterThan(0)

    const sessionResponse = await app.request('/api/auth/get-session', {
      headers: { cookie },
    })
    const session = (await sessionResponse.json()) as { user?: { role?: string } } | null
    expect(session?.user?.role).toBe('ADMIN')
  })

  it('creates demo users, branches, and terminals idempotently', async () => {
    const first = await seedDemo()
    expect(first.created.length).toBeGreaterThan(0)

    const second = await seedDemo()
    expect(second.created).toEqual([])

    const managerRows = await db
      .select({ role: userTable.role, branchId: userTable.branchId })
      .from(userTable)
      .where(eq(userTable.email, DEMO_MANAGER_EMAIL))
    expect(managerRows[0]?.role).toBe('MANAGER')

    const branchRows = await db
      .select({ id: branch.id })
      .from(branch)
      .where(eq(branch.code, 'ACC-SPX'))
    expect(branchRows[0]?.id).toBe(managerRows[0]?.branchId)

    const cashierRows = await db
      .select({ role: userTable.role, mustChangePassword: userTable.mustChangePassword })
      .from(userTable)
      .where(eq(userTable.email, DEMO_CASHIER_EMAIL))
    expect(cashierRows[0]?.role).toBe('CASHIER')
    expect(cashierRows[0]?.mustChangePassword).toBe(true)

    const terminalRows = await db
      .select({ id: terminal.id })
      .from(terminal)
      .where(inArray(terminal.code, ['ACC-SPX-T01', 'ACC-WH1-T01']))
    expect(terminalRows).toHaveLength(2)

    const managerCookie = await signIn(DEMO_MANAGER_EMAIL, DEMO_PASSWORD)
    expect(managerCookie.length).toBeGreaterThan(0)
  })
})
