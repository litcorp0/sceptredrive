import { db } from '@gikautos/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable, uniqueSuffix } from '../../../test/integration.ts'
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import { customer } from '../customers/customers.schema.ts'
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
import { earnPointsForSale, expireDueLots, postEntry, quoteRedeem } from './loyalty.service.ts'
import type { LoyaltyPostEntryInput } from './loyalty.types.ts'

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

  function makeActor(label: string): AuditActor {
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
})
