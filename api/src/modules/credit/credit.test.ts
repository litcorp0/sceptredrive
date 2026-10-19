import { db } from '@gikautos/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { sumForCustomerBranch } from './credit.repository.ts'
import { creditLedgerEntry, creditProfile } from './credit.schema.ts'
import { postEntry, settleCharges, updateProfile } from './credit.service.ts'
import type { PostEntryInput, SettleableEntry } from './credit.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[credit.test] database unavailable; integration tests skipped')

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

describe.skipIf(!available)('credit service', () => {
  const suffix = uniqueSuffix()
  const branchIds: string[] = []
  const customerIds: string[] = []
  let branchAId = ''
  let branchBId = ''
  let managerUser: SessionUser
  let adminUser: SessionUser
  let cashierUser: SessionUser

  const actorId = `credit-actor-${suffix}`
  const actorStaffId = `GA-CREDIT-${suffix}`

  const actor: AuditActor = {
    actorId,
    actorStaffId,
    ip: null,
    userAgent: null,
    requestId: null,
  }

  function makeUser(overrides: Partial<SessionUser>): SessionUser {
    return {
      id: `user-${suffix}`,
      email: `user-${suffix}@gikautos.test`,
      name: 'Fixture User',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'MANAGER',
      branchId: null,
      staffId: null,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      twoFactorEnabled: false,
      image: null,
      ...overrides,
    } as SessionUser
  }

  async function createCustomerRow(name: string): Promise<string> {
    const rows = await db
      .insert(customer)
      .values({ name: `${name} ${suffix}`, createdBranchId: branchAId })
      .returning({ id: customer.id })
    const id = rows[0]?.id
    if (!id) throw new Error('customer fixture insert failed')
    customerIds.push(id)
    return id
  }

  function post(
    input: Partial<PostEntryInput> & Pick<PostEntryInput, 'customerId' | 'kind' | 'amountMinor'>,
  ) {
    return postEntry(actor, managerUser, { branchId: branchAId, ...input })
  }

  async function entryCount(customerId: string): Promise<number> {
    const rows = await db
      .select({ id: creditLedgerEntry.id })
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, customerId))
    return rows.length
  }

  async function profileBalance(customerId: string, branchId = branchAId): Promise<number | null> {
    const rows = await db
      .select({ balanceMinor: creditProfile.balanceMinor })
      .from(creditProfile)
      .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    return rows[0]?.balanceMinor ?? null
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        { code: `CRD-${suffix}-A`, name: `Credit A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `CRD-${suffix}-B`, name: `Credit B ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''
    branchIds.push(branchAId, branchBId)

    managerUser = makeUser({ role: 'MANAGER', branchId: branchAId })
    adminUser = makeUser({ role: 'ADMIN', branchId: null })
    cashierUser = makeUser({ role: 'CASHIER', branchId: branchAId })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.actorId, actorId))
    if (customerIds.length > 0) {
      for (const id of customerIds) {
        await db.delete(creditLedgerEntry).where(eq(creditLedgerEntry.customerId, id))
        await db.delete(creditProfile).where(eq(creditProfile.customerId, id))
        await db.delete(customer).where(eq(customer.id, id))
      }
    }
    for (const id of branchIds) {
      await db.delete(branch).where(eq(branch.id, id))
    }
  })

  it('enforces kind-specific sign, amount, and reason rules', async () => {
    const customerId = await createCustomerRow('Validation')

    const zeroCharge = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: 0, reasonCode: 'SALE' }),
    )
    expect(zeroCharge).toBeInstanceOf(ValidationError)

    const negativeCharge = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: -100, reasonCode: 'SALE' }),
    )
    expect(negativeCharge).toBeInstanceOf(ValidationError)

    const reasonlessCharge = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: 100 }),
    )
    expect(reasonlessCharge).toBeInstanceOf(ValidationError)

    const wrongReason = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: 100, reasonCode: 'WRITE_OFF' }),
    )
    expect(wrongReason).toBeInstanceOf(ValidationError)

    const positiveRepayment = await captureError(() =>
      post({ customerId, kind: 'REPAYMENT', amountMinor: 100, method: 'CASH' }),
    )
    expect(positiveRepayment).toBeInstanceOf(ValidationError)

    const methodlessRepayment = await captureError(() =>
      post({ customerId, kind: 'REPAYMENT', amountMinor: -100 }),
    )
    expect(methodlessRepayment).toBeInstanceOf(ValidationError)

    const positiveRefund = await captureError(() =>
      post({ customerId, kind: 'REFUND', amountMinor: 100 }),
    )
    expect(positiveRefund).toBeInstanceOf(ValidationError)

    const zeroAdjustment = await captureError(() =>
      post({ customerId, kind: 'ADJUSTMENT', amountMinor: 0, reasonCode: 'CORRECTION' }),
    )
    expect(zeroAdjustment).toBeInstanceOf(ValidationError)

    const reasonlessAdjustment = await captureError(() =>
      post({ customerId, kind: 'ADJUSTMENT', amountMinor: 50 }),
    )
    expect(reasonlessAdjustment).toBeInstanceOf(ValidationError)

    const overrideOnRepayment = await captureError(() =>
      post({
        customerId,
        kind: 'REPAYMENT',
        amountMinor: -100,
        method: 'CASH',
        override: { reasonCode: 'OTHER' },
      }),
    )
    expect(overrideOnRepayment).toBeInstanceOf(ValidationError)

    const unknownCustomer = await captureError(() =>
      post({
        customerId: crypto.randomUUID(),
        kind: 'CHARGE',
        amountMinor: 100,
        reasonCode: 'SALE',
      }),
    )
    expect(unknownCustomer).toBeInstanceOf(NotFoundError)

    // Rejected postings never write partial state.
    expect(await entryCount(customerId)).toBe(0)
  })

  it('posts a mixed sequence keeping balance equal to the entry sum', async () => {
    const customerId = await createCustomerRow('Mixed')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 1_000_000 })

    const chargeA = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 10_000,
      reasonCode: 'OPENING_BALANCE',
    })
    expect(chargeA.entry.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 6_000,
      reasonCode: 'SALE',
    })
    const repayment = await post({
      customerId,
      kind: 'REPAYMENT',
      amountMinor: -12_000,
      method: 'CASH',
      note: 'Till float',
    })

    // Repayment references are sequenced: REP-<5 digits>.
    expect(repayment.entry.referenceNumber).toMatch(/^REP-\d{5}$/)
    expect(repayment.entry.receivedBy).toBe(actor.actorStaffId)
    expect(repayment.profile.balanceMinor).toBe(4_000)

    // balance_minor = SUM(amount_minor), both ways.
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(4_000)
    expect(await profileBalance(customerId)).toBe(4_000)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.actorId, actorId))
    const actions = audits.map((row) => row.action)
    expect(actions).toContain('credit.charge')
    expect(actions).toContain('credit.repayment')
    expect(actions.filter((action) => action === 'credit.charge')).toHaveLength(2)
  })

  it('blocks charges while on hold and allows collections', async () => {
    const customerId = await createCustomerRow('Hold')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 50_000, paymentTermDays: 14 })
    await updateProfile(actor, managerUser, customerId, { hold: true })

    const blocked = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: 1_000, reasonCode: 'SALE' }),
    )
    expect(blocked).toBeInstanceOf(ConflictError)
    if (!(blocked instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(blocked.message).toContain('hold')

    // A hold stops new credit but never stops collecting.
    const collection = await post({
      customerId,
      kind: 'REPAYMENT',
      amountMinor: -1_000,
      method: 'CASH',
    })
    expect(collection.profile.balanceMinor).toBe(-1_000)

    await updateProfile(actor, managerUser, customerId, { hold: false })
    const charge = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 2_000,
      reasonCode: 'SALE',
    })
    expect(charge.profile.balanceMinor).toBe(1_000)
  })

  it('passes at the limit and blocks over-limit charges without an override', async () => {
    const customerId = await createCustomerRow('Limit')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 6_000 })

    const atLimit = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 6_000,
      reasonCode: 'SALE',
    })
    expect(atLimit.profile.balanceMinor).toBe(6_000)

    const over = await captureError(() =>
      post({ customerId, kind: 'CHARGE', amountMinor: 1, reasonCode: 'SALE' }),
    )
    expect(over).toBeInstanceOf(ConflictError)
    if (!(over instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(over.message).toContain('limit')

    // The rejection wrote nothing.
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(6_000)
    expect(await entryCount(customerId)).toBe(1)
  })

  it('records a reason-coded override with the approver on the entry', async () => {
    const customerId = await createCustomerRow('Override')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 5_000 })
    await post({ customerId, kind: 'CHARGE', amountMinor: 5_000, reasonCode: 'SALE' })

    const over = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 2_500,
      reasonCode: 'SALE',
      override: { reasonCode: 'TRUSTED_CUSTOMER', note: 'Regular, pays weekly' },
    })
    expect(over.entry.overrideReason).toBe('TRUSTED_CUSTOMER')
    expect(over.entry.overriddenBy).toBe(actor.actorStaffId)
    expect(over.profile.balanceMinor).toBe(7_500)

    const overrideAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'credit.override'), eq(auditLog.entityId, over.entry.id)))
    expect(overrideAudits).toHaveLength(1)
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(7_500)
  })

  it('fails closed when the actor lacks the credit.override permission', async () => {
    const customerId = await createCustomerRow('NoPermission')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 1_000 })
    await post({ customerId, kind: 'CHARGE', amountMinor: 1_000, reasonCode: 'SALE' })

    const denied = await captureError(() =>
      postEntry(actor, cashierUser, {
        customerId,
        branchId: branchAId,
        kind: 'CHARGE',
        amountMinor: 500,
        reasonCode: 'SALE',
        override: { reasonCode: 'OTHER' },
      }),
    )
    expect(denied).toBeInstanceOf(ForbiddenError)
    expect(await entryCount(customerId)).toBe(1)
  })

  it('blocks new charges for archived and anonymized customers but allows collections', async () => {
    const archivedId = await createCustomerRow('Archived')
    await db.update(customer).set({ status: 'ARCHIVED' }).where(eq(customer.id, archivedId))

    const blocked = await captureError(() =>
      post({ customerId: archivedId, kind: 'CHARGE', amountMinor: 500, reasonCode: 'SALE' }),
    )
    expect(blocked).toBeInstanceOf(ConflictError)
    if (!(blocked instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(blocked.message).toContain('Archived')

    const collection = await post({
      customerId: archivedId,
      kind: 'REPAYMENT',
      amountMinor: -500,
      method: 'CASH',
    })
    expect(collection.entry.kind).toBe('REPAYMENT')

    const anonymizedId = await createCustomerRow('Anonymized')
    await db
      .update(customer)
      .set({ anonymizedAt: new Date(), name: 'Anonymized customer', phone: null })
      .where(eq(customer.id, anonymizedId))
    const sealed = await captureError(() =>
      post({ customerId: anonymizedId, kind: 'REPAYMENT', amountMinor: -100, method: 'CASH' }),
    )
    expect(sealed).toBeInstanceOf(ConflictError)
    if (!(sealed instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(sealed.message).toContain('Anonymized')
  })

  it('replays idempotent postings without a second row or balance change', async () => {
    const customerId = await createCustomerRow('Idempotent')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 10_000 })
    const input = {
      customerId,
      kind: 'CHARGE',
      amountMinor: 750,
      reasonCode: 'SALE',
      idempotencyKey: `credit-idem-${suffix}`,
    } as const

    const first = await post(input)
    const replay = await post(input)

    expect(replay.entry.id).toBe(first.entry.id)
    expect(replay.profile.balanceMinor).toBe(750)
    expect(await entryCount(customerId)).toBe(1)
  })

  it('serializes a simultaneous replay of the same idempotency key', async () => {
    const customerId = await createCustomerRow('Race')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 10_000 })
    const input = {
      customerId,
      kind: 'CHARGE',
      amountMinor: 900,
      reasonCode: 'SALE',
      idempotencyKey: `credit-race-${suffix}`,
    } as const

    const [first, second] = await Promise.all([post(input), post(input)])
    expect(first.entry.id).toBe(second.entry.id)
    expect(await entryCount(customerId)).toBe(1)
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(900)
  })

  it('serializes two parallel refunds below the balance', async () => {
    const customerId = await createCustomerRow('RefundRace')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 100_000 })
    await post({ customerId, kind: 'CHARGE', amountMinor: 10_000, reasonCode: 'OPENING_BALANCE' })

    const [first, second] = await Promise.all([
      post({ customerId, kind: 'REFUND', amountMinor: -3_000, note: 'Return 1' }),
      post({ customerId, kind: 'REFUND', amountMinor: -3_000, note: 'Return 2' }),
    ])

    expect(first.entry.kind).toBe('REFUND')
    expect(first.entry.reasonCode).toBe('RETURN')
    expect(second.entry.reasonCode).toBe('RETURN')
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(4_000)
    expect(await profileBalance(customerId)).toBe(4_000)
    expect(await entryCount(customerId)).toBe(3)
  })

  it('settles charges oldest-first, exposing overpayment as unapplied credit', () => {
    const day = (dayOfMonth: number) => new Date(Date.UTC(2026, 8, dayOfMonth, 12, 0, 0))
    const charge = (id: string, amountMinor: number, dayOfMonth: number): SettleableEntry => ({
      id,
      kind: 'CHARGE',
      amountMinor,
      occurredAt: day(dayOfMonth),
      createdAt: day(dayOfMonth),
      dueDate: null,
    })
    const credit = (
      id: string,
      amountMinor: number,
      dayOfMonth: number,
      kind: SettleableEntry['kind'] = 'REPAYMENT',
    ): SettleableEntry => ({
      id,
      kind,
      amountMinor,
      occurredAt: day(dayOfMonth),
      createdAt: day(dayOfMonth),
      dueDate: null,
    })

    // Charge 100, charge 60, repay 120: first fully settled, second 40 outstanding.
    const fifo = settleCharges([charge('c1', 100, 1), charge('c2', 60, 5), credit('r1', -120, 10)])
    expect(fifo.charges.find((row) => row.entryId === 'c1')?.outstandingMinor).toBe(0)
    expect(fifo.charges.find((row) => row.entryId === 'c2')?.outstandingMinor).toBe(40)
    expect(fifo.unappliedCreditMinor).toBe(0)
    expect(fifo.charges[0]?.dueDate).toBe('2026-09-01')

    // Overpayment leaves unapplied branch credit.
    const overpaid = settleCharges([
      charge('c1', 100, 1),
      charge('c2', 60, 5),
      credit('r1', -200, 10),
    ])
    expect(overpaid.charges.map((row) => row.outstandingMinor)).toEqual([0, 0])
    expect(overpaid.unappliedCreditMinor).toBe(40)

    // Positive adjustments are charges; negative ones settle in occurrence order.
    const adjusted = settleCharges([
      charge('c1', 100, 1),
      credit('a1', -30, 3, 'ADJUSTMENT'),
      credit('a2', 20, 4, 'ADJUSTMENT'),
    ])
    expect(adjusted.charges.map((row) => [row.entryId, row.outstandingMinor])).toEqual([
      ['c1', 70],
      ['a2', 20],
    ])
    expect(adjusted.unappliedCreditMinor).toBe(0)
  })

  it('derives due dates from payment terms and honors explicit due dates', async () => {
    const customerId = await createCustomerRow('Terms')
    await updateProfile(actor, managerUser, customerId, {
      paymentTermDays: 30,
      limitMinor: 100_000,
    })

    const occurredAt = new Date('2026-09-01T10:00:00Z')
    const charge = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 5_000,
      reasonCode: 'SALE',
      occurredAt,
    })
    expect(charge.entry.dueDate).toBe('2026-10-01')

    const explicit = await post({
      customerId,
      kind: 'CHARGE',
      amountMinor: 1_000,
      reasonCode: 'SALE',
      occurredAt,
      dueDate: new Date('2026-09-15T00:00:00Z'),
    })
    expect(explicit.entry.dueDate).toBe('2026-09-15')
  })

  it('updates profile settings only, audits them, and never touches the balance', async () => {
    const customerId = await createCustomerRow('Settings')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 20_000 })
    await post({ customerId, kind: 'CHARGE', amountMinor: 1_200, reasonCode: 'OPENING_BALANCE' })

    const updated = await updateProfile(actor, managerUser, customerId, {
      limitMinor: 25_000,
      paymentTermDays: 7,
      notes: 'Watch closely',
    })
    expect(updated.limitMinor).toBe(25_000)
    expect(updated.paymentTermDays).toBe(7)
    expect(updated.notes).toBe('Watch closely')
    expect(updated.balanceMinor).toBe(1_200)

    // Setup update + assertion update are both audited.
    const profileAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'credit.profile_updated'), eq(auditLog.entityId, updated.id)))
    expect(profileAudits).toHaveLength(2)

    const managerOtherBranch = await captureError(() =>
      updateProfile(actor, managerUser, customerId, { branchId: branchBId, limitMinor: 100 }),
    )
    expect(managerOtherBranch).toBeInstanceOf(ForbiddenError)

    const adminNoBranch = await captureError(() =>
      updateProfile(actor, adminUser, customerId, { limitMinor: 100 }),
    )
    expect(adminNoBranch).toBeInstanceOf(ValidationError)

    const asAdmin = await updateProfile(actor, adminUser, customerId, {
      branchId: branchAId,
      limitMinor: 30_000,
    })
    expect(asAdmin.limitMinor).toBe(30_000)
    expect(asAdmin.balanceMinor).toBe(1_200)
  })

  it('keeps branch credit profiles isolated', async () => {
    const customerId = await createCustomerRow('Isolation')
    await updateProfile(actor, managerUser, customerId, { limitMinor: 50_000 })
    await updateProfile(actor, adminUser, customerId, { branchId: branchBId, limitMinor: 50_000 })

    await post({ customerId, kind: 'CHARGE', amountMinor: 5_000, reasonCode: 'SALE' })
    await postEntry(actor, adminUser, {
      customerId,
      branchId: branchBId,
      kind: 'CHARGE',
      amountMinor: 7_000,
      reasonCode: 'SALE',
    })

    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(5_000)
    expect(await sumForCustomerBranch(customerId, branchBId)).toBe(7_000)
    expect(await profileBalance(customerId, branchAId)).toBe(5_000)
    expect(await profileBalance(customerId, branchBId)).toBe(7_000)

    const profiles = await db
      .select({ branchId: creditProfile.branchId })
      .from(creditProfile)
      .where(eq(creditProfile.customerId, customerId))
    expect(profiles).toHaveLength(2)

    const crossBranch = await captureError(() =>
      post({
        customerId,
        kind: 'CHARGE',
        amountMinor: 100,
        reasonCode: 'SALE',
        branchId: branchBId,
      }),
    )
    expect(crossBranch).toBeInstanceOf(ForbiddenError)
  })
})

describe.skipIf(!available)('credit HTTP surface', () => {
  const suffix = uniqueSuffix()
  const createdUserIds: string[] = []
  const createdCustomerIds: string[] = []
  let branchAId = ''
  let branchBId = ''
  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''

  async function createCustomerRow(name: string): Promise<string> {
    const rows = await db
      .insert(customer)
      .values({ name: `${name} ${suffix}`, createdBranchId: branchAId })
      .returning({ id: customer.id })
    const id = rows[0]?.id
    if (!id) throw new Error('customer fixture insert failed')
    createdCustomerIds.push(id)
    return id
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        {
          code: `CRDHTTP-${suffix}-A`,
          name: `Credit HTTP A ${suffix}`,
          type: 'RETAIL',
          city: 'Accra',
        },
        {
          code: `CRDHTTP-${suffix}-B`,
          name: `Credit HTTP B ${suffix}`,
          type: 'RETAIL',
          city: 'Kumasi',
        },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({ role: 'MANAGER', branchId: branchAId })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({ role: 'CASHIER', branchId: branchAId })
    createdUserIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)
  })

  afterAll(async () => {
    if (createdCustomerIds.length > 0) {
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    if (createdUserIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.actorId, createdUserIds))
      await db.delete(userTable).where(inArray(userTable.id, createdUserIds))
    }
    for (const id of [branchAId, branchBId]) {
      if (id) await db.delete(branch).where(eq(branch.id, id))
    }
  })

  it('requires a session', async () => {
    const response = await app.request(`/api/credit/profiles?branchId=${branchAId}`)
    expect(response.status).toBe(401)
  })

  it('denies cashiers on every credit endpoint', async () => {
    const profiles = await app.request(`/api/credit/profiles?branchId=${branchAId}`, {
      headers: authedHeaders(cashierCookie),
    })
    expect(profiles.status).toBe(403)

    const repayment = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({
        customerId: crypto.randomUUID(),
        amountMinor: 1_000,
        method: 'CASH',
      }),
    })
    expect(repayment.status).toBe(403)

    const entry = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({
        customerId: crypto.randomUUID(),
        kind: 'CHARGE',
        amountMinor: 1_000,
        reasonCode: 'SALE',
      }),
    })
    expect(entry.status).toBe(403)
  })

  it('lets a manager manage a profile, charge, and collect at their branch', async () => {
    const customerId = await createCustomerRow('HTTP Flow')

    const put = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        limitMinor: 40_000,
        paymentTermDays: 14,
        hold: false,
        notes: 'HTTP test',
      }),
    })
    expect(put.status).toBe(200)
    const profile = (
      await readJson<{
        profile: { id: string; limitMinor: number; paymentTermDays: number; notes: string | null }
      }>(put)
    ).profile
    expect(profile.limitMinor).toBe(40_000)
    expect(profile.paymentTermDays).toBe(14)
    expect(profile.notes).toBe('HTTP test')

    const profileAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'credit.profile_updated'), eq(auditLog.entityId, profile.id)))
    expect(profileAudits).toHaveLength(1)

    const charge = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 10_000, reasonCode: 'SALE' }),
    })
    expect(charge.status).toBe(201)
    const chargeBody = await readJson<{
      entry: { id: string; dueDate: string | null }
      profile: { balanceMinor: number }
    }>(charge)
    expect(chargeBody.profile.balanceMinor).toBe(10_000)

    // 14-day terms project a due date two weeks after today (UTC).
    const now = new Date()
    const expectedDue = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14),
    )
      .toISOString()
      .slice(0, 10)
    expect(chargeBody.entry.dueDate).toBe(expectedDue)

    const repayment = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, amountMinor: 4_000, method: 'CASH' }),
    })
    expect(repayment.status).toBe(201)
    const repaymentBody = await readJson<{
      entry: { id: string; referenceNumber: string | null; amountMinor: number }
      profile: { balanceMinor: number }
    }>(repayment)
    expect(repaymentBody.entry.referenceNumber).toMatch(/^REP-\d{5}$/)
    expect(repaymentBody.entry.amountMinor).toBe(-4_000)
    expect(repaymentBody.profile.balanceMinor).toBe(6_000)

    const entries = await app.request(`/api/credit/entries?customerId=${customerId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(entries.status).toBe(200)
    const list = await readJson<{ entries: { id: string }[]; total: number; page: number }>(entries)
    expect(list.total).toBe(2)
    expect(list.entries.map((row) => row.id)).toEqual(
      expect.arrayContaining([chargeBody.entry.id, repaymentBody.entry.id]),
    )

    const profiles = await app.request(`/api/credit/profiles?customerId=${customerId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(profiles.status).toBe(200)
    const profileList = await readJson<{
      profiles: { branchId: string; balanceMinor: number }[]
    }>(profiles)
    expect(profileList.profiles).toHaveLength(1)
    expect(profileList.profiles[0]?.branchId).toBe(branchAId)
    expect(profileList.profiles[0]?.balanceMinor).toBe(6_000)
  })

  it('denies managers any access to another branch', async () => {
    const customerId = await createCustomerRow('HTTP Cross')

    const repayment = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        customerId,
        branchId: branchBId,
        amountMinor: 1_000,
        method: 'CASH',
      }),
    })
    expect(repayment.status).toBe(403)

    const entries = await app.request(
      `/api/credit/entries?customerId=${customerId}&branchId=${branchBId}`,
      { headers: authedHeaders(managerCookie) },
    )
    expect(entries.status).toBe(403)

    const put = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: branchBId, limitMinor: 1_000 }),
    })
    expect(put.status).toBe(403)
  })

  it('blocks over-limit charges unless an override is recorded', async () => {
    const customerId = await createCustomerRow('HTTP Override')
    const put = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ limitMinor: 1_000 }),
    })
    expect(put.status).toBe(200)

    const first = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 1_000, reasonCode: 'SALE' }),
    })
    expect(first.status).toBe(201)

    const blocked = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 500, reasonCode: 'SALE' }),
    })
    expect(blocked.status).toBe(409)

    const overridden = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        customerId,
        kind: 'CHARGE',
        amountMinor: 500,
        reasonCode: 'SALE',
        override: { reasonCode: 'URGENT_NEED', note: 'Family emergency' },
      }),
    })
    expect(overridden.status).toBe(201)
    const overriddenBody = await readJson<{
      entry: { id: string; overrideReason: string | null }
    }>(overridden)
    expect(overriddenBody.entry.overrideReason).toBe('URGENT_NEED')

    const overrideAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, 'credit.override'), eq(auditLog.entityId, overriddenBody.entry.id)),
      )
    expect(overrideAudits).toHaveLength(1)
  })

  it('rejects invalid postings with 400', async () => {
    const customerId = await createCustomerRow('HTTP Invalid')

    const reasonless = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 100 }),
    })
    expect(reasonless.status).toBe(400)

    const zeroAdjustment = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        customerId,
        kind: 'ADJUSTMENT',
        amountMinor: 0,
        reasonCode: 'CORRECTION',
      }),
    })
    expect(zeroAdjustment.status).toBe(400)

    const methodlessRepayment = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, amountMinor: 100 }),
    })
    expect(methodlessRepayment.status).toBe(400)
  })

  it('requires admins to name the branch when posting', async () => {
    const customerId = await createCustomerRow('HTTP Admin')

    const missing = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ customerId, amountMinor: 1_000, method: 'CASH' }),
    })
    expect(missing.status).toBe(400)

    const withBranch = await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        customerId,
        branchId: branchAId,
        amountMinor: 1_000,
        method: 'CASH',
      }),
    })
    expect(withBranch.status).toBe(201)
  })
})
