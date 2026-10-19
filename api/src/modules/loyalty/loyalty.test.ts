import { db } from '@gikautos/db'
import { eq, inArray } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { env } from '../../config/env.ts'
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import { LOYALTY_EXPIRY_QUEUE, registerJobHandlers } from '../../jobs/queues.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { findAccountByCustomerId, listLots, sumEntriesForAccount } from './loyalty.repository.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from './loyalty.schema.ts'
import {
  earnPointsForSale,
  expireDueLots,
  postEntry,
  quoteRedeem,
  reconcileAccounts,
} from './loyalty.service.ts'
import type {
  ExpiryRunResult,
  LoyaltyLiabilityReport,
  LoyaltyPostEntryInput,
} from './loyalty.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[loyalty.test] database unavailable; integration tests skipped')

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

describe.skipIf(!available)('loyalty service', () => {
  const suffix = uniqueSuffix()
  const branchIds: string[] = []
  const customerIds: string[] = []
  let branchAId = ''
  let branchBId = ''

  const actorIds: string[] = []

  function makeActor(label: string): AuditActor & { actorId: string } {
    const id = `loyalty-actor-${suffix}-${label}`
    actorIds.push(id)
    return {
      actorId: id,
      actorStaffId: `GA-LOYALTY-${suffix}`,
      ip: null,
      userAgent: null,
      requestId: null,
    }
  }

  const actor = makeActor('main')

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
    input: Partial<LoyaltyPostEntryInput> & Pick<LoyaltyPostEntryInput, 'customerId' | 'kind'>,
  ) {
    return postEntry(actor, { branchId: branchAId, ...input })
  }

  async function entryCount(customerId: string): Promise<number> {
    const rows = await db
      .select({ id: loyaltyLedgerEntry.id })
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.customerId, customerId))
    return rows.length
  }

  async function accountBalance(customerId: string): Promise<number | null> {
    const account = await findAccountByCustomerId(customerId)
    return account?.balancePoints ?? null
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        { code: `LOY-${suffix}-A`, name: `Loyalty A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `LOY-${suffix}-B`, name: `Loyalty B ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''
    branchIds.push(branchAId, branchBId)
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.actorId, actorIds))
    for (const customerId of customerIds) {
      const account = await findAccountByCustomerId(customerId)
      if (account) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(eq(loyaltyLot.accountId, account.id))
        const lotIds = lots.map((lot) => lot.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
        }
        await db.delete(loyaltyLot).where(eq(loyaltyLot.accountId, account.id))
        await db.delete(loyaltyLedgerEntry).where(eq(loyaltyLedgerEntry.accountId, account.id))
        await db.delete(loyaltyAccount).where(eq(loyaltyAccount.id, account.id))
      }
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds))
    }
    if (branchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, branchIds))
    }
  })

  it('floors earn points per sale and creates a lot with a 12-month expiry', async () => {
    const customerId = await createCustomerRow('Earn')
    const occurredAt = new Date('2026-03-15T10:00:00Z')

    // GHS 10.75 at 1 point per cedi (default) → 10 points, floored.
    expect(await earnPointsForSale(1075)).toBe(10)
    const result = await post({ customerId, kind: 'EARN', netPaidMinor: 1075, occurredAt })

    expect(result.entry?.kind).toBe('EARN')
    expect(result.entry?.pointsDelta).toBe(10)
    expect(result.entry?.branchId).toBe(branchAId)
    expect(result.account.balancePoints).toBe(10)
    expect(result.lot?.points).toBe(10)
    expect(result.lot?.remainingPoints).toBe(10)
    expect(result.lot?.expiresAt.toISOString()).toBe('2027-03-15T10:00:00.000Z')

    // Floor per sale, no carry: a sale below one point writes nothing.
    const tiny = await post({ customerId, kind: 'EARN', netPaidMinor: 99, occurredAt })
    expect(tiny.entry).toBeNull()
    expect(tiny.account.balancePoints).toBe(10)
    expect(await entryCount(customerId)).toBe(1)

    // 250 points at 100 points per cedi → GHS 2.50 = 250 pesewas.
    expect(await quoteRedeem(250)).toEqual({ points: 250, discountMinor: 250 })
  })

  it('rejects redemptions below the minimum and above the balance', async () => {
    const customerId = await createCustomerRow('RedeemGuards')

    // 50 points available, below the 100-point minimum.
    await post({ customerId, kind: 'EARN', netPaidMinor: 5_000 })
    const below = await captureError(() => post({ customerId, kind: 'REDEEM', pointsDelta: -50 }))
    expect(below).toBeInstanceOf(ConflictError)
    if (!(below instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(below.message).toContain('at least 100 points')

    // 150 points available, redeeming 151 exceeds the balance.
    await post({ customerId, kind: 'EARN', netPaidMinor: 10_000 })
    const above = await captureError(() => post({ customerId, kind: 'REDEEM', pointsDelta: -151 }))
    expect(above).toBeInstanceOf(ConflictError)
    if (!(above instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(above.message).toContain('enough points')

    // Nothing was written by the rejections, and a valid redemption works.
    expect(await accountBalance(customerId)).toBe(150)
    const redeem = await post({ customerId, kind: 'REDEEM', pointsDelta: -100 })
    expect(redeem.account.balancePoints).toBe(50)
    expect(redeem.quote).toEqual({ points: 100, discountMinor: 100 })
    expect(await entryCount(customerId)).toBe(3)
  })

  it('consumes the earliest-expiry lot first and writes per-lot consumption rows', async () => {
    const customerId = await createCustomerRow('Fefo')
    const january = await post({
      customerId,
      kind: 'EARN',
      netPaidMinor: 30_000,
      occurredAt: new Date('2026-01-10T10:00:00Z'),
    })
    const february = await post({
      customerId,
      kind: 'EARN',
      netPaidMinor: 20_000,
      occurredAt: new Date('2026-02-10T10:00:00Z'),
    })
    const januaryLot = january.lot
    const februaryLot = february.lot
    if (!januaryLot || !februaryLot) throw new Error('lots were not created')

    const redeem = await post({ customerId, kind: 'REDEEM', pointsDelta: -400 })
    expect(redeem.entry?.pointsDelta).toBe(-400)
    expect(redeem.account.balancePoints).toBe(100)
    expect(redeem.quote?.discountMinor).toBe(400)

    // FEFO: 300 from the January lot (expiring sooner), 100 from February.
    expect(redeem.consumption.map((row) => [row.lotId, row.points])).toEqual([
      [januaryLot.id, 300],
      [februaryLot.id, 100],
    ])
    const lots = await listLots(january.account.id)
    expect(lots.map((lot) => [lot.id, lot.remainingPoints])).toEqual([
      [januaryLot.id, 0],
      [februaryLot.id, 100],
    ])
  })

  it('claws back proportionally, allowing a shortfall that leaves a negative balance', async () => {
    const customerId = await createCustomerRow('Clawback')
    await post({ customerId, kind: 'EARN', netPaidMinor: 12_000 })

    const clawback = await post({ customerId, kind: 'CLAWBACK', pointsDelta: -200 })
    expect(clawback.entry?.kind).toBe('CLAWBACK')
    expect(clawback.entry?.reasonCode).toBe('RETURN')
    expect(clawback.entry?.pointsDelta).toBe(-200)
    // Only 120 points were available: the lots are clamped at zero and the
    // residual leaves the balance negative for review.
    expect(clawback.consumption).toHaveLength(1)
    expect(clawback.consumption[0]?.points).toBe(120)
    expect(clawback.account.balancePoints).toBe(-80)
    expect(await accountBalance(customerId)).toBe(-80)

    const lots = await listLots(clawback.account.id)
    expect(lots.map((lot) => lot.remainingPoints)).toEqual([0])
    // The ledger always explains the balance, even when negative.
    expect(await sumEntriesForAccount(clawback.account.id)).toBe(-80)
  })

  it('enforces adjustment reasons and sign rules', async () => {
    const customerId = await createCustomerRow('Adjust')

    const noReason = await captureError(() => post({ customerId, kind: 'ADJUST', pointsDelta: 50 }))
    expect(noReason).toBeInstanceOf(ValidationError)

    const badReason = await captureError(() =>
      post({ customerId, kind: 'ADJUST', pointsDelta: 50, reasonCode: 'RETURN' }),
    )
    expect(badReason).toBeInstanceOf(ValidationError)

    const zero = await captureError(() =>
      post({ customerId, kind: 'ADJUST', pointsDelta: 0, reasonCode: 'CORRECTION' }),
    )
    expect(zero).toBeInstanceOf(ValidationError)

    const earnWithPoints = await captureError(() =>
      post({ customerId, kind: 'EARN', netPaidMinor: 1_000, pointsDelta: 5 }),
    )
    expect(earnWithPoints).toBeInstanceOf(ValidationError)

    const earnWithoutAmount = await captureError(() => post({ customerId, kind: 'EARN' }))
    expect(earnWithoutAmount).toBeInstanceOf(ValidationError)

    // A positive adjustment creates a lot so expiry stays total.
    const goodwill = await post({
      customerId,
      kind: 'ADJUST',
      pointsDelta: 75,
      reasonCode: 'GOODWILL',
    })
    expect(goodwill.entry?.reasonCode).toBe('GOODWILL')
    expect(goodwill.lot?.points).toBe(75)
    expect(goodwill.account.balancePoints).toBe(75)

    const correction = await post({
      customerId,
      kind: 'ADJUST',
      pointsDelta: -25,
      reasonCode: 'CORRECTION',
    })
    expect(correction.consumption).toHaveLength(1)
    expect(correction.account.balancePoints).toBe(50)
  })

  it('replays idempotent postings without a second row, scoped per branch', async () => {
    const customerId = await createCustomerRow('Idempotent')
    const input = {
      customerId,
      kind: 'EARN',
      netPaidMinor: 2_500,
      idempotencyKey: `loyalty-idem-${suffix}`,
    } as const

    const first = await post({ ...input })
    const replay = await post({ ...input })
    expect(replay.entry?.id).toBe(first.entry?.id)
    expect(await entryCount(customerId)).toBe(1)
    expect(await accountBalance(customerId)).toBe(25)

    // The same key at another branch is a different posting.
    const branchB = await postEntry(actor, { ...input, branchId: branchBId })
    expect(branchB.entry?.id).not.toBe(first.entry?.id)
    expect(branchB.account.balancePoints).toBe(50)
    expect(branchB.entry?.branchId).toBe(branchBId)
  })

  it('serializes a simultaneous replay of the same idempotency key', async () => {
    const customerId = await createCustomerRow('Race')
    const input = {
      customerId,
      kind: 'EARN',
      netPaidMinor: 1_500,
      idempotencyKey: `loyalty-race-${suffix}`,
    } as const

    const [first, second] = await Promise.all([post({ ...input }), post({ ...input })])
    expect(first.entry?.id).toBe(second.entry?.id)
    expect(await entryCount(customerId)).toBe(1)
    expect(await accountBalance(customerId)).toBe(15)
  })

  it('reconciles the balance to the ledger and live lot remainders', async () => {
    const customerId = await createCustomerRow('Reconcile')
    const reconcileActor = makeActor('reconcile')
    const run = (
      input: Partial<LoyaltyPostEntryInput> & Pick<LoyaltyPostEntryInput, 'customerId' | 'kind'>,
    ) => postEntry(reconcileActor, { branchId: branchAId, ...input })

    await run({ customerId, kind: 'EARN', netPaidMinor: 50_000 })
    await run({
      customerId,
      kind: 'EARN',
      netPaidMinor: 30_000,
      occurredAt: new Date('2026-05-01T10:00:00Z'),
    })
    await run({ customerId, kind: 'REDEEM', pointsDelta: -350 })
    await run({ customerId, kind: 'ADJUST', pointsDelta: 25, reasonCode: 'GOODWILL' })

    const account = await findAccountByCustomerId(customerId)
    if (!account) throw new Error('account was not created')
    expect(account.balancePoints).toBe(475)
    expect(await sumEntriesForAccount(account.id)).toBe(account.balancePoints)

    // In normal (non-shortfall) cases the live lot remainders equal the balance.
    const lots = await listLots(account.id)
    expect(lots.reduce((sum, lot) => sum + lot.remainingPoints, 0)).toBe(475)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.actorId, reconcileActor.actorId))
    const actions = audits.map((row) => row.action)
    expect(actions.filter((action) => action === 'loyalty.earned')).toHaveLength(2)
    expect(actions).toContain('loyalty.redeemed')
    expect(actions).toContain('loyalty.adjusted')
  })

  it('expires due lots once and no-ops afterwards', async () => {
    const customerId = await createCustomerRow('Expiry')
    const january = await post({
      customerId,
      kind: 'EARN',
      netPaidMinor: 15_000,
      occurredAt: new Date('2025-01-05T10:00:00Z'),
    })
    const august = await post({
      customerId,
      kind: 'EARN',
      netPaidMinor: 5_000,
      occurredAt: new Date('2025-08-20T10:00:00Z'),
    })
    const januaryLot = january.lot
    const augustLot = august.lot
    if (!januaryLot || !augustLot) throw new Error('lots were not created')

    // Spend most of the January lot; 30 points remain when it expires.
    await post({
      customerId,
      kind: 'REDEEM',
      pointsDelta: -120,
      occurredAt: new Date('2025-09-01T10:00:00Z'),
    })

    const now = new Date('2026-02-01T00:00:00Z')
    const first = await expireDueLots(now)
    expect(first).toEqual({ accounts: 1, lots: 1, points: 30 })

    const account = await findAccountByCustomerId(customerId)
    if (!account) throw new Error('account was not created')
    expect(account.balancePoints).toBe(50)

    const entries = await db
      .select()
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.accountId, account.id))
    const expireEntry = entries.find((entry) => entry.kind === 'EXPIRE')
    expect(expireEntry?.pointsDelta).toBe(-30)
    expect(expireEntry?.reasonCode).toBe('EXPIRY')
    expect(expireEntry?.branchId).toBeNull()
    expect(expireEntry?.createdBy).toBeNull()
    if (!expireEntry) throw new Error('expiry entry was not written')

    const consumptions = await db
      .select()
      .from(loyaltyLotConsumption)
      .where(eq(loyaltyLotConsumption.entryId, expireEntry.id))
    expect(consumptions.map((row) => [row.lotId, row.points])).toEqual([[januaryLot.id, 30]])

    const lots = await listLots(account.id)
    expect(lots.find((lot) => lot.id === januaryLot.id)?.remainingPoints).toBe(0)
    expect(lots.find((lot) => lot.id === augustLot.id)?.remainingPoints).toBe(50)
    expect(await sumEntriesForAccount(account.id)).toBe(50)

    // A second run finds nothing due.
    const second = await expireDueLots(now)
    expect(second).toEqual({ accounts: 0, lots: 0, points: 0 })
  })

  it('blocks anonymized customers and reports unknown ones', async () => {
    const customerId = await createCustomerRow('Anonymized')
    await db
      .update(customer)
      .set({ anonymizedAt: new Date(), name: 'Anonymized customer' })
      .where(eq(customer.id, customerId))

    const blocked = await captureError(() =>
      post({ customerId, kind: 'EARN', netPaidMinor: 1_000 }),
    )
    expect(blocked).toBeInstanceOf(ConflictError)
    expect(await entryCount(customerId)).toBe(0)

    const unknown = await captureError(() =>
      post({ customerId: crypto.randomUUID(), kind: 'EARN', netPaidMinor: 1_000 }),
    )
    expect(unknown).toBeInstanceOf(NotFoundError)
  })

  it('journeys earn → redeem → clawback → adjust → expire with reconciliation', async () => {
    const customerId = await createCustomerRow('Journey')
    const journeyActor = makeActor('journey')
    const run = (
      input: Partial<LoyaltyPostEntryInput> & Pick<LoyaltyPostEntryInput, 'customerId' | 'kind'>,
    ) => postEntry(journeyActor, { branchId: branchAId, ...input })

    // Two earns, two lots with different expiries.
    const earn1 = await run({
      customerId,
      kind: 'EARN',
      netPaidMinor: 20_000,
      occurredAt: new Date('2026-06-01T10:00:00Z'),
    })
    const earn2 = await run({
      customerId,
      kind: 'EARN',
      netPaidMinor: 15_000,
      occurredAt: new Date('2026-07-15T10:00:00Z'),
    })
    const lot1 = earn1.lot
    const lot2 = earn2.lot
    if (!lot1 || !lot2) throw new Error('lots were not created')
    const accountId = earn1.account.id
    expect(earn2.account.balancePoints).toBe(350)

    // Redeem 250 FEFO: 200 from the June lot, 50 from the July lot.
    const redeem = await run({
      customerId,
      kind: 'REDEEM',
      pointsDelta: -250,
      occurredAt: new Date('2026-08-01T10:00:00Z'),
    })
    expect(redeem.account.balancePoints).toBe(100)
    expect(redeem.consumption.map((row) => [row.lotId, row.points])).toEqual([
      [lot1.id, 200],
      [lot2.id, 50],
    ])

    // Clawback 180 against 100 available: the shortfall leaves -80 on the balance.
    const clawback = await run({
      customerId,
      kind: 'CLAWBACK',
      pointsDelta: -180,
      occurredAt: new Date('2026-09-10T10:00:00Z'),
    })
    expect(clawback.account.balancePoints).toBe(-80)
    expect(clawback.consumption.map((row) => [row.lotId, row.points])).toEqual([[lot2.id, 100]])

    // A negative balance still reconciles exactly.
    expect(await sumEntriesForAccount(accountId)).toBe(-80)
    const midDivergences = await reconcileAccounts()
    expect(midDivergences.filter((row) => row.customerId === customerId)).toEqual([])

    // A positive adjustment creates a fresh lot.
    const adjust = await run({
      customerId,
      kind: 'ADJUST',
      pointsDelta: 50,
      reasonCode: 'GOODWILL',
      occurredAt: new Date('2026-10-05T10:00:00Z'),
    })
    const lot3 = adjust.lot
    if (!lot3) throw new Error('adjustment lot was not created')
    expect(adjust.account.balancePoints).toBe(-30)
    expect(lot3.remainingPoints).toBe(50)

    // The adjustment lot (2027-10) expires; the balance stays negative.
    const expiry = await expireDueLots(new Date('2027-11-01T00:00:00Z'))
    expect(expiry.points).toBeGreaterThanOrEqual(50)

    const entries = await db
      .select()
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.accountId, accountId))
    const expireEntry = entries.find((entry) => entry.kind === 'EXPIRE')
    if (!expireEntry) throw new Error('expiry entry was not written')
    expect(expireEntry.pointsDelta).toBe(-50)
    expect(expireEntry.reasonCode).toBe('EXPIRY')

    const expireConsumption = await db
      .select()
      .from(loyaltyLotConsumption)
      .where(eq(loyaltyLotConsumption.entryId, expireEntry.id))
    expect(expireConsumption.map((row) => [row.lotId, row.points])).toEqual([[lot3.id, 50]])

    const finalAccount = await findAccountByCustomerId(customerId)
    if (!finalAccount) throw new Error('account was not created')
    expect(finalAccount.balancePoints).toBe(-80)
    expect(await sumEntriesForAccount(accountId)).toBe(-80)
    const lots = await listLots(accountId)
    expect(lots.map((lot) => [lot.id, lot.remainingPoints])).toEqual([
      [lot1.id, 0],
      [lot2.id, 0],
      [lot3.id, 0],
    ])

    // Every account this suite touched reconciles: balance = ledger sum,
    // lots = positive backing - consumption.
    const divergences = await reconcileAccounts()
    expect(divergences.filter((row) => customerIds.includes(row.customerId))).toEqual([])
  })
})

describe.skipIf(!available)('loyalty HTTP', () => {
  const suffix = uniqueSuffix()
  const createdUserIds: string[] = []
  const createdCustomerIds: string[] = []
  let branchAId = ''
  let branchBId = ''
  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''

  async function createCustomerRow(name: string, createdBranchId: string): Promise<string> {
    const rows = await db
      .insert(customer)
      .values({ name: `${name} ${suffix}`, createdBranchId })
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
          code: `LOYHTTP-${suffix}-A`,
          name: `Loyalty HTTP A ${suffix}`,
          type: 'RETAIL',
          city: 'Accra',
        },
        {
          code: `LOYHTTP-${suffix}-B`,
          name: `Loyalty HTTP B ${suffix}`,
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
    for (const customerId of createdCustomerIds) {
      const account = await findAccountByCustomerId(customerId)
      if (account) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(eq(loyaltyLot.accountId, account.id))
        const lotIds = lots.map((lot) => lot.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
        }
        await db.delete(loyaltyLot).where(eq(loyaltyLot.accountId, account.id))
        await db.delete(loyaltyLedgerEntry).where(eq(loyaltyLedgerEntry.accountId, account.id))
        await db.delete(loyaltyAccount).where(eq(loyaltyAccount.id, account.id))
      }
    }
    if (createdCustomerIds.length > 0) {
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
    const response = await app.request(`/api/loyalty/accounts/${crypto.randomUUID()}`)
    expect(response.status).toBe(401)
  })

  it('denies cashiers on every loyalty endpoint', async () => {
    const account = await app.request(`/api/loyalty/accounts/${crypto.randomUUID()}`, {
      headers: authedHeaders(cashierCookie),
    })
    expect(account.status).toBe(403)

    const entry = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({ customerId: crypto.randomUUID(), kind: 'EARN', netPaidMinor: 1_000 }),
    })
    expect(entry.status).toBe(403)

    const liability = await app.request('/api/loyalty/liability', {
      headers: authedHeaders(cashierCookie),
    })
    expect(liability.status).toBe(403)

    const expiryRun = await app.request('/api/loyalty/expiry-run', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
    })
    expect(expiryRun.status).toBe(403)
  })

  it('gates the expiry trigger to admins and audits the run it returns', async () => {
    const denied = await app.request('/api/loyalty/expiry-run', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    expect(denied.status).toBe(403)

    const runsBefore = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.action, 'loyalty.expiry_run'))

    const response = await app.request('/api/loyalty/expiry-run', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<ExpiryRunResult>(response)
    expect(body.accounts).toBeGreaterThanOrEqual(0)
    expect(body.lots).toBeGreaterThanOrEqual(0)
    expect(body.points).toBeGreaterThanOrEqual(0)

    // The engine writes one run-audit row per call, even when nothing was due.
    const runsAfter = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.action, 'loyalty.expiry_run'))
    expect(runsAfter.length).toBe(runsBefore.length + 1)
  })

  it('lets a manager earn, redeem with a quote, and read the account', async () => {
    const customerId = await createCustomerRow('HTTP Flow', branchAId)

    const earn = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'EARN', netPaidMinor: 1_075 }),
    })
    expect(earn.status).toBe(201)
    const earnBody = await readJson<{
      entry: { pointsDelta: number; branchId: string | null }
      account: { balancePoints: number }
      lot: { expiresAt: string } | null
    }>(earn)
    expect(earnBody.entry.pointsDelta).toBe(10)
    // The manager posts to their own branch without naming it.
    expect(earnBody.entry.branchId).toBe(branchAId)
    expect(earnBody.account.balancePoints).toBe(10)
    expect(earnBody.lot?.expiresAt).toBeTruthy()

    const topUp = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'EARN', netPaidMinor: 30_000 }),
    })
    expect(topUp.status).toBe(201)

    // 250 points at 100 points per cedi → GHS 2.50 = 250 pesewas.
    const redeem = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'REDEEM', points: 250 }),
    })
    expect(redeem.status).toBe(201)
    const redeemBody = await readJson<{
      entry: { kind: string; pointsDelta: number }
      account: { balancePoints: number }
      quote: { points: number; discountMinor: number } | null
      consumption: Array<{ points: number }>
    }>(redeem)
    expect(redeemBody.entry.kind).toBe('REDEEM')
    expect(redeemBody.entry.pointsDelta).toBe(-250)
    expect(redeemBody.quote).toEqual({ points: 250, discountMinor: 250 })
    expect(redeemBody.account.balancePoints).toBe(60)
    expect(redeemBody.consumption.length).toBeGreaterThan(0)

    const belowMinimum = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'REDEEM', points: 50 }),
    })
    expect(belowMinimum.status).toBe(409)

    const account = await app.request(`/api/loyalty/accounts/${customerId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(account.status).toBe(200)
    const accountBody = await readJson<{
      balancePoints: number
      lots: Array<{ points: number; remainingPoints: number }>
      entries: Array<{ kind: string }>
      entryTotal: number
    }>(account)
    expect(accountBody.balancePoints).toBe(60)
    expect(accountBody.entryTotal).toBe(3)
    expect(accountBody.entries[0]?.kind).toBe('REDEEM')
    expect(accountBody.lots.reduce((sum, lot) => sum + lot.remainingPoints, 0)).toBe(60)
  })

  it('validates postings at the edge and requires a branch for admins', async () => {
    const customerId = await createCustomerRow('HTTP Invalid', branchAId)

    const adjustWithoutReason = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'ADJUST', points: 10 }),
    })
    expect(adjustWithoutReason.status).toBe(400)

    const clawbackWrongReason = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'CLAWBACK', points: 10, reasonCode: 'OTHER' }),
    })
    expect(clawbackWrongReason.status).toBe(400)

    const earnWithPoints = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId, kind: 'EARN', netPaidMinor: 1_000, points: 5 }),
    })
    expect(earnWithPoints.status).toBe(400)

    const unknownCustomer = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId: crypto.randomUUID(), kind: 'EARN', netPaidMinor: 1_000 }),
    })
    expect(unknownCustomer.status).toBe(404)

    // Admins must name the posting branch.
    const adminNoBranch = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ customerId, kind: 'EARN', netPaidMinor: 1_000 }),
    })
    expect(adminNoBranch.status).toBe(400)
  })

  it('reports liability with per-branch activity and negative balances', async () => {
    const customerB = await createCustomerRow('HTTP Branch B', branchBId)
    const branchBEarn = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        customerId: customerB,
        branchId: branchBId,
        kind: 'EARN',
        netPaidMinor: 10_000,
      }),
    })
    expect(branchBEarn.status).toBe(201)

    const negativeA = await createCustomerRow('HTTP Negative A', branchAId)
    await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId: negativeA, kind: 'EARN', netPaidMinor: 5_000 }),
    })
    const clawbackA = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ customerId: negativeA, kind: 'CLAWBACK', points: 80 }),
    })
    expect(clawbackA.status).toBe(201)
    const clawbackABody = await readJson<{ account: { balancePoints: number } }>(clawbackA)
    expect(clawbackABody.account.balancePoints).toBe(-30)

    const negativeB = await createCustomerRow('HTTP Negative B', branchBId)
    await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        customerId: negativeB,
        branchId: branchBId,
        kind: 'EARN',
        netPaidMinor: 2_000,
      }),
    })
    const clawbackB = await app.request('/api/loyalty/entries', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        customerId: negativeB,
        branchId: branchBId,
        kind: 'CLAWBACK',
        points: 50,
      }),
    })
    expect(clawbackB.status).toBe(201)

    const adminReport = await app.request('/api/loyalty/liability', {
      headers: authedHeaders(adminCookie),
    })
    expect(adminReport.status).toBe(200)
    const adminBody = await readJson<LoyaltyLiabilityReport>(adminReport)
    expect(adminBody.pointsPerCedi).toBe(100)
    // The GHS value always follows the redemption-rate maths.
    expect(adminBody.outstandingValueMinor).toBe(
      Math.floor((adminBody.outstandingPoints * 100) / adminBody.pointsPerCedi),
    )

    const rowA = adminBody.activity.rows.find((row) => row.branchId === branchAId)
    expect(rowA).toMatchObject({
      earnedPoints: 360,
      redeemedPoints: 250,
      clawedBackPoints: 80,
      adjustedPoints: 0,
      expiredPoints: 0,
      netPoints: 30,
    })
    const rowB = adminBody.activity.rows.find((row) => row.branchId === branchBId)
    expect(rowB).toMatchObject({ earnedPoints: 120, clawedBackPoints: 50, netPoints: 70 })

    expect(adminBody.negativeBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: negativeA, balancePoints: -30 }),
        expect.objectContaining({ customerId: negativeB, balancePoints: -30 }),
      ]),
    )

    // Managers see their own branch's activity plus the all-branch balance.
    const managerReport = await app.request('/api/loyalty/liability', {
      headers: authedHeaders(managerCookie),
    })
    expect(managerReport.status).toBe(200)
    const managerBody = await readJson<LoyaltyLiabilityReport>(managerReport)
    expect(managerBody.activity.branchId).toBe(branchAId)
    expect(managerBody.activity.rows.some((row) => row.branchId === branchAId)).toBe(true)
    expect(managerBody.activity.rows.some((row) => row.branchId === branchBId)).toBe(false)
    // All-branch balance: includes branch B's +100 net, not just own-branch totals.
    expect(managerBody.outstandingPoints).toBeGreaterThanOrEqual(100)
    expect(managerBody.outstandingValueMinor).toBe(
      Math.floor((managerBody.outstandingPoints * 100) / managerBody.pointsPerCedi),
    )
    expect(managerBody.negativeBalances.some((row) => row.customerId === negativeA)).toBe(true)
    expect(managerBody.negativeBalances.some((row) => row.customerId === negativeB)).toBe(false)

    const crossBranch = await app.request(`/api/loyalty/liability?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(crossBranch.status).toBe(403)
  })
})

describe.skipIf(!available)('loyalty expiry job', () => {
  const suffix = uniqueSuffix()
  const actorIds: string[] = []
  const branchIds: string[] = []
  const customerIds: string[] = []
  let boss: PgBoss | null = null

  function makeActor(label: string): AuditActor & { actorId: string } {
    const id = `loyalty-job-actor-${suffix}-${label}`
    actorIds.push(id)
    return {
      actorId: id,
      actorStaffId: `GA-LOYALTY-JOB-${suffix}`,
      ip: null,
      userAgent: null,
      requestId: null,
    }
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values({
        code: `LOYJOB-${suffix}`,
        name: `Loyalty Job ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning({ id: branch.id })
    const branchId = branches[0]?.id
    if (!branchId) throw new Error('branch fixture insert failed')
    branchIds.push(branchId)

    boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schedule: false,
      __test__enableSpies: true,
    })
    boss.on('error', (error) => console.warn('[loyalty.test] pg-boss error', error))
    await boss.start()
    await registerJobHandlers(boss)
  })

  afterAll(async () => {
    if (boss) {
      await boss.unschedule(LOYALTY_EXPIRY_QUEUE)
      await boss.stop()
      boss = null
    }
    await db.delete(auditLog).where(inArray(auditLog.actorId, actorIds))
    for (const customerId of customerIds) {
      const account = await findAccountByCustomerId(customerId)
      if (account) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(eq(loyaltyLot.accountId, account.id))
        const lotIds = lots.map((lot) => lot.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
        }
        await db.delete(loyaltyLot).where(eq(loyaltyLot.accountId, account.id))
        await db.delete(loyaltyLedgerEntry).where(eq(loyaltyLedgerEntry.accountId, account.id))
        await db.delete(loyaltyAccount).where(eq(loyaltyAccount.id, account.id))
      }
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds))
    }
    if (branchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, branchIds))
    }
  })

  it('expires a due lot through the queue and no-ops on a re-run', {
    timeout: 30_000,
  }, async () => {
    if (!boss) throw new Error('pg-boss was not started')
    const branchId = branchIds[0]
    if (!branchId) throw new Error('branch fixture is missing')

    const customerRows = await db
      .insert(customer)
      .values({ name: `Loyalty Job Customer ${suffix}`, createdBranchId: branchId })
      .returning({ id: customer.id })
    const customerId = customerRows[0]?.id
    if (!customerId) throw new Error('customer fixture insert failed')
    customerIds.push(customerId)

    // Earned January 2025, so the lot was already due when the job runs.
    const posted = await postEntry(makeActor('job'), {
      branchId,
      customerId,
      kind: 'EARN',
      netPaidMinor: 3_000,
      occurredAt: new Date('2025-01-01T00:00:00Z'),
    })
    const lot = posted.lot
    if (!lot) throw new Error('lot was not created')
    expect(posted.account.balancePoints).toBe(30)
    expect(lot.expiresAt.getTime()).toBeLessThan(Date.now())

    const spy = boss.getSpy(LOYALTY_EXPIRY_QUEUE)
    const firstJobId = await boss.send(LOYALTY_EXPIRY_QUEUE, {})
    if (!firstJobId) throw new Error('first job was not enqueued')
    const first = await spy.waitForJobWithId(firstJobId, 'completed')
    expect(first.output).toEqual({ accounts: 1, lots: 1, points: 30 })

    const account = await findAccountByCustomerId(customerId)
    if (!account) throw new Error('account was not created')
    expect(account.balancePoints).toBe(0)

    const entries = await db
      .select()
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.accountId, account.id))
    expect(entries).toHaveLength(2)
    const expireEntry = entries.find((entry) => entry.kind === 'EXPIRE')
    expect(expireEntry?.pointsDelta).toBe(-30)
    expect(expireEntry?.reasonCode).toBe('EXPIRY')
    expect(expireEntry?.branchId).toBeNull()
    expect(expireEntry?.createdBy).toBeNull()
    if (!expireEntry) throw new Error('expiry entry was not written')

    const consumptions = await db
      .select()
      .from(loyaltyLotConsumption)
      .where(eq(loyaltyLotConsumption.entryId, expireEntry.id))
    expect(consumptions.map((row) => [row.lotId, row.points])).toEqual([[lot.id, 30]])
    const lots = await listLots(account.id)
    expect(lots.find((row) => row.id === lot.id)?.remainingPoints).toBe(0)

    // A re-run through the queue finds nothing due and changes nothing.
    const secondJobId = await boss.send(LOYALTY_EXPIRY_QUEUE, {})
    if (!secondJobId) throw new Error('second job was not enqueued')
    const second = await spy.waitForJobWithId(secondJobId, 'completed')
    expect(second.output).toEqual({ accounts: 0, lots: 0, points: 0 })

    const entriesAfter = await db
      .select({ id: loyaltyLedgerEntry.id })
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.accountId, account.id))
    expect(entriesAfter).toHaveLength(entries.length)
    expect((await findAccountByCustomerId(customerId))?.balancePoints).toBe(0)
  })
})
