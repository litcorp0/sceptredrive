import { db } from '@sceptre/db'
import { priceCart, type TenderMethod, tenderBalance } from '@sceptre/shared'
import { and, eq, inArray } from 'drizzle-orm'
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
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { product, productPrice } from '../products/products.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { insertConflict } from './pos.repository.ts'
import {
  posStaffBinding,
  posSyncTransaction,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from './pos.schema.ts'
import { applySale } from './pos.service.ts'
import type { SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.conflicts.test] database unavailable; integration tests skipped')

/**
 * The conflict queue and the act of resolving one (Phase 14, Plan 04).
 *
 * The fixture is built through the real write paths — enrolment, the device
 * session, `applySale` — because a hand-inserted conflict proves nothing about
 * the row the till produces. The three conflicts a sale raises here are the three
 * `pos.test.ts` already knows about: `STOCK_OVERSELL` (HIGH), `PRICE_MISMATCH`
 * (HIGH) and `CLOCK_SKEW` (LOW), so the severity-first order is exercised by
 * real rows rather than by a fixture that was sorted before it was read.
 *
 * Everything this suite creates is removed child-first in `afterAll`: the shared
 * test database is one database, and a conflict row left behind changes every
 * later count in `analytics.test.ts`.
 */
describe.skipIf(!available)('POS conflict queue', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSaleIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdBranchIds: string[] = []

  interface Counter {
    branchId: string
    terminalId: string
    deviceId: string
    deviceToken: string
    accessToken: string
  }

  let adminCookie = ''
  let managerCookie = ''
  let foreignManagerCookie = ''
  let cashierCookie = ''

  let home: Counter
  let other: Counter

  let managerUserId = ''
  let managerStaffId = ''
  let foreignManagerUserId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''

  let productA = '' // 10 000, two on hand at home
  let productB = '' // 5 000 base, 4 500 override at home
  let customerId = ''
  let customerPhone = ''
  let receiptSequence = 0

  let homeShiftId = ''
  let secondShiftId = ''
  let foreignShiftId = ''
  let conflictSaleId = ''

  let priceConflictId = '' // HIGH, 09:00
  let stockConflictId = '' // HIGH, 10:00
  let clockConflictId = '' // LOW, 08:00
  let resolvedConflictId = '' // RESOLVED before the suite reads anything
  let foreignConflictId = ''

  const deviceContext = (counter: Counter): DeviceAuthContext => ({
    deviceId: counter.deviceId,
    terminalId: counter.terminalId,
    branchId: counter.branchId,
  })

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  function sessionHeaders(cookie: string): Record<string, string> {
    return authedHeaders(cookie)
  }

  async function get(path: string, cookie: string = managerCookie): Promise<Response> {
    return app.request(path, { headers: sessionHeaders(cookie) })
  }

  async function patch(path: string, cookie: string, body: unknown): Promise<Response> {
    return app.request(path, {
      method: 'PATCH',
      headers: sessionHeaders(cookie),
      body: JSON.stringify(body),
    })
  }

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    expect(response.status, `expected ${status} ${code}`).toBe(status)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe(code)
  }

  /** A branch, a terminal and an enrolled device, all through the real API. */
  async function provisionCounter(label: string, code: string): Promise<Counter> {
    const branchResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
      body: JSON.stringify({
        code: `${code}${suffix.slice(0, 2)}`,
        name: `Conflict ${label} ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchResponse.status).toBe(201)
    const branchId = (await readJson<{ branch: { id: string } }>(branchResponse)).branch.id
    createdBranchIds.push(branchId)

    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: `Conflict ${label} counter` }),
    })
    expect(terminalResponse.status).toBe(201)
    const terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id
    createdTerminalIds.push(terminalId)

    const enrollmentResponse = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
    })
    expect(enrollmentResponse.status).toBe(201)
    const { enrollment } = await readJson<{ enrollment: { code: string } }>(enrollmentResponse)

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, fingerprint: `conflict-${label}-${suffix}` }),
    })
    expect(redeem.status).toBe(201)
    const { deviceToken } = await readJson<{ deviceToken: string }>(redeem)

    const session = await app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(session.status).toBe(200)
    const { accessToken } = await readJson<{ accessToken: string }>(session)

    const deviceRow = await db
      .select({ id: device.id })
      .from(device)
      .where(eq(device.terminalId, terminalId))
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    return { branchId, terminalId, deviceId, deviceToken, accessToken }
  }

  async function insertShift(input: {
    counter: Counter
    number: string
    status?: 'OPEN' | 'CLOSED'
    openingFloatMinor?: number
  }): Promise<string> {
    const status = input.status ?? 'OPEN'
    const rows = await db
      .insert(shift)
      .values({
        number: `${input.number}-${suffix}`,
        branchId: input.counter.branchId,
        terminalId: input.counter.terminalId,
        deviceId: input.counter.deviceId,
        cashierUserId,
        cashierStaffId,
        status,
        openedAt: new Date('2026-10-27T08:00:00Z'),
        closedAt: status === 'CLOSED' ? new Date('2026-10-27T18:00:00Z') : null,
        openingFloatMinor: input.openingFloatMinor ?? 50_000,
        openedBy: cashierStaffId,
        closedBy: status === 'CLOSED' ? cashierStaffId : null,
      })
      .returning()
    const id = rows[0]?.id
    if (!id) throw new Error('the shift fixture was not inserted')
    return id
  }

  interface SaleSpec {
    counter: Counter
    shiftId: string
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
    tender: 'CASH' | 'CREDIT'
    customer?: { id: string; phone: string; name: string }
    /** Minutes between the till's clock and the server's, for `CLOCK_SKEW`. */
    skewMinutes?: number
  }

  async function createSale(spec: SaleSpec): Promise<{
    saleId: string
    totalMinor: number
    conflicts: string[]
  }> {
    receiptSequence += 1
    const receiptNumber = `CQ${suffix}-${receiptSequence}`
    const priced = priceCart(
      spec.lines.map((line) => ({
        ...line,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD' as const,
        name: '',
        sku: '',
      })),
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
    )
    const tenders = tenderBalance(priced.totalMinor, [
      {
        method: spec.tender as TenderMethod,
        amountMinor: priced.totalMinor,
        sequence: 1,
      },
    ])
    expect(tenders.problem).toBeNull()

    const occurredAt = new Date(Date.now() - (spec.skewMinutes ?? 0) * 60_000)
    const payload: SalePayload = {
      receiptNumber,
      shiftId: spec.shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      customer: spec.customer ?? null,
      lines: spec.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      })),
      saleDiscount: null,
      loyalty: null,
      tenders: [
        {
          method: spec.tender,
          amountMinor: priced.totalMinor,
          paymentId: null,
          override: null,
        },
      ],
      totals: {
        subtotalMinor: priced.subtotalMinor,
        lineDiscountMinor: priced.lineDiscountMinor,
        saleDiscountMinor: priced.saleDiscountMinor,
        loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
        vatMinor: priced.vatMinor,
        nhilMinor: priced.nhilMinor,
        getfundMinor: priced.getfundMinor,
        taxTotalMinor: priced.taxTotalMinor,
        totalMinor: priced.totalMinor,
        changeMinor: tenders.changeMinor,
      },
      occurredAt: occurredAt.toISOString(),
      appVersion: 'test',
    }

    const saleId = crypto.randomUUID()
    createdSaleIds.push(saleId)
    const result = await db.transaction((tx) =>
      applySale(
        {
          clientTransactionId: saleId,
          device: deviceContext(spec.counter),
          receivedAt: new Date(),
          clockSkewToleranceMinutes: 10,
        },
        payload,
        tx,
      ),
    )

    return {
      saleId: result.saleId,
      totalMinor: priced.totalMinor,
      conflicts: result.conflicts.map((conflict) => conflict.type),
    }
  }

  async function conflictIdsForSale(saleId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({ id: syncConflict.id, type: syncConflict.type })
      .from(syncConflict)
      .where(eq(syncConflict.saleId, saleId))
    return new Map(rows.map((row) => [row.type, row.id]))
  }

  async function listFor(
    path: string,
    cookie = managerCookie,
  ): Promise<{
    conflicts: Array<{
      id: string
      branchId: string
      type: string
      severity: string
      status: string
      resolutionCode: string | null
    }>
    total: number
  }> {
    const response = await get(path, cookie)
    expect(response.status, await response.clone().text()).toBe(200)
    return readJson(response)
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    home = await provisionCounter('home', 'CH')
    other = await provisionCounter('other', 'CX')

    const manager = await createTestUser({ role: 'MANAGER', branchId: home.branchId })
    createdUserIds.push(manager.id)
    managerUserId = manager.id
    // A staff id the shops use: `resolved_by` prefers it over the account id.
    managerStaffId = `GA-CM${suffix.slice(0, 2)}`
    await db.update(userTable).set({ staffId: managerStaffId }).where(eq(userTable.id, manager.id))
    managerCookie = await signIn(manager.email)

    const foreignManager = await createTestUser({ role: 'MANAGER', branchId: other.branchId })
    createdUserIds.push(foreignManager.id)
    foreignManagerUserId = foreignManager.id
    foreignManagerCookie = await signIn(foreignManager.email)

    const cashier = await createTestUser({ role: 'CASHIER', branchId: home.branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-CC${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashierUserId))
    cashierCookie = await signIn(cashier.email)
    cashierToken = randomToken(40)
    const cashierBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId: home.deviceId,
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId: home.branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(cashierToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    cashierBindingId = cashierBinding[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Conflict Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `CQ${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const products = await db
      .insert(product)
      .values([
        {
          sku: `CA-${suffix}`,
          name: `Conflict A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `CB-${suffix}`,
          name: `Conflict B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = products[0]?.id ?? ''
    productB = products[1]?.id ?? ''
    createdProductIds.push(productA, productB)

    // B's override is what the server expects, which is what makes charging 5 000
    // a PRICE_MISMATCH rather than a matched price.
    await db.insert(productPrice).values({
      productId: productB,
      branchId: home.branchId,
      priceMinor: 4_500,
    })

    // Two on hand, ten sold: STOCK_OVERSELL, and the sale still applies.
    await db.insert(stockLevel).values([
      { productId: productA, branchId: home.branchId, quantityOnHand: 2, avgCostMinor: 6_000 },
      { productId: productB, branchId: home.branchId, quantityOnHand: 100, avgCostMinor: 3_000 },
      { productId: productA, branchId: other.branchId, quantityOnHand: 0, avgCostMinor: 6_000 },
    ])

    customerPhone = `+23320${String(Date.now()).slice(-7)}`
    const customerRow = await db
      .insert(customer)
      .values({ name: 'Conflict Customer', phone: customerPhone, createdBranchId: home.branchId })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)
    await db.insert(loyaltyAccount).values({ customerId })
    await db.insert(creditProfile).values({
      customerId,
      branchId: home.branchId,
      limitMinor: 5_000_000,
    })

    homeShiftId = await insertShift({ counter: home, number: 'CQS-1' })
    // A closed second drawer: one OPEN shift per terminal is a partial unique, and
    // a variance conflict belongs to a shift that has been counted.
    secondShiftId = await insertShift({
      counter: home,
      number: 'CQS-2',
      status: 'CLOSED',
      openingFloatMinor: 0,
    })
    foreignShiftId = await insertShift({ counter: other, number: 'CQS-3', openingFloatMinor: 0 })

    // One sale, three conflicts: HIGH oversell, HIGH price mismatch, LOW skew.
    // Credit, so `credit_ledger_entry` has a row naming the sale; the earn posts a
    // `loyalty_ledger_entry` naming it too. Both are what the checksum proves.
    const conflictSale = await createSale({
      counter: home,
      shiftId: homeShiftId,
      lines: [
        { productId: productA, quantity: 10, unitPriceMinor: 10_000 },
        { productId: productB, quantity: 1, unitPriceMinor: 5_000 },
      ],
      tender: 'CREDIT',
      customer: { id: customerId, phone: customerPhone, name: 'Conflict Customer' },
      skewMinutes: 90,
    })
    conflictSaleId = conflictSale.saleId
    expect([...conflictSale.conflicts].sort()).toEqual([
      'CLOCK_SKEW',
      'PRICE_MISMATCH',
      'STOCK_OVERSELL',
    ])

    const ids = await conflictIdsForSale(conflictSaleId)
    priceConflictId = ids.get('PRICE_MISMATCH') ?? ''
    stockConflictId = ids.get('STOCK_OVERSELL') ?? ''
    clockConflictId = ids.get('CLOCK_SKEW') ?? ''

    // `created_at` defaults to the transaction's `now()`, which is one instant for
    // all three rows: the order the queue promises is about the facts, so the
    // fixture gives each fact its own instant. LOW is the oldest and still sorts
    // last, which is the severity rule and not a timestamp rule.
    for (const [id, createdAt] of [
      [priceConflictId, '2026-01-01T09:00:00.000Z'],
      [stockConflictId, '2026-01-01T10:00:00.000Z'],
      [clockConflictId, '2026-01-01T08:00:00.000Z'],
    ] as const) {
      await db
        .update(syncConflict)
        .set({ createdAt: new Date(createdAt) })
        .where(eq(syncConflict.id, id))
    }

    // A row resolved before this suite started: the default queue must exclude it
    // and `?status=ALL` must include it.
    const resolved = await insertConflict({
      branchId: home.branchId,
      terminalId: home.terminalId,
      deviceId: home.deviceId,
      saleId: null,
      shiftId: null,
      type: 'DUPLICATE_CUSTOMER',
      severity: 'LOW',
      status: 'RESOLVED',
      resolutionCode: 'CONFIRMED',
      resolutionNote: 'Resolved before the suite',
      resolvedBy: cashierStaffId,
      resolvedAt: new Date('2026-01-02T09:00:00.000Z'),
      details: { customerId },
    })
    resolvedConflictId = resolved.id
    await db
      .update(syncConflict)
      .set({ createdAt: new Date('2026-01-01T07:00:00.000Z') })
      .where(eq(syncConflict.id, resolvedConflictId))

    // The other branch's conflict: a home manager must never see it, and naming
    // that branch is a 403 rather than a smaller page.
    const foreignSale = await createSale({
      counter: other,
      shiftId: foreignShiftId,
      lines: [{ productId: productA, quantity: 5, unitPriceMinor: 10_000 }],
      tender: 'CASH',
    })
    const foreignIds = await conflictIdsForSale(foreignSale.saleId)
    foreignConflictId = foreignIds.get('STOCK_OVERSELL') ?? ''
    expect(foreignConflictId).not.toBe('')
  })

  afterAll(async () => {
    // Child first. `sale`, the ledgers and the audit log are append-only in
    // production; a test suite is the one place its own fixtures are removed,
    // and leaving a conflict behind moves every later count.
    if (createdBranchIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.branchId, createdBranchIds))
      await db.delete(syncConflict).where(inArray(syncConflict.branchId, createdBranchIds))
    }
    if (createdSaleIds.length > 0) {
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
    if (createdCustomerIds.length > 0) {
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(loyaltyLotConsumption).where(
        inArray(
          loyaltyLotConsumption.lotId,
          db
            .select({ id: loyaltyLot.id })
            .from(loyaltyLot)
            .where(
              inArray(
                loyaltyLot.accountId,
                db
                  .select({ id: loyaltyAccount.id })
                  .from(loyaltyAccount)
                  .where(inArray(loyaltyAccount.customerId, createdCustomerIds)),
              ),
            ),
        ),
      )
      await db
        .delete(loyaltyLot)
        .where(
          inArray(
            loyaltyLot.accountId,
            db
              .select({ id: loyaltyAccount.id })
              .from(loyaltyAccount)
              .where(inArray(loyaltyAccount.customerId, createdCustomerIds)),
          ),
        )
      await db
        .delete(loyaltyLedgerEntry)
        .where(inArray(loyaltyLedgerEntry.customerId, createdCustomerIds))
      await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
    await db.delete(shift).where(inArray(shift.branchId, createdBranchIds))
    if (createdDeviceIds.length > 0) {
      await db
        .delete(posSyncTransaction)
        .where(inArray(posSyncTransaction.deviceId, createdDeviceIds))
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(productPrice).where(inArray(productPrice.productId, createdProductIds))
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdUomIds.length > 0) await db.delete(uom).where(inArray(uom.id, createdUomIds))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('lists the caller’s branch, HIGH before LOW and oldest first inside a severity', async () => {
    const body = await listFor('/api/pos/oversight/conflicts')

    expect(body.conflicts.map((row) => row.id)).toEqual([
      priceConflictId,
      stockConflictId,
      clockConflictId,
    ])
    expect(body.conflicts.map((row) => row.severity)).toEqual(['HIGH', 'HIGH', 'LOW'])
    // The RESOLVED row predates both HIGH conflicts and is still not in the
    // default queue: a queue that opens on everything is a log.
    expect(body.conflicts.map((row) => row.id)).not.toContain(resolvedConflictId)
    expect(body.total).toBe(3)
    for (const row of body.conflicts) expect(row.status).toBe('OPEN')
  })

  it('refuses another branch with a 403 and shows it only to an admin', async () => {
    await expectError(
      await get(`/api/pos/oversight/conflicts?branchId=${other.branchId}`),
      403,
      'FORBIDDEN',
    )

    const admin = await listFor(
      `/api/pos/oversight/conflicts?branchId=${other.branchId}`,
      adminCookie,
    )
    expect(admin.conflicts.map((row) => row.id)).toContain(foreignConflictId)
    for (const row of admin.conflicts) expect(row.branchId).toBe(other.branchId)

    const all = await listFor('/api/pos/oversight/conflicts', adminCookie)
    const ids = all.conflicts.map((row) => row.id)
    expect(ids).toContain(foreignConflictId)
    expect(ids).toContain(stockConflictId)

    // The other branch's manager is scoped to theirs in exactly the same way.
    const foreign = await listFor('/api/pos/oversight/conflicts', foreignManagerCookie)
    expect(foreign.conflicts.length).toBeGreaterThan(0)
    for (const row of foreign.conflicts) expect(row.branchId).toBe(other.branchId)
  })

  it('defaults to OPEN and includes a resolved row only when asked', async () => {
    const all = await listFor('/api/pos/oversight/conflicts?status=ALL')
    expect(all.conflicts.map((row) => row.id)).toContain(resolvedConflictId)

    const resolved = await listFor('/api/pos/oversight/conflicts?status=RESOLVED')
    expect(resolved.conflicts.map((row) => row.id)).toEqual([resolvedConflictId])
    expect(resolved.conflicts[0]?.resolutionCode).toBe('CONFIRMED')

    const dismissed = await listFor('/api/pos/oversight/conflicts?status=DISMISSED')
    expect(dismissed.conflicts).toEqual([])
    expect(dismissed.total).toBe(0)
  })

  it('narrows by type, severity, sale and page', async () => {
    const byType = await listFor('/api/pos/oversight/conflicts?type=CLOCK_SKEW')
    expect(byType.conflicts.map((row) => row.id)).toEqual([clockConflictId])

    const bySeverity = await listFor('/api/pos/oversight/conflicts?severity=HIGH')
    expect(bySeverity.conflicts.map((row) => row.id)).toEqual([priceConflictId, stockConflictId])

    const bySale = await listFor(`/api/pos/oversight/conflicts?saleId=${conflictSaleId}`)
    expect(bySale.total).toBe(3)

    const paged = await listFor('/api/pos/oversight/conflicts?limit=1&offset=1')
    expect(paged.conflicts.map((row) => row.id)).toEqual([stockConflictId])
    expect(paged.total).toBe(3)

    const byDay = await listFor(
      '/api/pos/oversight/conflicts?from=2026-01-01&to=2026-01-01&status=ALL',
    )
    // Inside LOW, the resolved row (07:00) is older than the skew (08:00).
    expect(byDay.conflicts.map((row) => row.id)).toEqual([
      priceConflictId,
      stockConflictId,
      resolvedConflictId,
      clockConflictId,
    ])

    await expectError(
      await get('/api/pos/oversight/conflicts?status=NOPE'),
      400,
      'VALIDATION_ERROR',
    )
    // `.strict()`: an ignored filter is a manager believing they narrowed a list.
    await expectError(
      await get(`/api/pos/oversight/conflicts?branch=${home.branchId}`),
      400,
      'VALIDATION_ERROR',
    )
  })

  it('serves a detail whose subject is a reference to the sale, shift or nothing', async () => {
    const detail = await get(`/api/pos/oversight/conflicts/${stockConflictId}`, managerCookie)
    expect(detail.status).toBe(200)
    const row = await readJson<{
      id: string
      type: string
      severity: string
      details: Record<string, unknown>
      subject: {
        kind: string
        id?: string
        receiptNumber?: string
        totalMinor?: number
        conflictCount?: number
      }
    }>(detail)

    const stored = (await db.select().from(sale).where(eq(sale.id, conflictSaleId)))[0]
    expect(row.id).toBe(stockConflictId)
    expect(row.type).toBe('STOCK_OVERSELL')
    expect(row.subject.kind).toBe('sale')
    expect(row.subject.id).toBe(conflictSaleId)
    expect(row.subject.receiptNumber).toBe(stored?.receiptNumber)
    expect(row.subject.totalMinor).toBe(stored?.totalMinor)
    expect(row.subject.conflictCount).toBe(stored?.conflictCount)
    // The details are the writer's own jsonb, PII-free by construction.
    expect(row.details).toBeTypeOf('object')

    // A conflict about a shift, with no sale: the shift is the subject.
    const shiftConflict = await insertConflict({
      branchId: home.branchId,
      terminalId: home.terminalId,
      deviceId: home.deviceId,
      shiftId: secondShiftId,
      type: 'SHIFT_VARIANCE_MISMATCH',
      severity: 'MEDIUM',
      status: 'OPEN',
      details: { expectedMinor: 0, countedMinor: 0 },
    })
    const shiftDetail = await readJson<{ subject: { kind: string; id?: string; number?: string } }>(
      await get(`/api/pos/oversight/conflicts/${shiftConflict.id}`, managerCookie),
    )
    const shiftRow = (await db.select().from(shift).where(eq(shift.id, secondShiftId)))[0]
    expect(shiftDetail.subject.kind).toBe('shift')
    expect(shiftDetail.subject.id).toBe(secondShiftId)
    expect(shiftDetail.subject.number).toBe(shiftRow?.number)

    // A rejected upload has no document at all; `none` says so.
    const orphan = await insertConflict({
      branchId: home.branchId,
      terminalId: home.terminalId,
      deviceId: home.deviceId,
      type: 'UNKNOWN_PRODUCT',
      severity: 'HIGH',
      status: 'OPEN',
      details: { clientTransactionId: crypto.randomUUID(), productIds: [] },
    })
    const orphanDetail = await readJson<{ subject: { kind: string } }>(
      await get(`/api/pos/oversight/conflicts/${orphan.id}`, managerCookie),
    )
    expect(orphanDetail.subject).toEqual({ kind: 'none' })

    await db.delete(syncConflict).where(inArray(syncConflict.id, [shiftConflict.id, orphan.id]))

    // A foreign object is a 403, not a 404: the manager may learn it exists.
    await expectError(
      await get(`/api/pos/oversight/conflicts/${foreignConflictId}`, managerCookie),
      403,
      'FORBIDDEN',
    )
    await expectError(
      await get(`/api/pos/oversight/conflicts/${crypto.randomUUID()}`, managerCookie),
      404,
      'NOT_FOUND',
    )
    await expectError(
      await get('/api/pos/oversight/conflicts/not-a-uuid', managerCookie),
      400,
      'VALIDATION_ERROR',
    )
  })

  it('denies a cashier the queue and the resolution', async () => {
    await expectError(await get('/api/pos/oversight/conflicts', cashierCookie), 403, 'FORBIDDEN')
    await expectError(
      await get(`/api/pos/oversight/conflicts/${stockConflictId}`, cashierCookie),
      403,
      'FORBIDDEN',
    )
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${stockConflictId}`, cashierCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
      }),
      403,
      'FORBIDDEN',
    )
  })

  it('writes the status, the code, the note, the actor and the time, and one audit row', async () => {
    const response = await patch(`/api/pos/oversight/conflicts/${stockConflictId}`, managerCookie, {
      status: 'RESOLVED',
      code: 'CONFIRMED',
      note: '  Counted twice at handover  ',
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const body = await readJson<{
      id: string
      status: string
      resolutionCode: string | null
      resolutionNote: string | null
      resolvedBy: string | null
      resolvedAt: string | null
      subject: { kind: string }
    }>(response)

    const stored = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, stockConflictId))
    )[0]
    expect(stored?.status).toBe('RESOLVED')
    expect(stored?.resolutionCode).toBe('CONFIRMED')
    // Trimmed by the validator, stored as written.
    expect(stored?.resolutionNote).toBe('Counted twice at handover')
    expect(stored?.resolvedBy).toBe(managerStaffId)
    expect(stored?.resolvedAt?.toISOString()).toBe(body.resolvedAt)
    expect(body.status).toBe('RESOLVED')
    expect(body.resolutionCode).toBe('CONFIRMED')
    expect(body.resolutionNote).toBe('Counted twice at handover')
    expect(body.resolvedBy).toBe(managerStaffId)
    // The response is the detail, so the console replaces the row in place.
    expect(body.subject.kind).toBe('sale')

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'sync_conflict'),
          eq(auditLog.entityId, stockConflictId),
          eq(auditLog.action, 'pos.conflict.resolved'),
        ),
      )
    expect(audits).toHaveLength(1)
    expect(audits[0]?.before).toEqual({ status: 'OPEN', resolutionCode: null })
    expect(audits[0]?.after).toEqual({
      status: 'RESOLVED',
      resolutionCode: 'CONFIRMED',
      resolutionNote: 'Counted twice at handover',
    })
    expect(audits[0]?.branchId).toBe(home.branchId)
    expect(audits[0]?.terminalId).toBe(home.terminalId)
    expect(audits[0]?.actorId).toBe(managerUserId)
    expect(audits[0]?.actorStaffId).toBe(managerStaffId)
  })

  it('refuses a second resolution with a 409 and changes nothing', async () => {
    const before = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, stockConflictId))
    )[0]
    const auditsBefore = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'sync_conflict'),
          eq(auditLog.entityId, stockConflictId),
          eq(auditLog.action, 'pos.conflict.resolved'),
        ),
      )

    await expectError(
      await patch(`/api/pos/oversight/conflicts/${stockConflictId}`, managerCookie, {
        status: 'DISMISSED',
        code: 'ACCEPTED_RISK',
        note: 'A second manager pressing the same button',
      }),
      409,
      'CONFLICT_ALREADY_RESOLVED',
    )

    const after = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, stockConflictId))
    )[0]
    expect(after?.status).toBe('RESOLVED')
    expect(after?.resolutionCode).toBe('CONFIRMED')
    expect(after?.resolvedAt?.toISOString()).toBe(before?.resolvedAt?.toISOString())

    const auditsAfter = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'sync_conflict'),
          eq(auditLog.entityId, stockConflictId),
          eq(auditLog.action, 'pos.conflict.resolved'),
        ),
      )
    expect(auditsAfter).toHaveLength(auditsBefore.length)
  })

  it('validates the body with the shared rule and scopes the row', async () => {
    // `DISMISSED` needs a note, and the sentence is `resolutionProblem`'s.
    const dismissed = await patch(
      `/api/pos/oversight/conflicts/${clockConflictId}`,
      managerCookie,
      { status: 'DISMISSED', code: 'DUPLICATE' },
    )
    expect(dismissed.status).toBe(400)
    const dismissedBody = await readJson<{ error: { code: string; message: string } }>(dismissed)
    expect(dismissedBody.error.code).toBe('VALIDATION_ERROR')
    expect(dismissedBody.error.message).toContain('A dismissal needs a note')

    await expectError(
      await patch(`/api/pos/oversight/conflicts/${clockConflictId}`, managerCookie, {
        status: 'RESOLVED',
      }),
      400,
      'VALIDATION_ERROR',
    )
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${clockConflictId}`, managerCookie, {
        status: 'RESOLVED',
        code: 'NOT_A_CODE',
      }),
      400,
      'VALIDATION_ERROR',
    )
    // `.strict()`: a field the service ignores is a resolution that recorded less
    // than the client thought it did.
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${clockConflictId}`, managerCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
        resolutionCode: 'CONFIRMED',
      }),
      400,
      'VALIDATION_ERROR',
    )
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${clockConflictId}`, managerCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
        note: 'x'.repeat(501),
      }),
      400,
      'VALIDATION_ERROR',
    )

    // A foreign row is a 403, and it is not a 404: the manager may learn it exists.
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${foreignConflictId}`, managerCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
      }),
      403,
      'FORBIDDEN',
    )
    await expectError(
      await patch(`/api/pos/oversight/conflicts/${crypto.randomUUID()}`, managerCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
      }),
      404,
      'NOT_FOUND',
    )
    await expectError(
      await patch('/api/pos/oversight/conflicts/not-a-uuid', managerCookie, {
        status: 'RESOLVED',
        code: 'CONFIRMED',
      }),
      400,
      'VALIDATION_ERROR',
    )

    // None of the refusals wrote anything.
    const untouched = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, clockConflictId))
    )[0]
    expect(untouched?.status).toBe('OPEN')
    expect(untouched?.resolvedAt).toBeNull()
    const foreign = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, foreignConflictId))
    )[0]
    expect(foreign?.status).toBe('OPEN')
  })

  it('records a dismissal with its note, on the branch that owns it', async () => {
    const response = await patch(
      `/api/pos/oversight/conflicts/${foreignConflictId}`,
      foreignManagerCookie,
      {
        status: 'DISMISSED',
        code: 'ACCEPTED_RISK',
        note: 'Known stock error at the other shop; the count was corrected by hand.',
      },
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const body = await readJson<{
      status: string
      resolutionCode: string
      resolvedBy: string | null
    }>(response)
    expect(body.status).toBe('DISMISSED')
    expect(body.resolutionCode).toBe('ACCEPTED_RISK')
    // The foreign manager has no staff id, so the account id is the fallback.
    expect(body.resolvedBy).toBe(foreignManagerUserId)

    const stored = (
      await db.select().from(syncConflict).where(eq(syncConflict.id, foreignConflictId))
    )[0]
    expect(stored?.status).toBe('DISMISSED')
    expect(stored?.resolutionNote).toContain('Known stock error')
    expect(stored?.resolvedBy).not.toBeNull()
    // The note the dismissal needed is in the audit row as well as the column.
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'sync_conflict'),
          eq(auditLog.entityId, foreignConflictId),
          eq(auditLog.action, 'pos.conflict.resolved'),
        ),
      )
    expect(audits).toHaveLength(1)
    expect(audits[0]?.branchId).toBe(other.branchId)
    expect(audits[0]?.after).toMatchObject({ status: 'DISMISSED', resolutionCode: 'ACCEPTED_RISK' })
  })
})
