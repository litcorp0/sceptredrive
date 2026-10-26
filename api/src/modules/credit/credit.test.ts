import { db } from '@sceptre/db'
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
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { selectAttention } from '../analytics/analytics.repository.ts'
import { approval } from '../approvals/approvals.schema.ts'
import { decideApproval } from '../approvals/approvals.service.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { findProfile, sumForCustomerBranch } from './credit.repository.ts'
import { creditLedgerEntry, creditProfile } from './credit.schema.ts'
import {
  getAging,
  getStatement,
  listOverLimit,
  postEntry,
  requestCreditLimitIncrease,
  settleCharges,
  updateProfile,
} from './credit.service.ts'
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
  let branchCId = ''
  let branchDId = ''
  let managerUser: SessionUser
  let managerCUser: SessionUser
  let adminUser: SessionUser
  let cashierUser: SessionUser

  const actorId = `credit-actor-${suffix}`
  const actorStaffId = `GA-CREDIT-${suffix}`
  // A second actor for decisions: `canDecideApproval` refuses self-approval for
  // every role, so the admin deciding cannot be the manager requesting.
  const adminActorId = `credit-admin-actor-${suffix}`
  const adminActorStaffId = `GA-CREDIT-ADMIN-${suffix}`

  const actor: AuditActor = {
    actorId,
    actorStaffId,
    ip: null,
    userAgent: null,
    requestId: null,
  }

  const adminActor: AuditActor = {
    actorId: adminActorId,
    actorStaffId: adminActorStaffId,
    ip: null,
    userAgent: null,
    requestId: null,
  }

  function makeUser(overrides: Partial<SessionUser>): SessionUser {
    return {
      id: `user-${suffix}`,
      email: `user-${suffix}@sceptre.test`,
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

  /**
   * Fixtures raise limits as an admin. Since P12-D21 a manager's increase is a
   * `CREDIT_LIMIT_CHANGE` request, so a fixture that tried it as a manager would
   * exercise the 403 instead of the thing it is setting up.
   */
  function setLimit(
    customerId: string,
    limitMinor: number,
    branchId = branchAId,
    paymentTermDays?: number,
  ) {
    return updateProfile(actor, adminUser, customerId, {
      branchId,
      limitMinor,
      ...(paymentTermDays === undefined ? {} : { paymentTermDays }),
    })
  }

  /** Every `CREDIT_LIMIT_CHANGE` row raised for one profile. */
  async function limitApprovals(profileId: string) {
    return db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'CREDIT_LIMIT_CHANGE'), eq(approval.entityId, profileId)))
  }

  /** The `via` values written to `credit.profile_updated` for one profile. */
  async function limitAuditVias(profileId: string): Promise<(string | null)[]> {
    const rows = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'credit.profile_updated'), eq(auditLog.entityId, profileId)))
    return rows.map((row) => (row.after as { via?: string | null } | null)?.via ?? null)
  }

  async function requireProfile(customerId: string, branchId = branchAId) {
    const profile = await findProfile(customerId, branchId)
    if (!profile) throw new Error('credit profile fixture missing')
    return profile
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        { code: `CRD-${suffix}-A`, name: `Credit A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `CRD-${suffix}-B`, name: `Credit B ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
        { code: `CRD-${suffix}-C`, name: `Credit C ${suffix}`, type: 'RETAIL', city: 'Takoradi' },
        { code: `CRD-${suffix}-D`, name: `Credit D ${suffix}`, type: 'RETAIL', city: 'Tamale' },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''
    branchCId = branches[2]?.id ?? ''
    branchDId = branches[3]?.id ?? ''
    branchIds.push(branchAId, branchBId, branchCId, branchDId)

    managerUser = makeUser({ role: 'MANAGER', branchId: branchAId })
    managerCUser = makeUser({ role: 'MANAGER', branchId: branchCId })
    adminUser = makeUser({ role: 'ADMIN', branchId: null })
    cashierUser = makeUser({ role: 'CASHIER', branchId: branchAId })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.actorId, [actorId, adminActorId]))
    // `approval.branch_id` restricts the branch delete, and these fixtures own
    // every approval raised on their own branches.
    if (branchIds.length > 0) {
      await db.delete(approval).where(inArray(approval.branchId, branchIds))
    }
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
    await setLimit(customerId, 1_000_000)

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
    await setLimit(customerId, 50_000, branchAId, 14)
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
    await setLimit(customerId, 6_000)

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
    await setLimit(customerId, 5_000)
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
    await setLimit(customerId, 1_000)
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
    await setLimit(customerId, 10_000)
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
    await setLimit(customerId, 10_000)
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
    await setLimit(customerId, 100_000)
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
    await setLimit(customerId, 100_000, branchAId, 30)

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
    await setLimit(customerId, 20_000)
    await post({ customerId, kind: 'CHARGE', amountMinor: 1_200, reasonCode: 'OPENING_BALANCE' })

    // A manager may lower the limit but not raise it (P12-D21): this is the
    // decrease half; the increase half has its own test below.
    const updated = await updateProfile(actor, managerUser, customerId, {
      limitMinor: 18_000,
      paymentTermDays: 7,
      notes: 'Watch closely',
    })
    expect(updated.limitMinor).toBe(18_000)
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
    await setLimit(customerId, 50_000)
    await setLimit(customerId, 50_000, branchBId)

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

  it('ages charges into fixed buckets from their due dates', async () => {
    const asOf = new Date('2026-10-16T09:00:00Z')
    const customerId = await createCustomerRow('Aging')
    await setLimit(customerId, 1_000_000, branchCId, 30)

    // Due 2026-07-01 → 107 days past due → over90 (10_000).
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 10_000,
      reasonCode: 'SALE',
      occurredAt: new Date('2026-06-01T10:00:00Z'),
    })
    // Due 2026-08-19 → 58 days past due → days31To60 (5_000).
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 5_000,
      reasonCode: 'SALE',
      occurredAt: new Date('2026-07-20T10:00:00Z'),
    })
    // Collects the oldest charge down to 6_000.
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'REPAYMENT',
      amountMinor: -4_000,
      method: 'CASH',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
    })
    // Terms shrink to 0: due 2026-10-15 → 1 day past due → days1To30 (2_000).
    await updateProfile(actor, managerCUser, customerId, { paymentTermDays: 0 })
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 2_000,
      reasonCode: 'SALE',
      occurredAt: new Date('2026-10-15T10:00:00Z'),
    })

    // A credit-only customer (negative balance) never appears in aging.
    const creditOnlyId = await createCustomerRow('Aging Credit')
    await postEntry(actor, managerCUser, {
      customerId: creditOnlyId,
      branchId: branchCId,
      kind: 'REPAYMENT',
      amountMinor: -500,
      method: 'CASH',
    })

    const aging = await getAging(managerCUser, { asOf })
    expect(aging.asOf).toBe('2026-10-16')
    expect(aging.branches).toHaveLength(1)
    const branchAging = aging.branches[0]
    expect(branchAging?.branch.id).toBe(branchCId)

    const row = branchAging?.customers.find((entry) => entry.customerId === customerId)
    expect(row?.buckets).toEqual({
      current: 0,
      days1To30: 2_000,
      days31To60: 5_000,
      days61To90: 0,
      over90: 6_000,
    })
    expect(row?.totalMinor).toBe(13_000)
    expect(row?.oldestDueDate).toBe('2026-07-01')
    expect(branchAging?.customers.map((entry) => entry.customerId)).not.toContain(creditOnlyId)

    // Branch totals are the sum of the customer rows, once each.
    const bucketSum = (branchAging?.customers ?? []).reduce(
      (sum, entry) => sum + entry.totalMinor,
      0,
    )
    expect(branchAging?.totals.total).toBe(bucketSum)

    // Managers cannot peek at another branch's aging.
    const crossAging = await captureError(() => getAging(managerCUser, { branchId: branchAId }))
    expect(crossAging).toBeInstanceOf(ForbiddenError)

    // Admins see every branch separately (each branch id appears once).
    const adminAging = await getAging(adminUser, { asOf })
    const ids = adminAging.branches.map((entry) => entry.branch.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(branchAId)
    expect(ids).toContain(branchBId)
    expect(ids).toContain(branchCId)
    const adminBranchC = adminAging.branches.find((entry) => entry.branch.id === branchCId)
    expect(
      adminBranchC?.customers.find((entry) => entry.customerId === customerId)?.totalMinor,
    ).toBe(13_000)
  })

  it('reconciles statements: opening + ranged = closing = balance', async () => {
    const customerId = await createCustomerRow('Statement')
    await setLimit(customerId, 1_000_000, branchCId, 14)

    // Before the range.
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 3_000,
      reasonCode: 'OPENING_BALANCE',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
    })
    // Inside the range: due 2026-09-24, then a partial collection.
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 5_000,
      reasonCode: 'SALE',
      occurredAt: new Date('2026-09-10T10:00:00Z'),
    })
    const repayment = await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'REPAYMENT',
      amountMinor: -2_000,
      method: 'CASH',
      occurredAt: new Date('2026-09-20T10:00:00Z'),
    })
    // After the range.
    await postEntry(actor, managerCUser, {
      customerId,
      branchId: branchCId,
      kind: 'CHARGE',
      amountMinor: 1_000,
      reasonCode: 'SALE',
      occurredAt: new Date('2026-10-05T10:00:00Z'),
    })

    const statement = await getStatement(managerCUser, customerId, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T23:59:59.999Z'),
    })
    expect(statement.from).toBe('2026-09-01')
    expect(statement.to).toBe('2026-09-30')
    expect(statement.openingBalanceMinor).toBe(3_000)
    expect(statement.entries.map((entry) => entry.amountMinor)).toEqual([5_000, -2_000])
    expect(statement.entries.map((entry) => entry.id)).toContain(repayment.entry.id)
    expect(statement.closingBalanceMinor).toBe(6_000)
    expect(statement.currentBalanceMinor).toBe(7_000)
    expect(statement.customer.name).toContain('Statement')
    expect(statement.branch.code).toBe(`CRD-${suffix}-C`)

    // Aging snapshot as of `to`: the August charge keeps 1_000 (46 days due),
    // the September charge 5_000 (6 days due); the October charge is excluded.
    expect(statement.aging.map((charge) => [charge.outstandingMinor, charge.bucket])).toEqual([
      [1_000, 'days31To60'],
      [5_000, 'days1To30'],
    ])
    expect(statement.aging.reduce((sum, charge) => sum + charge.outstandingMinor, 0)).toBe(
      statement.closingBalanceMinor,
    )

    // A full-range statement reconciles to the profile balance exactly.
    const full = await getStatement(managerCUser, customerId, {})
    expect(full.from).toBeNull()
    expect(full.openingBalanceMinor).toBe(0)
    expect(full.entries).toHaveLength(4)
    expect(full.closingBalanceMinor).toBe(7_000)
    expect(full.closingBalanceMinor).toBe(full.currentBalanceMinor)
    expect(await profileBalance(customerId, branchCId)).toBe(7_000)

    // Statement guards: missing profile → 404, cross-branch → 403, admin must name a branch.
    const noProfileId = await createCustomerRow('Statement Missing')
    const missing = await captureError(() => getStatement(managerCUser, noProfileId, {}))
    expect(missing).toBeInstanceOf(NotFoundError)

    const crossBranch = await captureError(() =>
      getStatement(managerCUser, customerId, { branchId: branchAId }),
    )
    expect(crossBranch).toBeInstanceOf(ForbiddenError)

    const noBranch = await captureError(() => getStatement(adminUser, customerId, {}))
    expect(noBranch).toBeInstanceOf(ValidationError)
  })

  it('lets a manager lower a limit directly and refuses an increase at the service', async () => {
    const customerId = await createCustomerRow('Authority')
    await setLimit(customerId, 5_000)
    const profile = await requireProfile(customerId)

    const lowered = await updateProfile(actor, managerUser, customerId, { limitMinor: 4_000 })
    expect(lowered.limitMinor).toBe(4_000)
    expect(
      (await limitAuditVias(profile.id)).filter((via) => via === 'DIRECT_DECREASE'),
    ).toHaveLength(1)

    const refused = await captureError(() =>
      updateProfile(actor, managerUser, customerId, { limitMinor: 6_000 }),
    )
    expect(refused).toBeInstanceOf(ForbiddenError)
    if (!(refused instanceof ForbiddenError)) throw new Error('expected ForbiddenError')
    // The 403 names the endpoint, so the console has one instruction to show.
    expect(refused.message).toContain('Request limit increase')

    expect((await requireProfile(customerId)).limitMinor).toBe(4_000)
    expect(await limitApprovals(profile.id)).toHaveLength(0)

    // `hold`, terms and notes are not exposure and stay direct for a manager.
    const settings = await updateProfile(actor, managerUser, customerId, {
      hold: true,
      paymentTermDays: 21,
      notes: 'Lowered after review',
    })
    expect(settings.limitMinor).toBe(4_000)
    expect(settings.hold).toBe(true)
    expect(settings.paymentTermDays).toBe(21)
  })

  it('lets an admin raise a limit directly without an approval', async () => {
    const customerId = await createCustomerRow('AdminDirect')
    await setLimit(customerId, 5_000)
    const profile = await requireProfile(customerId)

    const raised = await updateProfile(actor, adminUser, customerId, {
      branchId: branchAId,
      limitMinor: 6_000,
    })
    expect(raised.limitMinor).toBe(6_000)
    expect(await limitApprovals(profile.id)).toHaveLength(0)
    expect(await limitAuditVias(profile.id)).toContain('DIRECT')
  })

  it('raises a limit only through an approved request, leaving the ledger alone', async () => {
    const customerId = await createCustomerRow('RequestFlow')
    await setLimit(customerId, 5_000)
    await post({ customerId, kind: 'CHARGE', amountMinor: 2_000, reasonCode: 'OPENING_BALANCE' })
    const profile = await requireProfile(customerId)
    const entriesBefore = await entryCount(customerId)

    const request = await requestCreditLimitIncrease(managerUser, actor, customerId, {
      proposedLimitMinor: 8_000,
      reason: 'Hotel orders every week',
    })
    expect(request.status).toBe('PENDING')

    const [pending] = await limitApprovals(profile.id)
    expect(pending?.id).toBe(request.approvalId)
    expect(pending?.status).toBe('PENDING')
    expect(pending?.entityId).toBe(profile.id)
    expect(pending?.amountMinor).toBe(8_000)
    expect(pending?.requestNote).toBe('Hotel orders every week')
    expect(pending?.deciderRole).toBe('ADMIN')
    expect(pending?.deciderBranchId).toBeNull()
    expect(pending?.payload).toMatchObject({
      customerId,
      branchId: branchAId,
      currentLimitMinor: 5_000,
      proposedLimitMinor: 8_000,
      balanceMinor: 2_000,
    })

    // The request is a request: nothing about the entitlement moved yet.
    expect((await requireProfile(customerId)).limitMinor).toBe(5_000)

    await decideApproval(adminUser, adminActor, request.approvalId, { decision: 'APPROVED' })

    const approved = await requireProfile(customerId)
    expect(approved.limitMinor).toBe(8_000)
    expect(approved.balanceMinor).toBe(2_000)
    // A limit is an entitlement, not money owed: no entry, no sum change.
    expect(await entryCount(customerId)).toBe(entriesBefore)
    expect(await sumForCustomerBranch(customerId, branchAId)).toBe(2_000)
    expect((await limitAuditVias(profile.id)).filter((via) => via === 'approval')).toHaveLength(1)

    const again = await captureError(() =>
      decideApproval(adminUser, adminActor, request.approvalId, { decision: 'APPROVED' }),
    )
    expect(again).toBeInstanceOf(AppError)
    if (!(again instanceof AppError)) throw new Error('expected AppError')
    expect(again.statusCode).toBe(409)
    expect((await requireProfile(customerId)).limitMinor).toBe(8_000)
  })

  it('refuses a stale approval and leaves the request pending', async () => {
    const customerId = await createCustomerRow('Stale')
    await setLimit(customerId, 5_000)
    const profile = await requireProfile(customerId)

    const request = await requestCreditLimitIncrease(managerUser, actor, customerId, {
      proposedLimitMinor: 8_000,
      reason: 'Season demand',
    })

    // Another admin moves the limit while the request waits: applying the
    // proposal now would overwrite a value nobody approved (P12-D22).
    await updateProfile(actor, adminUser, customerId, { branchId: branchAId, limitMinor: 6_000 })

    const stale = await captureError(() =>
      decideApproval(adminUser, adminActor, request.approvalId, { decision: 'APPROVED' }),
    )
    expect(stale).toBeInstanceOf(ConflictError)

    expect((await requireProfile(customerId)).limitMinor).toBe(6_000)
    const [row] = await limitApprovals(profile.id)
    expect(row?.status).toBe('PENDING')
  })

  it('rejects a limit request without touching the limit', async () => {
    const customerId = await createCustomerRow('RejectLimit')
    await setLimit(customerId, 5_000)
    const profile = await requireProfile(customerId)

    const request = await requestCreditLimitIncrease(managerUser, actor, customerId, {
      proposedLimitMinor: 9_000,
      reason: 'Asks for more every month',
    })
    await decideApproval(adminUser, adminActor, request.approvalId, {
      decision: 'REJECTED',
      reasonCode: 'OUT_OF_POLICY',
    })

    expect((await requireProfile(customerId)).limitMinor).toBe(5_000)
    const [row] = await limitApprovals(profile.id)
    expect(row?.status).toBe('REJECTED')
  })

  it('refuses a decrease, a no-op and an admin request with a 400', async () => {
    const customerId = await createCustomerRow('RequestGuards')
    await setLimit(customerId, 5_000)
    const profile = await requireProfile(customerId)

    const decrease = await captureError(() =>
      requestCreditLimitIncrease(managerUser, actor, customerId, {
        proposedLimitMinor: 4_000,
        reason: 'Too much exposure',
      }),
    )
    expect(decrease).toBeInstanceOf(ValidationError)

    const unchanged = await captureError(() =>
      requestCreditLimitIncrease(managerUser, actor, customerId, {
        proposedLimitMinor: 5_000,
        reason: 'Same limit again',
      }),
    )
    expect(unchanged).toBeInstanceOf(ValidationError)

    // P12-D3: an admin never raises a request for work an admin can do directly.
    const admin = await captureError(() =>
      requestCreditLimitIncrease(adminUser, actor, customerId, {
        proposedLimitMinor: 9_000,
        reason: 'Admin direct path',
      }),
    )
    expect(admin).toBeInstanceOf(ValidationError)
    if (!(admin instanceof ValidationError)) throw new Error('expected ValidationError')
    expect(admin.message).toContain('directly')

    expect((await requireProfile(customerId)).limitMinor).toBe(5_000)
    expect(await limitApprovals(profile.id)).toHaveLength(0)
  })

  it('allows one pending limit request per profile, not one per customer', async () => {
    const customerId = await createCustomerRow('Pending')
    await setLimit(customerId, 5_000)
    const profileA = await requireProfile(customerId)

    const first = await requestCreditLimitIncrease(managerUser, actor, customerId, {
      proposedLimitMinor: 8_000,
      reason: 'First ask',
    })

    const second = await captureError(() =>
      requestCreditLimitIncrease(managerUser, actor, customerId, {
        proposedLimitMinor: 9_000,
        reason: 'Second ask',
      }),
    )
    expect(second).toBeInstanceOf(ConflictError)

    // The same customer's limit at another branch is a different profile, so it is
    // a different decision: branch A's pending request does not block branch C.
    const elsewhere = await requestCreditLimitIncrease(managerCUser, actor, customerId, {
      proposedLimitMinor: 7_000,
      reason: 'The Takoradi branch asks too',
    })
    expect(elsewhere.approvalId).not.toBe(first.approvalId)

    const profileC = await requireProfile(customerId, branchCId)
    expect(profileC.id).not.toBe(profileA.id)
    // Created at limit 0 before the request was valued.
    expect(profileC.limitMinor).toBe(0)
    const [rowC] = await limitApprovals(profileC.id)
    expect(rowC?.payload).toMatchObject({ currentLimitMinor: 0, proposedLimitMinor: 7_000 })

    expect(await limitApprovals(profileA.id)).toHaveLength(1)
  })

  it('lists over-limit customers with the analytics predicate and branch scoping', async () => {
    const overId = await createCustomerRow('Over')
    const biggerId = await createCustomerRow('Over Bigger')
    const atLimitId = await createCustomerRow('At Limit')
    const zeroLimitId = await createCustomerRow('Zero Limit')

    // Over by 5 000. An over-limit profile is created by a charge a manager
    // overrode — the state a POS offline sale leaves — not by a charge the
    // service would refuse.
    await setLimit(biggerId, 10_000, branchDId)
    await postEntry(actor, adminUser, {
      customerId: biggerId,
      branchId: branchDId,
      kind: 'CHARGE',
      amountMinor: 15_000,
      reasonCode: 'OPENING_BALANCE',
      override: { reasonCode: 'TRUSTED_CUSTOMER' },
    })
    // Over by 2 500.
    await setLimit(overId, 5_000, branchDId)
    await postEntry(actor, adminUser, {
      customerId: overId,
      branchId: branchDId,
      kind: 'CHARGE',
      amountMinor: 7_500,
      reasonCode: 'SALE',
      override: { reasonCode: 'TRUSTED_CUSTOMER' },
    })
    // Exactly at the limit: inside it, never listed.
    await setLimit(atLimitId, 5_000, branchDId)
    await postEntry(actor, adminUser, {
      customerId: atLimitId,
      branchId: branchDId,
      kind: 'CHARGE',
      amountMinor: 5_000,
      reasonCode: 'SALE',
    })
    // No entitlement, but a debt: `limit_minor > 0` keeps it out of the list. A
    // correction posts the debt because the limit check covers charges only.
    await postEntry(actor, adminUser, {
      customerId: zeroLimitId,
      branchId: branchDId,
      kind: 'ADJUSTMENT',
      amountMinor: 300,
      reasonCode: 'CORRECTION',
    })

    const list = await listOverLimit(adminUser, { branchId: branchDId, limit: 50, offset: 0 })
    expect(list.branchId).toBe(branchDId)
    expect(list.total).toBe(2)
    // Biggest exposure first.
    expect(list.customers.map((row) => row.customerId)).toEqual([biggerId, overId])
    expect(list.customers[0]?.overByMinor).toBe(5_000)
    expect(list.customers[1]?.overByMinor).toBe(2_500)
    expect(list.customers[1]?.balanceMinor).toBe(7_500)
    expect(list.customers[1]?.limitMinor).toBe(5_000)
    expect(list.customers[1]?.phone).toBeNull()
    expect(list.customers.map((row) => row.customerId)).not.toContain(atLimitId)
    expect(list.customers.map((row) => row.customerId)).not.toContain(zeroLimitId)

    // The definition cannot drift from the dashboard tile (P12-D23).
    const attention = await selectAttention(db, branchDId)
    expect(attention.overLimitCreditCount).toBe(list.total)

    // A scoped manager's own list agrees too, and a foreign branch is a 403.
    const ownBranch = await listOverLimit(managerCUser, { limit: 50, offset: 0 })
    expect(ownBranch.branchId).toBe(branchCId)
    expect(ownBranch.total).toBe((await selectAttention(db, branchCId)).overLimitCreditCount)

    const foreign = await captureError(() =>
      listOverLimit(managerCUser, { branchId: branchDId, limit: 50, offset: 0 }),
    )
    expect(foreign).toBeInstanceOf(ForbiddenError)

    // Pagination keeps `total` whole while the page is bounded.
    const page = await listOverLimit(adminUser, { branchId: branchDId, limit: 1, offset: 1 })
    expect(page.total).toBe(2)
    expect(page.customers.map((row) => row.customerId)).toEqual([overId])
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
    // `approval.branch_id` restricts the branch delete below.
    const ownedBranches = [branchAId, branchBId].filter((id) => id !== '')
    if (ownedBranches.length > 0) {
      await db.delete(approval).where(inArray(approval.branchId, ownedBranches))
    }
    for (const id of ownedBranches) {
      await db.delete(branch).where(eq(branch.id, id))
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

    // A limit increase is a decision about money: no cashier reaches the request.
    const limitRequest = await app.request(
      `/api/credit/profiles/${crypto.randomUUID()}/limit-requests`,
      {
        method: 'POST',
        headers: authedHeaders(cashierCookie),
        body: JSON.stringify({ proposedLimitMinor: 9_000, reason: 'Cashier should not ask' }),
      },
    )
    expect(limitRequest.status).toBe(403)

    const overLimit = await app.request('/api/credit/over-limit', {
      headers: authedHeaders(cashierCookie),
    })
    expect(overLimit.status).toBe(403)
  })

  it('lets a manager manage a profile, charge, and collect at their branch', async () => {
    const customerId = await createCustomerRow('HTTP Flow')

    // The limit is raised by an admin: since P12-D21 a manager's increase is a
    // `CREDIT_LIMIT_CHANGE` request, asserted in its own test below.
    const putLimit = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        limitMinor: 40_000,
        paymentTermDays: 14,
        hold: false,
        notes: 'HTTP test',
      }),
    })
    expect(putLimit.status).toBe(200)
    const profile = (
      await readJson<{
        profile: { id: string; limitMinor: number; paymentTermDays: number; notes: string | null }
      }>(putLimit)
    ).profile
    expect(profile.limitMinor).toBe(40_000)
    expect(profile.paymentTermDays).toBe(14)
    expect(profile.notes).toBe('HTTP test')

    // A manager may still lower it, and that is audited as a direct decrease.
    const putDecrease = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ limitMinor: 38_000 }),
    })
    expect(putDecrease.status).toBe(200)
    expect(
      (await readJson<{ profile: { limitMinor: number } }>(putDecrease)).profile.limitMinor,
    ).toBe(38_000)

    const profileAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'credit.profile_updated'), eq(auditLog.entityId, profile.id)))
    expect(profileAudits).toHaveLength(2)

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
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, limitMinor: 1_000 }),
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

  it('serves scoped aging and a reconciling statement over HTTP', async () => {
    const customerId = await createCustomerRow('HTTP Report')
    await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, limitMinor: 20_000, paymentTermDays: 0 }),
    })
    await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 8_000, reasonCode: 'SALE' }),
    })
    await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, amountMinor: 3_000, method: 'CASH' }),
    })

    const aging = await app.request('/api/credit/aging', {
      headers: authedHeaders(managerCookie),
    })
    expect(aging.status).toBe(200)
    const agingBody = await readJson<{
      asOf: string
      branches: {
        branch: { id: string }
        customers: { customerId: string; totalMinor: number }[]
        totals: { total: number }
      }[]
    }>(aging)
    expect(agingBody.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(agingBody.branches).toHaveLength(1)
    expect(agingBody.branches[0]?.branch.id).toBe(branchAId)
    expect(
      agingBody.branches[0]?.customers.find((row) => row.customerId === customerId)?.totalMinor,
    ).toBe(5_000)

    const crossAging = await app.request(`/api/credit/aging?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(crossAging.status).toBe(403)

    const adminAging = await app.request('/api/credit/aging', {
      headers: authedHeaders(adminCookie),
    })
    expect(adminAging.status).toBe(200)
    const adminBody = await readJson<{
      branches: { branch: { id: string }; totals: { total: number } }[]
    }>(adminAging)
    const adminBranchIds = adminBody.branches.map((entry) => entry.branch.id)
    expect(adminBranchIds).toContain(branchAId)
    expect(adminBranchIds).toContain(branchBId)

    const statement = await app.request(`/api/credit/statements/${customerId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(statement.status).toBe(200)
    const statementBody = await readJson<{
      customer: { id: string }
      openingBalanceMinor: number
      closingBalanceMinor: number
      currentBalanceMinor: number
      entries: unknown[]
    }>(statement)
    expect(statementBody.customer.id).toBe(customerId)
    expect(statementBody.openingBalanceMinor).toBe(0)
    expect(statementBody.entries).toHaveLength(2)
    expect(statementBody.closingBalanceMinor).toBe(5_000)
    expect(statementBody.closingBalanceMinor).toBe(statementBody.currentBalanceMinor)

    const noProfileId = await createCustomerRow('HTTP No Profile')
    const missing = await app.request(`/api/credit/statements/${noProfileId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(missing.status).toBe(404)
  })

  it('filters entry lists by kind over HTTP', async () => {
    const customerId = await createCustomerRow('HTTP Kind Filter')
    await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, limitMinor: 20_000, paymentTermDays: 0 }),
    })
    await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 5_000, reasonCode: 'SALE' }),
    })
    await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 2_000, reasonCode: 'OTHER' }),
    })
    await app.request('/api/credit/repayments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, amountMinor: 1_000, method: 'CASH' }),
    })

    const repayments = await app.request(
      `/api/credit/entries?customerId=${customerId}&kind=REPAYMENT`,
      {
        headers: authedHeaders(managerCookie),
      },
    )
    expect(repayments.status).toBe(200)
    const repaymentBody = await readJson<{
      entries: { kind: string }[]
      total: number
      page: number
      pageSize: number
    }>(repayments)
    expect(repaymentBody.total).toBe(1)
    expect(repaymentBody.entries.map((entry) => entry.kind)).toEqual(['REPAYMENT'])

    const charges = await app.request(`/api/credit/entries?customerId=${customerId}&kind=CHARGE`, {
      headers: authedHeaders(managerCookie),
    })
    const chargeBody = await readJson<{ total: number }>(charges)
    expect(chargeBody.total).toBe(2)

    const bogus = await app.request(`/api/credit/entries?customerId=${customerId}&kind=BOGUS`, {
      headers: authedHeaders(managerCookie),
    })
    expect(bogus.status).toBe(400)
  })

  it('accepts a raise as a request and refuses the direct path, a decrease and an admin', async () => {
    const customerId = await createCustomerRow('HTTP Request')
    await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, limitMinor: 5_000 }),
    })

    // A manager raising the limit directly is refused at the route's service, not
    // hidden in the console (OWASP A01).
    const direct = await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ limitMinor: 6_000 }),
    })
    expect(direct.status).toBe(403)

    const request = await app.request(`/api/credit/profiles/${customerId}/limit-requests`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ proposedLimitMinor: 8_000, reason: 'New contract with the hotel' }),
    })
    expect(request.status).toBe(201)
    const requestBody = await readJson<{ approvalId: string; status: string }>(request)
    expect(requestBody.status).toBe('PENDING')
    expect(requestBody.approvalId).toMatch(/^[0-9a-f-]{36}$/)

    const stillLimit = await app.request(`/api/credit/profiles?customerId=${customerId}`, {
      headers: authedHeaders(managerCookie),
    })
    const profiles = await readJson<{ profiles: { limitMinor: number }[] }>(stillLimit)
    expect(profiles.profiles[0]?.limitMinor).toBe(5_000)

    const noReason = await app.request(`/api/credit/profiles/${customerId}/limit-requests`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ proposedLimitMinor: 9_000 }),
    })
    expect(noReason.status).toBe(400)

    // `.strict()`: a smuggled branchId is a 400, not a silently ignored field.
    const smuggled = await app.request(`/api/credit/profiles/${customerId}/limit-requests`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchBId,
        proposedLimitMinor: 9_000,
        reason: 'Try another branch',
      }),
    })
    expect(smuggled.status).toBe(400)

    const decrease = await app.request(`/api/credit/profiles/${customerId}/limit-requests`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ proposedLimitMinor: 4_000, reason: 'Lower it' }),
    })
    expect(decrease.status).toBe(400)

    const asAdmin = await app.request(`/api/credit/profiles/${customerId}/limit-requests`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ proposedLimitMinor: 12_000, reason: 'Admin asks' }),
    })
    expect(asAdmin.status).toBe(400)
  })

  it('serves the over-limit list to the branch and refuses a foreign branch', async () => {
    const customerId = await createCustomerRow('HTTP Over Limit')
    await app.request(`/api/credit/profiles/${customerId}`, {
      method: 'PUT',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, limitMinor: 1_000 }),
    })
    const over = await app.request('/api/credit/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        customerId,
        kind: 'CHARGE',
        amountMinor: 1_500,
        reasonCode: 'SALE',
        override: { reasonCode: 'TRUSTED_CUSTOMER' },
      }),
    })
    expect(over.status).toBe(201)

    const list = await app.request('/api/credit/over-limit', {
      headers: authedHeaders(managerCookie),
    })
    expect(list.status).toBe(200)
    const body = await readJson<{
      customers: {
        customerId: string
        branchId: string
        limitMinor: number
        balanceMinor: number
        overByMinor: number
      }[]
      total: number
      branchId: string | null
    }>(list)
    expect(body.branchId).toBe(branchAId)
    expect(body.total).toBeGreaterThanOrEqual(1)
    const row = body.customers.find((entry) => entry.customerId === customerId)
    expect(row?.branchId).toBe(branchAId)
    expect(row?.limitMinor).toBe(1_000)
    expect(row?.balanceMinor).toBe(1_500)
    expect(row?.overByMinor).toBe(500)
    // Biggest exposure first.
    const excess = body.customers.map((entry) => entry.overByMinor)
    expect([...excess].sort((a, b) => b - a)).toEqual(excess)

    const foreign = await app.request(`/api/credit/over-limit?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(foreign.status).toBe(403)

    const adminAll = await app.request('/api/credit/over-limit', {
      headers: authedHeaders(adminCookie),
    })
    expect(adminAll.status).toBe(200)
    expect((await readJson<{ branchId: string | null }>(adminAll)).branchId).toBeNull()
  })
})
