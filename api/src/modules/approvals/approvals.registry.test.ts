import { db } from '@sceptre/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { branch } from '../org/branches.schema.ts'
import { approval } from './approvals.schema.ts'
import { registeredDecisionTypes, registeredSubjectTypes } from './approvals.service.ts'

/**
 * The two registries are the contract between this module and the services that
 * own each request type. A type that can be requested but neither decided nor
 * rendered is a boot failure, so this asserts the lists `app.ts` asserts.
 */

const available = await databaseAvailable()
if (!available) console.warn('[approvals.registry.test] database unavailable; tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

/** What Plan 04 leaves wired; Plans 05–08 append their own type in their commit. */
const BOOT_LIST = ['PRODUCT_CREATE', 'PURCHASE_ORDER', 'TRANSFER_REQUEST']

let branchId = ''
let adminId = ''
let adminCookie = ''

beforeAll(async () => {
  if (!available) return

  const [created] = await db
    .insert(branch)
    .values({ code: `RR${suffix.slice(-6)}`, name: `Registry ${suffix}`, city: 'Accra' })
    .returning({ id: branch.id })
  branchId = created?.id ?? ''

  const admin = await createTestUser({ role: 'ADMIN', email: `registry-${suffix}@test.local` })
  adminId = admin.id
  adminCookie = await signIn(admin.email)
})

afterAll(async () => {
  if (!available) return
  await db.delete(approval).where(eq(approval.branchId, branchId))
  if (adminId) await deleteTestUser(adminId)
  await db.delete(branch).where(eq(branch.id, branchId))
})

describe.skipIf(!available)('approval registries', () => {
  it('registers a decision handler for exactly the boot list', () => {
    expect([...registeredDecisionTypes()].sort()).toEqual([...BOOT_LIST].sort())
  })

  it('registers a subject loader for exactly the boot list', () => {
    expect([...registeredSubjectTypes()].sort()).toEqual([...BOOT_LIST].sort())
  })

  it('answers 500 when a type has no decision handler', async () => {
    // `REFUND` is the honest unregistered type: Phase 13 registers it, so this
    // assertion does not need editing when Plans 05–08 land their handlers.
    const [row] = await db
      .insert(approval)
      .values({
        type: 'REFUND',
        branchId,
        requestedBy: 'someone-else',
        deciderRole: 'ADMIN',
        deciderBranchId: null,
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(500)

    // Nothing was recorded: the handler is checked before the status change.
    const after = await db
      .select({ status: approval.status })
      .from(approval)
      .where(eq(approval.id, row?.id ?? ''))
    expect(after[0]?.status).toBe('PENDING')
  })
})
