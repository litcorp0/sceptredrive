import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db } from '@sceptre/db'
import {
  EVAT_MAX_ATTEMPTS,
  EVAT_RETRY_DELAYS_MINUTES,
  priceCart,
  tenderBalance,
} from '@sceptre/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { parseEnv } from '../../config/env.ts'
import { approval } from '../approvals/approvals.schema.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { setting } from '../platform/settings.schema.ts'
import {
  cashMovement,
  posStaffBinding,
  posSyncTransaction,
  refund,
  refundLine,
  refundTender,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from '../pos/pos.schema.ts'
import type { SalePayload } from '../pos/pos.types.ts'
import { product, productPrice } from '../products/products.schema.ts'
import { applyUpload } from '../sync/sync.service.ts'
import type { DeviceAuthContext, PosUploadBody, RefundPayload } from '../sync/sync.types.ts'
import {
  failNextMockSubmission,
  getMockEvatCallCounts,
  makeMockHealthFail,
  resetMockEvat,
} from './evat.mock.provider.ts'
import type { EInvoicingProvider } from './evat.provider.ts'
import { setEvatProviderForTests } from './evat.provider.ts'
import { evatSubmission } from './evat.schema.ts'
import * as evatService from './evat.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[evat.test] database unavailable; integration tests skipped')

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/**
 * The E-VAT queue and its state machine (P14-D34 … P14-D40).
 *
 * Every fixture sale and refund is uploaded through `applyUpload`, because that
 * is where queueing happens: a submission written anywhere else would not prove
 * that a committed document always has one. The certificate is asserted against
 * the mock's own deterministic bytes, and the document is checksummed before and
 * after certification — a certificate that touched `sale` or `refund` would fail
 * the digest, not just a column list.
 */
describe.skipIf(!available)('E-VAT submissions', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdSaleIds: string[] = []
  const createdRefundIds: string[] = []
  const createdSubmissionIds: string[] = []
  const createdBranchIds: string[] = []

  let branchId = ''
  let branchBId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerUserId = ''
  let managerStaffId = ''
  let managerBindingId = ''
  let managerToken = ''
  let productId = ''
  let categoryId = ''
  let uomId = ''
  let adminCookie = ''
  let managerCookie = ''
  let receiptSequence = 0
  let refundSequence = 0
  /** Whatever the demo seed left in these globals, restored after the suite. */
  let previousSellerSettings: Array<{ key: string; value: string }> = []

  const SELLER_SETTING_KEYS = ['tax.sellerTin', 'tax.sellerVatNumber']

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })

  function salePayload(
    receiptNumber: string,
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>,
    occurredAt = new Date().toISOString(),
  ): SalePayload {
    const priced = priceCart(
      lines.map((line) => ({
        ...line,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD' as const,
      })),
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
    )
    const balance = tenderBalance(priced.totalMinor, [
      { method: 'CASH', amountMinor: priced.totalMinor, sequence: 1 },
    ])
    expect(balance.problem).toBeNull()

    return {
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
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      })),
      saleDiscount: null,
      loyalty: null,
      tenders: [
        { method: 'CASH', amountMinor: priced.totalMinor, paymentId: null, override: null },
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
        changeMinor: balance.changeMinor,
      },
      occurredAt,
    }
  }

  interface UploadedSale {
    saleId: string
    receiptNumber: string
    lineId: string
    tenderId: string
    submissionId: string
    doorbells: string[]
    body: PosUploadBody
  }

  /**
   * Uploads one sale through the sync path and returns the submission it
   * queued, so every test starts from a document the product actually wrote.
   */
  async function uploadSale(
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }> = [
      { productId, quantity: 2, unitPriceMinor: 4_000 },
    ],
    occurredAt = new Date().toISOString(),
  ): Promise<UploadedSale> {
    receiptSequence += 1
    const clientTransactionId = crypto.randomUUID()
    const receiptNumber = `EV${suffix}-${receiptSequence}`
    createdSaleIds.push(clientTransactionId)
    const doorbells: string[] = []

    const body: PosUploadBody = {
      batchId: crypto.randomUUID(),
      deviceId,
      terminalId,
      transactions: [
        {
          clientTransactionId,
          type: 'SALE',
          occurredAt,
          payloadVersion: 1,
          payload: salePayload(receiptNumber, lines, occurredAt),
        },
      ],
    }
    const response = await applyUpload(deviceContext(), body, {
      enqueueEvat: async (id) => {
        doorbells.push(id)
      },
    })
    expect(response.results[0]?.status).toBe('APPLIED')

    const saleRows = await db.select().from(sale).where(eq(sale.receiptNumber, receiptNumber))
    const saleRow = saleRows[0]
    expect(saleRow).toBeDefined()
    const lineRows = await db
      .select()
      .from(saleLine)
      .where(eq(saleLine.saleId, saleRow?.id ?? ''))
    const tenderRows = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, saleRow?.id ?? ''))
    const submissions = await db
      .select()
      .from(evatSubmission)
      .where(eq(evatSubmission.saleId, saleRow?.id ?? ''))
    const submission = submissions[0]
    if (submission) createdSubmissionIds.push(submission.id)

    return {
      saleId: saleRow?.id ?? '',
      receiptNumber,
      lineId: lineRows[0]?.id ?? '',
      tenderId: tenderRows[0]?.id ?? '',
      submissionId: submission?.id ?? '',
      doorbells,
      body,
    }
  }

  interface UploadedRefund {
    refundId: string
    number: string
    submissionId: string
    status: string
  }

  async function uploadRefund(origin: UploadedSale): Promise<UploadedRefund> {
    refundSequence += 1
    const clientTransactionId = crypto.randomUUID()
    const number = `EVR-${suffix}-${refundSequence}`
    createdRefundIds.push(clientTransactionId)

    const payload: RefundPayload = {
      saleId: origin.saleId,
      number,
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      note: null,
      approval: {
        staffId: managerStaffId,
        userId: managerUserId,
        bindingId: managerBindingId,
        pinVersion: 1,
        reasonCode: 'RETURN',
        note: null,
        occurredAt: new Date().toISOString(),
      },
      lines: [{ saleLineId: origin.lineId, quantity: 1, restock: 'RESALABLE', damageReason: null }],
      tenders: [{ saleTenderId: origin.tenderId, amountMinor: 4_000 }],
      refundedMinor: 4_000,
      occurredAt: new Date().toISOString(),
    }

    const response = await applyUpload(
      deviceContext(),
      {
        batchId: crypto.randomUUID(),
        deviceId,
        terminalId,
        transactions: [
          {
            clientTransactionId,
            type: 'REFUND',
            occurredAt: new Date().toISOString(),
            payloadVersion: 1,
            payload,
          },
        ],
      },
      { enqueueRefund: async () => {}, enqueueEvat: async () => {} },
    )
    expect(response.results[0]?.status).toBe('APPLIED')

    const rows = await db.select().from(refund).where(eq(refund.number, number))
    const refundRow = rows[0]
    const submissions = await db
      .select()
      .from(evatSubmission)
      .where(eq(evatSubmission.refundId, refundRow?.id ?? ''))
    const submission = submissions[0]
    if (submission) createdSubmissionIds.push(submission.id)

    return {
      refundId: refundRow?.id ?? '',
      number,
      submissionId: submission?.id ?? '',
      status: submission?.status ?? '',
    }
  }

  async function submissionRow(id: string) {
    const rows = await db.select().from(evatSubmission).where(eq(evatSubmission.id, id))
    return rows[0]
  }

  /** One attempt in its own transaction, exactly as the worker calls it. */
  async function submitNow(id: string) {
    return db.transaction((tx) => evatService.submit(id, tx))
  }

  /** The whole document as PostgreSQL serialises it: any write changes the digest. */
  async function tableDigest(table: string, column: string, id: string): Promise<string> {
    const result = await db.execute<{ payload: string }>(
      sql`select coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '') as payload
          from ${sql.raw(table)} t where t.${sql.raw(column)} = ${id}`,
    )
    return createHash('sha256')
      .update(result.rows[0]?.payload ?? '')
      .digest('hex')
  }

  async function documentSnapshot(saleId: string, refundId: string) {
    return {
      sale: await tableDigest('sale', 'id', saleId),
      saleLine: await tableDigest('sale_line', 'sale_id', saleId),
      saleTender: await tableDigest('sale_tender', 'sale_id', saleId),
      refund: await tableDigest('refund', 'id', refundId),
      refundLine: await tableDigest('refund_line', 'refund_id', refundId),
      refundTender: await tableDigest('refund_tender', 'refund_id', refundId),
    }
  }

  /** The mock's certificate recomputed here, so determinism is asserted, not assumed. */
  function expectedSignature(documentNumber: string): string {
    const hex = createHash('sha256').update(documentNumber).digest('hex')
    return [0, 1, 2, 3].map((group) => hex.slice(group * 4, group * 4 + 4)).join('-')
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchRow = await db
      .insert(branch)
      .values({ code: `E${suffix}`, name: `E-VAT ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''
    createdBranchIds.push(branchId)

    const otherBranch = await db
      .insert(branch)
      .values({
        code: `EB${suffix}`,
        name: `E-VAT Other ${suffix}`,
        type: 'RETAIL',
        city: 'Kumasi',
      })
      .returning()
    branchBId = otherBranch[0]?.id ?? ''
    createdBranchIds.push(branchBId)

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `E${suffix}-T01`, name: 'E-VAT Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `evat-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `E-VAT Category ${suffix}` })
      .returning()
    categoryId = categoryRow[0]?.id ?? ''
    const uomRow = await db
      .insert(uom)
      .values({ code: `EU${suffix}`, name: 'Piece' })
      .returning()
    uomId = uomRow[0]?.id ?? ''
    const productRow = await db
      .insert(product)
      .values({
        sku: `EV-${suffix}`,
        name: `E-VAT Product ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 4_000,
        taxCategory: 'STANDARD',
      })
      .returning()
    productId = productRow[0]?.id ?? ''
    await db.insert(productPrice).values({ productId, branchId, priceMinor: 4_000 })
    await db
      .insert(stockLevel)
      .values({ productId, branchId, quantityOnHand: 500, avgCostMinor: 2_400 })

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-EV${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashier.id))
    cashierToken = randomToken(40)
    const cashierBinding = await db
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
    cashierBindingId = cashierBinding[0]?.id ?? ''

    const manager = await createTestUser({ role: 'MANAGER', branchId })
    createdUserIds.push(manager.id)
    managerUserId = manager.id
    managerStaffId = `GA-EM${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, manager.id))
    managerToken = randomToken(40)
    const managerBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: managerUserId,
        staffStaffId: managerStaffId,
        role: 'MANAGER',
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(managerToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    managerBindingId = managerBinding[0]?.id ?? ''
    managerCookie = await signIn(manager.email)

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `EV-${suffix}-S-20261027-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 50_000,
        openedBy: cashierStaffId,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''

    // The seller's identity is the company's (P14-D38), and a blank TIN is a
    // refusal rather than a submission, so the suite sets both. They are globals
    // the demo seed also writes, so the suite snapshots what it finds and puts it
    // back: a test may not decide another suite's defaults.
    const existing = await db
      .select({ key: setting.key, value: setting.value })
      .from(setting)
      .where(inArray(setting.key, SELLER_SETTING_KEYS))
    previousSellerSettings = existing.map((row) => ({ key: row.key, value: row.value as string }))
    await db.delete(setting).where(inArray(setting.key, SELLER_SETTING_KEYS))
    await db.insert(setting).values([
      { key: 'tax.sellerTin', value: 'C0012345678', branchId: null },
      { key: 'tax.sellerVatNumber', value: 'VAT-0012345', branchId: null },
    ])
  })

  beforeEach(() => {
    resetMockEvat()
    setEvatProviderForTests(null)
    evatService.resetEvatHealthCache()
  })

  afterAll(async () => {
    setEvatProviderForTests(null)
    if (createdSubmissionIds.length > 0) {
      await db.delete(evatSubmission).where(inArray(evatSubmission.id, createdSubmissionIds))
    }
    // Anything queued by this suite but not tracked (a sale the suite created
    // outside the helper) still points at this branch.
    if (branchId) await db.delete(evatSubmission).where(eq(evatSubmission.branchId, branchId))

    if (createdRefundIds.length > 0) {
      await db.delete(refundTender).where(inArray(refundTender.refundId, createdRefundIds))
      await db.delete(refundLine).where(inArray(refundLine.refundId, createdRefundIds))
      await db.delete(refund).where(inArray(refund.id, createdRefundIds))
    }
    await db.delete(approval).where(eq(approval.branchId, branchId))
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    if (terminalId)
      await db.delete(posSyncTransaction).where(eq(posSyncTransaction.terminalId, terminalId))
    await db.delete(auditLog).where(eq(auditLog.entity, 'evat_submission'))
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    await db.delete(productPrice).where(eq(productPrice.branchId, branchId))
    if (productId) await db.delete(product).where(eq(product.id, productId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
    // Put the seller identity back the way it was found: a leftover test value
    // would make another suite read a default that is not a default, and a
    // deleted seed value would make it read a default that is not the seed's.
    await db.delete(setting).where(inArray(setting.key, SELLER_SETTING_KEYS))
    if (previousSellerSettings.length > 0) {
      await db
        .insert(setting)
        .values(previousSellerSettings.map((row) => ({ ...row, branchId: null })))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('queues one QUEUED invoice with due_at = occurredAt + 24h, and a replay queues none', async () => {
    const origin = await uploadSale()
    const row = await submissionRow(origin.submissionId)

    expect(row?.status).toBe('QUEUED')
    expect(row?.attempts).toBe(0)
    expect(row?.kind).toBe('INVOICE')
    expect(row?.provider).toBe('MOCK')
    expect(
      (row?.dueAt.getTime() ?? 0) -
        (row
          ? ((
              await db.select().from(sale).where(eq(sale.id, origin.saleId))
            )[0]?.occurredAt.getTime() ?? 0)
          : 0),
    ).toBe(24 * 60 * 60 * 1000)
    expect(origin.doorbells).toEqual([origin.submissionId])

    // The same batch again: the reservation sees the client transaction and
    // answers REPLAYED, so no second row and no second doorbell.
    const replayed: string[] = []
    const replay = await applyUpload(deviceContext(), origin.body, {
      enqueueEvat: async (id) => {
        replayed.push(id)
      },
    })
    expect(replay.results[0]?.status).toBe('REPLAYED')
    expect(replayed).toEqual([])
    const rows = await db
      .select()
      .from(evatSubmission)
      .where(eq(evatSubmission.saleId, origin.saleId))
    expect(rows).toHaveLength(1)
  })

  it('a refund waits for its invoice and is released in the transaction that certifies it', async () => {
    const origin = await uploadSale()
    const refundUpload = await uploadRefund(origin)

    expect(refundUpload.status).toBe('WAITING_FOR_INVOICE')
    const waiting = await submissionRow(refundUpload.submissionId)
    expect(waiting?.attempts).toBe(0)

    // Waiting is not a spent attempt: submitting the refund does nothing until
    // its invoice certifies.
    const unchanged = await submitNow(refundUpload.submissionId)
    expect(unchanged?.status).toBe('WAITING_FOR_INVOICE')
    expect(unchanged?.attempts).toBe(0)

    const certified = await submitNow(origin.submissionId)
    expect(certified?.status).toBe('CERTIFIED')
    const released = await submissionRow(refundUpload.submissionId)
    expect(released?.status).toBe('QUEUED')

    const refundCertified = await submitNow(refundUpload.submissionId)
    expect(refundCertified?.status).toBe('CERTIFIED')
    expect(refundCertified?.attempts).toBe(1)
  })

  it('certification stores all eight fields and leaves sale and refund byte-identical', async () => {
    const origin = await uploadSale([{ productId, quantity: 2, unitPriceMinor: 4_000 }])
    const refundUpload = await uploadRefund(origin)

    const before = await documentSnapshot(origin.saleId, refundUpload.refundId)
    expect(await submitNow(origin.submissionId)).toMatchObject({ status: 'CERTIFIED' })
    expect(await submitNow(refundUpload.submissionId)).toMatchObject({
      status: 'CERTIFIED',
    })
    const after = await documentSnapshot(origin.saleId, refundUpload.refundId)

    // A certificate is a separate fact: not one byte of either document moved.
    expect(after).toEqual(before)
    expect(after.sale).toBe(before.sale)
    expect(after.refund).toBe(before.refund)

    const invoice = await submissionRow(origin.submissionId)
    expect(invoice).toMatchObject({
      status: 'CERTIFIED',
      providerInvoiceNumber: origin.receiptNumber,
      signature: expectedSignature(origin.receiptNumber),
      lastErrorCode: null,
    })
    expect(invoice?.serial).toMatch(/^MOCK-\d{8}$/)
    expect(invoice?.sdcId).toMatch(/^SDC-MOCK-[0-9A-F]{8}$/)
    expect(invoice?.internalData).toMatch(/^MOCK-[0-9A-F]{16}$/)
    expect(invoice?.machineCode).toMatch(/^MRC-MOCK-[0-9A-F]{8}$/)
    expect(invoice?.stampedAt).toBeInstanceOf(Date)
    expect(invoice?.qrPayload).toBe(
      `https://evat.mock.invalid/verify?data=${encodeURIComponent(origin.receiptNumber)}`,
    )
    expect(invoice?.certifiedAt).toBeInstanceOf(Date)

    const creditNote = await submissionRow(refundUpload.submissionId)
    expect(creditNote?.providerInvoiceNumber).toBe(refundUpload.number)
    expect(creditNote?.kind).toBe('REFUND')
  })

  it('never composes a QR payload itself', () => {
    const source = readFileSync(new URL('./evat.service.ts', import.meta.url), 'utf8')
    // The QR bytes are the provider's. A URL literal in the service would be us
    // inventing a verification page, which P14-D35 forbids.
    expect(source).not.toMatch(/https?:\/\//)
  })

  it('walks the retry ladder at 1, 2 and 5 minutes', async () => {
    const origin = await uploadSale()
    const delays = EVAT_RETRY_DELAYS_MINUTES
    expect([delays[0], delays[1], delays[2]]).toEqual([1, 2, 5])

    for (const [index, minutes] of [1, 2, 5].entries()) {
      failNextMockSubmission('E500', true, 'GRA is busy')
      const row = await submitNow(origin.submissionId)
      expect(row?.status).toBe('RETRY')
      expect(row?.attempts).toBe(index + 1)
      expect(row?.lastErrorCode).toBe('E500')
      const submittedAt = row?.submittedAt?.getTime() ?? 0
      const nextAttemptAt = row?.nextAttemptAt?.getTime() ?? 0
      expect(nextAttemptAt - submittedAt).toBe((minutes ?? 0) * 60_000)
      // The lock is released, so the next attempt may read the row again.
    }
  })

  it('the eighth failure becomes ATTENTION and there is no ninth attempt', async () => {
    const origin = await uploadSale()

    for (let attempt = 1; attempt <= EVAT_MAX_ATTEMPTS; attempt += 1) {
      failNextMockSubmission('E500', true, 'GRA is busy')
      const row = await submitNow(origin.submissionId)
      expect(row?.attempts).toBe(attempt)
      expect(row?.status).toBe(attempt < EVAT_MAX_ATTEMPTS ? 'RETRY' : 'ATTENTION')
    }

    const callsBefore = getMockEvatCallCounts().certify
    const refused = await submitNow(origin.submissionId)
    expect(refused?.status).toBe('ATTENTION')
    expect(refused?.attempts).toBe(EVAT_MAX_ATTEMPTS)
    expect(getMockEvatCallCounts().certify).toBe(callsBefore)
  })

  it('E700 adopts the certificate the provider can look up', async () => {
    const origin = await uploadSale()
    failNextMockSubmission('E700')

    const row = await submitNow(origin.submissionId)
    expect(row?.status).toBe('CERTIFIED')
    expect(row?.providerInvoiceNumber).toBe(origin.receiptNumber)
    expect(row?.signature).toBe(expectedSignature(origin.receiptNumber))
    expect(getMockEvatCallCounts().fetch).toBe(1)
  })

  it('E700 without a lookup becomes ATTENTION with GRA’s code', async () => {
    const origin = await uploadSale()
    const withoutLookup: EInvoicingProvider = {
      name: 'GRA',
      healthCheck: async () => ({ ok: true }),
      certify: async () => ({
        ok: false,
        code: 'E700',
        message: 'GRA has already signed this document',
        retryable: false,
      }),
    }
    setEvatProviderForTests(withoutLookup)

    const row = await submitNow(origin.submissionId)
    expect(row?.status).toBe('ATTENTION')
    expect(row?.lastErrorCode).toBe('E700')
    expect(row?.nextAttemptAt).toBeNull()
  })

  it('E700 with a lookup that knows nothing becomes ATTENTION with E700', async () => {
    const origin = await uploadSale()
    setEvatProviderForTests({
      name: 'GRA',
      healthCheck: async () => ({ ok: true }),
      certify: async () => ({
        ok: false,
        code: 'E700',
        message: 'GRA has already signed this document',
        retryable: false,
      }),
      fetchCertificate: async () => null,
    })

    const row = await submitNow(origin.submissionId)
    expect(row?.status).toBe('ATTENTION')
    expect(row?.lastErrorCode).toBe('E700')
  })

  it('E900 is ATTENTION immediately even when the provider calls it retryable', async () => {
    const origin = await uploadSale()
    failNextMockSubmission('E900', true)

    const row = await submitNow(origin.submissionId)
    expect(row?.status).toBe('ATTENTION')
    expect(row?.lastErrorCode).toBe('E900')
    expect(row?.attempts).toBe(1)
    expect(row?.nextAttemptAt).toBeNull()
  })

  it('a certificate missing a field becomes ATTENTION with CERTIFICATE_INCOMPLETE', async () => {
    const origin = await uploadSale()
    setEvatProviderForTests({
      name: 'GRA',
      healthCheck: async () => ({ ok: true }),
      certify: async () => ({
        ok: true,
        certificate: {
          providerInvoiceNumber: origin.receiptNumber,
          sdcId: 'SDC-1',
          serial: 'SER-1',
          signature: '',
          internalData: 'DATA',
          machineCode: 'MRC-1',
          stampedAt: new Date().toISOString(),
          qrPayload: 'https://example.invalid/qr',
        },
      }),
    })

    const row = await submitNow(origin.submissionId)
    expect(row?.status).toBe('ATTENTION')
    expect(row?.lastErrorCode).toBe('CERTIFICATE_INCOMPLETE')
    expect(row?.lastErrorMessage).toContain('signature')
    expect(row?.providerInvoiceNumber).toBeNull()
  })

  it('a blank seller TIN is refused before the provider is called', async () => {
    await db.update(setting).set({ value: '' }).where(eq(setting.key, 'tax.sellerTin'))
    try {
      const origin = await uploadSale()
      const callsBefore = getMockEvatCallCounts().certify
      const row = await submitNow(origin.submissionId)
      expect(row?.status).toBe('ATTENTION')
      expect(row?.lastErrorCode).toBe('SELLER_IDENTITY_MISSING')
      expect(row?.lastErrorMessage).toContain('tax.sellerTin')
      expect(getMockEvatCallCounts().certify).toBe(callsBefore)
    } finally {
      await db.update(setting).set({ value: 'C0012345678' }).where(eq(setting.key, 'tax.sellerTin'))
    }
  })

  it('a 25-hour-old RETRY row reads overdue: true', async () => {
    const origin = await uploadSale()
    failNextMockSubmission('E500', true)
    const retrying = await submitNow(origin.submissionId)
    expect(retrying?.status).toBe('RETRY')

    // The deadline is a column, so 25 hours past the document is a backdated
    // `due_at` — nothing about the status changes (P14-D36).
    await db
      .update(evatSubmission)
      .set({ dueAt: new Date(Date.now() - 3_600_000) })
      .where(eq(evatSubmission.id, origin.submissionId))

    const detail = await app.request(`/api/evat/submissions/${origin.submissionId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(detail.status).toBe(200)
    const body = await readJson<{ submission: { status: string; overdue: boolean } }>(detail)
    expect(body.submission.status).toBe('RETRY')
    expect(body.submission.overdue).toBe(true)

    const listed = await app.request('/api/evat/submissions?overdue=true&limit=200', {
      headers: authedHeaders(adminCookie),
    })
    expect(listed.status).toBe(200)
    const page = await readJson<{ submissions: Array<{ id: string; overdue: boolean }> }>(listed)
    expect(page.submissions.map((row) => row.id)).toContain(origin.submissionId)
    expect(page.submissions.every((row) => row.overdue)).toBe(true)
  })

  it('flag.evatSubmission=false queues nothing new and still certifies an existing row', async () => {
    const queued = await uploadSale()

    await db.insert(setting).values({ key: 'flag.evatSubmission', value: false, branchId: null })
    try {
      const suppressed = await uploadSale()
      expect(suppressed.submissionId).toBe('')
      expect(suppressed.doorbells).toEqual([])
      const rows = await db
        .select()
        .from(evatSubmission)
        .where(eq(evatSubmission.saleId, suppressed.saleId))
      expect(rows).toHaveLength(0)

      // The flag turns off the intake, not the obligation.
      const certified = await submitNow(queued.submissionId)
      expect(certified?.status).toBe('CERTIFIED')
    } finally {
      await db.delete(setting).where(eq(setting.key, 'flag.evatSubmission'))
    }
  })

  it('a manager reads their own branch and is refused another', async () => {
    const origin = await uploadSale()

    const own = await app.request(`/api/evat/submissions?branchId=${branchId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(own.status).toBe(200)
    const page = await readJson<{
      submissions: Array<{ id: string; branchId: string }>
      branchId: string
    }>(own)
    expect(page.branchId).toBe(branchId)
    expect(page.submissions.every((row) => row.branchId === branchId)).toBe(true)
    expect(page.submissions.map((row) => row.id)).toContain(origin.submissionId)

    const foreign = await app.request(`/api/evat/submissions?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(foreign.status).toBe(403)
  })

  it('a manager cannot retry and an admin can, with an audit row', async () => {
    const origin = await uploadSale()
    failNextMockSubmission('E900')
    const attention = await submitNow(origin.submissionId)
    expect(attention?.status).toBe('ATTENTION')
    const attempts = attention?.attempts ?? 0

    const managerRetry = await app.request(`/api/evat/submissions/${origin.submissionId}/retry`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    expect(managerRetry.status).toBe(403)

    const adminRetry = await app.request(`/api/evat/submissions/${origin.submissionId}/retry`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(adminRetry.status).toBe(200)
    const body = await readJson<{ submission: { status: string; attempts: number } }>(adminRetry)
    expect(body.submission.status).toBe('QUEUED')
    // The attempt count is history, not state to be reset.
    expect(body.submission.attempts).toBe(attempts)

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'evat.submission.retried'))
    expect(audits.some((row) => row.entityId === origin.submissionId)).toBe(true)
  })

  it('a worker run certifies the rows around one that throws', async () => {
    const first = await uploadSale()
    const second = await uploadSale()
    const third = await uploadSale()

    // The middle document's provider call explodes. `submit` turns that into a
    // retryable refusal, and the batch must still finish the other two.
    setEvatProviderForTests({
      name: 'GRA',
      healthCheck: async () => ({ ok: true }),
      certify: async (document) => {
        if (document.documentNumber === second.receiptNumber) {
          throw new Error('socket hang up')
        }
        return {
          ok: true,
          certificate: {
            providerInvoiceNumber: document.documentNumber,
            sdcId: 'SDC-W',
            serial: 'SER-W',
            signature: expectedSignature(document.documentNumber),
            internalData: 'DATA-W',
            machineCode: 'MRC-W',
            stampedAt: document.occurredAt.toISOString(),
            qrPayload: 'https://evat.mock.invalid/worker',
          },
        }
      },
    })

    const summary = await evatService.processEvatSubmissions({ limit: 200 })
    expect(summary.processed).toBeGreaterThanOrEqual(3)

    expect((await submissionRow(first.submissionId))?.status).toBe('CERTIFIED')
    expect((await submissionRow(third.submissionId))?.status).toBe('CERTIFIED')
    const failed = await submissionRow(second.submissionId)
    expect(failed?.status).toBe('RETRY')
    expect(failed?.lastErrorCode).toBe('PROVIDER_UNAVAILABLE')
  })

  it('the sweep promotes a waiting refund whose invoice certified', async () => {
    const origin = await uploadSale()
    const refundUpload = await uploadRefund(origin)
    expect(refundUpload.status).toBe('WAITING_FOR_INVOICE')

    await submitNow(origin.submissionId)
    // Simulate the crash the sweep exists for: the invoice is certified but the
    // release never committed.
    await db
      .update(evatSubmission)
      .set({ status: 'WAITING_FOR_INVOICE' })
      .where(eq(evatSubmission.id, refundUpload.submissionId))

    const summary = await evatService.processEvatSubmissions({ limit: 200 })
    expect(summary.promoted).toBeGreaterThanOrEqual(1)
    expect((await submissionRow(refundUpload.submissionId))?.status).toBe('CERTIFIED')
  })

  it('health is cached for a minute and a failure is reported, not thrown', async () => {
    const first = await app.request('/api/evat/health', { headers: authedHeaders(adminCookie) })
    expect(first.status).toBe(200)
    const firstBody = await readJson<{ health: { ok: boolean; cached: boolean } }>(first)
    expect(firstBody.health.ok).toBe(true)
    expect(firstBody.health.cached).toBe(false)

    const second = await app.request('/api/evat/health', { headers: authedHeaders(adminCookie) })
    const secondBody = await readJson<{ health: { ok: boolean; cached: boolean } }>(second)
    expect(secondBody.health.cached).toBe(true)
    expect(getMockEvatCallCounts().health).toBe(1)

    makeMockHealthFail()
    evatService.resetEvatHealthCache()
    const third = await app.request('/api/evat/health', { headers: authedHeaders(adminCookie) })
    expect(third.status).toBe(200)
    const thirdBody = await readJson<{ health: { ok: boolean; detail?: string } }>(third)
    expect(thirdBody.health.ok).toBe(false)
    expect(thirdBody.health.detail).toContain('health check fails')
  })

  it('the summary counts the states for the caller', async () => {
    const certified = await uploadSale()
    await submitNow(certified.submissionId)
    const pending = await uploadSale()

    const response = await app.request('/api/evat/summary', {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const summary = await readJson<{
      queued: number
      certified: number
      retrying: number
      attention: number
      overdue: number
      oldestOverdueMinutes: number | null
    }>(response)
    expect(summary.certified).toBeGreaterThanOrEqual(1)
    expect(summary.queued).toBeGreaterThanOrEqual(1)
    // The earlier 25-hour case is still uncertified, so the summary reports the
    // late document and how long it has been late: overdue is derived, not stored.
    expect(summary.overdue).toBeGreaterThanOrEqual(1)
    expect(summary.oldestOverdueMinutes).toBeGreaterThanOrEqual(60)
    expect((await submissionRow(pending.submissionId))?.status).toBe('QUEUED')
  })

  it('EVAT_PROVIDER=gra refuses to boot without a URL or a key', () => {
    const base = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
    }

    expect(() => parseEnv({ ...base, EVAT_PROVIDER: 'gra' })).toThrow(/EVAT_BASE_URL/)
    expect(() =>
      parseEnv({ ...base, EVAT_PROVIDER: 'gra', EVAT_BASE_URL: 'https://evat.example.test' }),
    ).toThrow(/EVAT_SECURITY_KEY/)
    const configured = parseEnv({
      ...base,
      EVAT_PROVIDER: 'gra',
      EVAT_BASE_URL: 'https://evat.example.test',
      EVAT_SECURITY_KEY: 'a-security-key',
      EVAT_TIMEOUT_MS: '5000',
    })
    expect(configured.EVAT_PROVIDER).toBe('gra')
    expect(configured.EVAT_TIMEOUT_MS).toBe(5_000)
    // The mock needs neither, and the timeout keeps its bound.
    expect(parseEnv(base).EVAT_PROVIDER).toBe('mock')
    expect(parseEnv(base).EVAT_TIMEOUT_MS).toBe(10_000)
    expect(() => parseEnv({ ...base, EVAT_TIMEOUT_MS: '500' })).toThrow(/EVAT_TIMEOUT_MS/)
  })
})
