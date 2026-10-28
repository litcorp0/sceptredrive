import { db } from '@sceptre/db'
import { priceCart } from '@sceptre/shared'
import { eq, inArray } from 'drizzle-orm'
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
import { category, uom } from '../catalog/catalog.schema.ts'
import { evatSubmission } from '../evat/evat.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { terminalEnrollment } from '../org/enrollment.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import {
  cashMovement,
  posStaffBinding,
  posSyncTransaction,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from '../pos/pos.schema.ts'
import { product, productPrice } from '../products/products.schema.ts'
import type {
  DeviceConflictItem,
  DeviceSyncState,
  PosSessionPayload,
  PosUploadResponse,
} from './sync.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[sync.upload.test] database unavailable; integration tests skipped')

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('POS upload endpoint', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  let adminCookie = ''
  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let deviceToken = ''
  let accessToken = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let shiftId = ''
  let productId = ''
  let categoryId = ''
  let uomId = ''
  let otherTerminalId = ''
  let otherAccessToken = ''

  function uploadRequest(body: unknown, token = accessToken) {
    return app.request('/api/pos/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  }

  function batch(transactions: unknown[]) {
    return { batchId: crypto.randomUUID(), deviceId, terminalId, transactions }
  }

  function cashMovementTx(id: string, amountMinor = 500): unknown {
    return {
      clientTransactionId: id,
      type: 'CASH_MOVEMENT',
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: {
        id,
        shiftId,
        type: 'CASH_IN',
        amountMinor,
        reason: 'Float top-up',
        occurredAt: new Date().toISOString(),
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
      },
    }
  }

  function saleTx(clientTransactionId: string, receiptNumber: string, line = productId): unknown {
    const priced = priceCart(
      [
        {
          productId: line,
          quantity: 1,
          unitPriceMinor: 10_000,
          lineDiscountMinor: 0,
          taxCategory: 'STANDARD',
        },
      ],
      { taxMode: 'INCLUSIVE' },
    )
    const total = priced.totalMinor
    return {
      clientTransactionId,
      type: 'SALE',
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: {
        receiptNumber,
        shiftId,
        cashier: {
          userId: cashierUserId,
          staffId: cashierStaffId,
          bindingId: cashierBindingId,
          bindingToken: cashierToken,
          pinVersion: 1,
        },
        customer: null,
        lines: [
          {
            productId: line,
            quantity: 1,
            unitPriceMinor: 10_000,
            lineDiscountMinor: 0,
            taxCategory: 'STANDARD',
          },
        ],
        saleDiscount: null,
        loyalty: null,
        tenders: [{ method: 'CASH', amountMinor: total }],
        totals: {
          subtotalMinor: priced.subtotalMinor,
          lineDiscountMinor: priced.lineDiscountMinor,
          saleDiscountMinor: priced.saleDiscountMinor,
          loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
          vatMinor: priced.vatMinor,
          nhilMinor: priced.nhilMinor,
          getfundMinor: priced.getfundMinor,
          taxTotalMinor: priced.taxTotalMinor,
          totalMinor: total,
          changeMinor: 0,
        },
        occurredAt: new Date().toISOString(),
      },
    }
  }

  async function enrollTerminal(code: string): Promise<string> {
    const enrollmentResponse = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(enrollmentResponse.status).toBe(201)
    const { enrollment } = await readJson<{ enrollment: { code: string } }>(enrollmentResponse)

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, fingerprint: code }),
    })
    expect(redeem.status).toBe(201)
    return (await readJson<{ deviceToken: string }>(redeem)).deviceToken
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `U${suffix.slice(0, 3)}`,
        name: `Upload ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchResponse.status).toBe(201)
    branchId = (await readJson<{ branch: { id: string } }>(branchResponse)).branch.id

    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: 'Upload Counter' }),
    })
    expect(terminalResponse.status).toBe(201)
    terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id

    deviceToken = await enrollTerminal('upload-main')
    const session = await readJson<PosSessionPayload>(
      await app.request('/api/pos/session', {
        method: 'POST',
        headers: { authorization: `Bearer ${deviceToken}` },
      }),
    )
    accessToken = session.accessToken
    deviceId = session.deviceId

    const otherTerminal = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: 'Upload Counter 2' }),
    })
    otherTerminalId = (await readJson<{ terminal: { id: string } }>(otherTerminal)).terminal.id
    const otherEnrollment = await app.request(`/api/terminals/${otherTerminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    const otherCode = (await readJson<{ enrollment: { code: string } }>(otherEnrollment)).enrollment
      .code
    const otherRedeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: otherCode, fingerprint: 'upload-other' }),
    })
    const otherSession = await readJson<PosSessionPayload>(
      await app.request('/api/pos/session', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${(await readJson<{ deviceToken: string }>(otherRedeem)).deviceToken}`,
        },
      }),
    )
    otherAccessToken = otherSession.accessToken

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-U${suffix.slice(0, 3)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashier.id))
    cashierToken = randomToken(40)
    const binding = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(cashierToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    cashierBindingId = binding[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Upload Category ${suffix}` })
      .returning()
    categoryId = categoryRow[0]?.id ?? ''
    const uomRow = await db
      .insert(uom)
      .values({ code: `UU${suffix}`, name: 'Piece' })
      .returning()
    uomId = uomRow[0]?.id ?? ''
    const productRow = await db
      .insert(product)
      .values({
        sku: `UP-${suffix}`,
        name: `Upload Product ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        taxCategory: 'STANDARD',
      })
      .returning()
    productId = productRow[0]?.id ?? ''
    await db.insert(productPrice).values({ productId, branchId, priceMinor: 10_000 })
    await db
      .insert(stockLevel)
      .values({ productId, branchId, quantityOnHand: 100, avgCostMinor: 6_000 })

    // Open the shift through the endpoint so the sale can reference it.
    shiftId = crypto.randomUUID()
    const openResponse = await uploadRequest(
      batch([
        {
          clientTransactionId: shiftId,
          type: 'SHIFT_OPEN',
          occurredAt: new Date().toISOString(),
          payloadVersion: 1,
          payload: {
            shiftId,
            number: `U${suffix}-S-20261023-01`,
            openingFloatMinor: 20_000,
            cashierUserId,
            cashierStaffId,
            occurredAt: new Date().toISOString(),
          },
        },
      ]),
    )
    expect(openResponse.status).toBe(200)
    const openBody = await readJson<PosUploadResponse>(openResponse)
    expect(openBody.results[0]?.status).toBe('APPLIED')
  })

  afterAll(async () => {
    if (!branchId) {
      for (const userId of createdUserIds) await deleteTestUser(userId)
      return
    }
    // A sale's submission restricts the sale (P14-D34): delete the certificate
    // before the document it certifies.
    await db.delete(evatSubmission).where(eq(evatSubmission.branchId, branchId))
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(posSyncTransaction).where(eq(posSyncTransaction.terminalId, terminalId))
    const sales = await db.select({ id: sale.id }).from(sale).where(eq(sale.branchId, branchId))
    const saleIds = sales.map((row) => row.id)
    if (saleIds.length > 0) {
      await db.delete(saleTender).where(inArray(saleTender.saleId, saleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, saleIds))
      await db.delete(sale).where(inArray(sale.id, saleIds))
    }
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    await db.delete(productPrice).where(eq(productPrice.branchId, branchId))
    if (productId) await db.delete(product).where(eq(product.id, productId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    const deviceRows = await db
      .select({ id: device.id })
      .from(device)
      .where(inArray(device.terminalId, [terminalId, otherTerminalId]))
    if (deviceRows.length > 0) {
      await db.delete(device).where(
        inArray(
          device.id,
          deviceRows.map((row) => row.id),
        ),
      )
    }
    await db
      .delete(terminalEnrollment)
      .where(inArray(terminalEnrollment.terminalId, [terminalId, otherTerminalId]))
    await db.delete(terminal).where(inArray(terminal.id, [terminalId, otherTerminalId]))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('applies a transaction once and replays it without side effects', async () => {
    const id = crypto.randomUUID()
    const transaction = cashMovementTx(id)

    const first = await uploadRequest(batch([transaction]))
    expect(first.status).toBe(200)
    const firstBody = await readJson<PosUploadResponse>(first)
    expect(firstBody.results[0]?.status).toBe('APPLIED')

    const second = await uploadRequest(batch([transaction]))
    const secondBody = await readJson<PosUploadResponse>(second)
    expect(secondBody.results[0]?.status).toBe('REPLAYED')
    expect(secondBody.results[0]?.serverId).toBe(firstBody.results[0]?.serverId)

    const rows = await db.select().from(cashMovement).where(eq(cashMovement.id, id))
    expect(rows).toHaveLength(1)
    const reservations = await db
      .select()
      .from(posSyncTransaction)
      .where(eq(posSyncTransaction.clientTransactionId, id))
    expect(reservations).toHaveLength(1)
  })

  it('does not let one rejected transaction roll back its neighbours', async () => {
    const before = crypto.randomUUID()
    const receipt = `U${suffix}-R-${randomToken(4)}`
    const rejectedId = crypto.randomUUID()
    const afterId = crypto.randomUUID()

    const response = await uploadRequest(
      batch([
        cashMovementTx(before, 100),
        saleTx(rejectedId, receipt, crypto.randomUUID()),
        cashMovementTx(afterId, 200),
      ]),
    )
    expect(response.status).toBe(200)
    const body = await readJson<PosUploadResponse>(response)
    expect(body.results.map((result) => result.status)).toEqual(['APPLIED', 'REJECTED', 'APPLIED'])
    expect(body.results[1]?.error?.code).toBe('UNKNOWN_PRODUCT')
    expect(body.results[1]?.conflicts.map((conflict) => conflict.type)).toContain('UNKNOWN_PRODUCT')

    const moved = await db
      .select()
      .from(cashMovement)
      .where(inArray(cashMovement.id, [before, afterId]))
    expect(moved).toHaveLength(2)
  })

  it('applies a sale, returns its id, and replays it exactly once', async () => {
    const id = crypto.randomUUID()
    const transaction = saleTx(id, `U${suffix}-R-SALE1`)

    const first = await readJson<PosUploadResponse>(await uploadRequest(batch([transaction])))
    expect(first.results[0]?.status).toBe('APPLIED')
    expect(first.results[0]?.serverId).toBe(id)
    expect(first.results[0]?.resolved.saleId).toBe(id)

    const replay = await readJson<PosUploadResponse>(await uploadRequest(batch([transaction])))
    expect(replay.results[0]?.status).toBe('REPLAYED')

    const rows = await db.select().from(sale).where(eq(sale.id, id))
    expect(rows).toHaveLength(1)
  })

  it('accepts the legacy providerReference on a tender and ignores it', async () => {
    const id = crypto.randomUUID()
    const transaction = saleTx(id, `U${suffix}-R-LEGACY`) as {
      payload: { tenders: Array<Record<string, unknown>> }
    }
    transaction.payload.tenders[0] = {
      ...transaction.payload.tenders[0],
      providerReference: 'sd-cp_legacy',
    }

    const body = await readJson<PosUploadResponse>(await uploadRequest(batch([transaction])))
    expect(body.results[0]?.status).toBe('APPLIED')
    expect(body.results[0]?.serverId).toBe(id)
  })

  it('creates one sale for concurrent identical batches', async () => {
    const id = crypto.randomUUID()
    const transaction = saleTx(id, `U${suffix}-R-RACE1`)

    const [left, right] = await Promise.all([
      uploadRequest(batch([transaction])),
      uploadRequest(batch([transaction])),
    ])
    const leftBody = await readJson<PosUploadResponse>(left)
    const rightBody = await readJson<PosUploadResponse>(right)
    const statuses = [leftBody.results[0]?.status, rightBody.results[0]?.status].sort()
    expect(statuses).toEqual(['APPLIED', 'REPLAYED'])

    const rows = await db.select().from(sale).where(eq(sale.id, id))
    expect(rows).toHaveLength(1)
  })

  it('rejects a batch that belongs to another device', async () => {
    const response = await uploadRequest({
      ...batch([cashMovementTx(crypto.randomUUID())]),
      deviceId: crypto.randomUUID(),
    })
    expect(response.status).toBe(403)
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      'DEVICE_MISMATCH',
    )
  })

  it('rejects more than 50 transactions and a missing device JWT', async () => {
    const tooMany = Array.from({ length: 51 }, () => cashMovementTx(crypto.randomUUID()))
    const response = await uploadRequest(batch(tooMany))
    expect(response.status).toBe(400)

    const anonymous = await app.request('/api/pos/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch([cashMovementTx(crypto.randomUUID())])),
    })
    expect(anonymous.status).toBe(401)
  })

  it('returns only this terminal conflicts and validates the query', async () => {
    const response = await app.request('/api/pos/sync/conflicts', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.status).toBe(200)
    const body = await readJson<{ conflicts: DeviceConflictItem[] }>(response)
    expect(body.conflicts.some((conflict) => conflict.type === 'UNKNOWN_PRODUCT')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/pin|token/i)

    const other = await app.request('/api/pos/sync/conflicts', {
      headers: { authorization: `Bearer ${otherAccessToken}` },
    })
    const otherBody = await readJson<{ conflicts: DeviceConflictItem[] }>(other)
    expect(otherBody.conflicts).toHaveLength(0)

    const invalid = await app.request('/api/pos/sync/conflicts?since=not-a-date', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(invalid.status).toBe(400)
  })

  it('reports sync state for the terminal', async () => {
    const response = await app.request('/api/pos/sync/state', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.status).toBe(200)
    const body = await readJson<DeviceSyncState>(response)
    expect(body.pendingConflicts).toBeGreaterThanOrEqual(1)
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false)
    expect(body.lastSaleAt).not.toBeNull()
  })
})
