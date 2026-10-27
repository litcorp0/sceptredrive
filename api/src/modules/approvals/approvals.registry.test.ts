import { db } from '@sceptre/db'
import type { ApprovalType } from '@sceptre/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, databaseAvailable, deleteTestUser } from '../../../test/integration.ts'
import { branch } from '../org/branches.schema.ts'
import { approval } from './approvals.schema.ts'
import {
  assertDecisionHandlersRegistered,
  assertSubjectLoadersRegistered,
  registeredDecisionTypes,
  registeredSubjectTypes,
} from './approvals.service.ts'

/**
 * The two registries are the contract between this module and the services that
 * own each request type. A type that can be requested but neither decided nor
 * rendered is a boot failure, so this asserts the lists `app.ts` asserts.
 */

const available = await databaseAvailable()
if (!available) console.warn('[approvals.registry.test] database unavailable; tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

/**
 * What every plan leaves wired. Phase 13 appended `REFUND`; there is no
 * unregistered `ApprovalType` left, which is why the guard below is proven with
 * a deliberately wrong list rather than with an honest gap in this one.
 */
const BOOT_LIST: ApprovalType[] = [
  'PRODUCT_CREATE',
  'PURCHASE_ORDER',
  'TRANSFER_REQUEST',
  'STOCK_WRITE_OFF',
  'PRICE_CHANGE',
  'CREDIT_LIMIT_CHANGE',
  'SHIFT_VARIANCE_REVIEW',
  'REFUND',
]

let branchId = ''
let adminId = ''

beforeAll(async () => {
  if (!available) return

  const [created] = await db
    .insert(branch)
    .values({ code: `RR${suffix.slice(-6)}`, name: `Registry ${suffix}`, city: 'Accra' })
    .returning({ id: branch.id })
  branchId = created?.id ?? ''

  const admin = await createTestUser({ role: 'ADMIN', email: `registry-${suffix}@test.local` })
  adminId = admin.id
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

  it('refuses to boot with a type nobody registered a handler or a loader for', () => {
    // The registries have no unregister seam on purpose, so the guard is proven
    // against a list that is wrong rather than a type that is honestly absent.
    // Phase 13 registered the last real type, which retired the old fixture.
    const wrongHandlers = [...BOOT_LIST, 'REFUND_UNHANDLED' as ApprovalType]
    expect(() => assertDecisionHandlersRegistered(wrongHandlers)).toThrow(/REFUND_UNHANDLED/)
    expect(() => assertDecisionHandlersRegistered(BOOT_LIST)).not.toThrow()

    const wrongLoaders = ['REFUND_UNRENDERED' as ApprovalType]
    expect(() => assertSubjectLoadersRegistered(wrongLoaders)).toThrow(/REFUND_UNRENDERED/)
    expect(() => assertSubjectLoadersRegistered(BOOT_LIST)).not.toThrow()
  })
})
