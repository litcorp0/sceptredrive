import { createHmac } from 'node:crypto'
import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { AppError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { factory } from '../../http/factory.ts'
import { requestLogger } from '../../http/logging.ts'
import { requestId } from '../../http/request-id.ts'
import { loadSession } from '../../http/session.ts'
import { branch } from '../org/branches.schema.ts'
import {
  getMockTransferByReference,
  resetMockProvider,
} from '../payments/payments.mock.provider.ts'
import { getPaymentProvider } from '../payments/payments.provider.ts'
import { mountPaymentRoutes } from '../payments/payments.routes.ts'
import { paymentEvent } from '../payments/payments.schema.ts'
import { createPaystackWebhookRoutes } from '../payments/payments.webhook.routes.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { supplier, supplierPaymentDetail } from '../suppliers/suppliers.schema.ts'
import {
  supplierInvoice,
  supplierPayment,
  supplierPaymentAllocation,
  supplierTransfer,
  supplierTransferAllocation,
} from './payables.schema.ts'
import * as payablesService from './payables.service.ts'
import type { TransferView } from './payables.types.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[payables.transfer.webhook.test] database unavailable; integration tests skipped')

const WEBHOOK_SECRET = 'test-webhook-secret-value-32-characters'
const suffix = uniqueSuffix()

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function settleTransferRequest(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Every request in this file is answered by an app built here with an explicit
 * mode. `mountPaymentRoutes` defaults to `env.PAYSTACK_MODE`, and vitest reuses a
 * worker across files, so relying on the module-level `app` would make these
 * tests depend on the process env at the moment this file runs (a matrix leg can
 * export `PAYSTACK_MODE=test`). The mode is a test input, never ambient state.
 */
function buildApp(mode: 'mock' | 'test') {
  const harnessApp = factory.createApp()
  harnessApp.use(requestId)
  harnessApp.use(requestLogger)
  harnessApp.use(loadSession)
  // The same projection `app.ts` applies, so statuses and error codes match.
  harnessApp.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.statusCode as 500,
      )
    }
    return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500)
  })
  mountPaymentRoutes(harnessApp, mode)
  return harnessApp
}

const harnessApp = buildApp('mock')

describe('mock settle-transfer route registration', () => {
  it('does not exist when the app is built for test mode', async () => {
    const testMode = buildApp('test')

    const response = await testMode.request(
      '/api/payments/mock/settle-transfer',
      settleTransferRequest({ reference: 'sdt-any', outcome: 'SUCCESS' }),
    )
    expect(response.status).toBe(404)
  })

  it('exists but is session-gated when the app is built for mock mode', async () => {
    const response = await harnessApp.request(
      '/api/payments/mock/settle-transfer',
      settleTransferRequest({ reference: 'sdt-any', outcome: 'SUCCESS' }),
    )
    expect(response.status).toBe(401)
  })
})

/** A delivery body in Paystack's shape; `failures` is where a reason lives. */
function transferBody(
  event: 'transfer.success' | 'transfer.failed' | 'transfer.reversed',
  reference: string,
  overrides: Record<string, unknown> = {},
) {
  const status = event.split('.')[1]
  return {
    event,
    data: {
      id: 2233445566778899,
      reference,
      status,
      transfer_code: 'TRF_WH_1',
      amount: 50_000,
      currency: 'GHS',
      transferred_at: '2026-10-27T10:05:00.000Z',
      fee_charged: 150,
      // Must never reach `payment_event.detail` (P13-D15 / P14-D28).
      recipient: { recipient_code: 'RCP_wh_secret', details: { account_number: '1234567890' } },
      ...overrides,
    },
  }
}

function signatureFor(rawBody: string): string {
  return createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex')
}

describe.skipIf(!available)('supplier transfer webhook', () => {
  const branchIds: string[] = []
  const supplierIds: string[] = []
  const detailIds: string[] = []
  const invoiceIds: string[] = []
  const transferIds: string[] = []
  const references: string[] = []

  let branchId = ''
  let supplierId = ''
  let paymentDetailId = ''
  let adminUserId = ''
  /** A real session: the mock harness routes are `requireSession` + permission. */
  let adminCookie = ''

  const adminUser = {
    id: `webhook-admin-${suffix}`,
    email: `webhook-${suffix}@sceptre.test`,
    name: 'Webhook Admin',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'ADMIN',
    branchId: null,
    staffId: null,
    phone: null,
    isActive: true,
    mustChangePassword: false,
    twoFactorEnabled: false,
    image: null,
  } as SessionUser

  const webhookApp = factory.createApp()
  webhookApp.route('/', createPaystackWebhookRoutes({ secret: WEBHOOK_SECRET }))

  function send(body: unknown | string, options: { signature?: string | null } = {}) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.signature !== null) {
      headers['x-paystack-signature'] = options.signature ?? signatureFor(rawBody)
    }
    return webhookApp.request('/api/payments/webhook/paystack', {
      method: 'POST',
      headers,
      body: rawBody,
    })
  }

  beforeAll(async () => {
    const [createdBranch] = await db
      .insert(branch)
      .values({
        code: `WH${randomToken(2)}`,
        name: `Webhook ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning({ id: branch.id })
    branchId = createdBranch?.id ?? ''
    branchIds.push(branchId)

    const [createdSupplier] = await db
      .insert(supplier)
      .values({ code: `SUP${randomToken(4)}`, name: `Webhook Supplier ${suffix}` })
      .returning({ id: supplier.id })
    supplierId = createdSupplier?.id ?? ''
    supplierIds.push(supplierId)

    const [createdDetail] = await db
      .insert(supplierPaymentDetail)
      .values({
        supplierId,
        method: 'BANK',
        accountName: 'Webhook Supplies',
        accountNumber: `000${randomToken(6)}`,
        bankName: 'Test Bank',
        bankCode: 'TEST',
      })
      .returning({ id: supplierPaymentDetail.id })
    paymentDetailId = createdDetail?.id ?? ''
    detailIds.push(paymentDetailId)

    const admin = await createTestUser({ role: 'ADMIN', name: 'Transfer Harness Admin' })
    adminUserId = admin.id
    adminCookie = await signIn(admin.email)
  })

  afterAll(async () => {
    if (references.length > 0) {
      await db
        .delete(paymentEvent)
        .where(inArray(paymentEvent.providerReference, [...new Set(references)]))
    }
    const paymentIds = (
      transferIds.length === 0
        ? []
        : await db
            .select({ id: supplierPayment.id })
            .from(supplierPayment)
            .where(
              inArray(
                supplierPayment.idempotencyKey,
                transferIds.map((id) => `transfer:${id}`),
              ),
            )
    ).map((row) => row.id)
    if (paymentIds.length > 0) {
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.paymentId, paymentIds))
      await db.delete(supplierPayment).where(inArray(supplierPayment.id, paymentIds))
    }
    if (transferIds.length > 0) {
      await db
        .delete(supplierTransferAllocation)
        .where(inArray(supplierTransferAllocation.transferId, transferIds))
      await db.delete(supplierTransfer).where(inArray(supplierTransfer.id, transferIds))
    }
    if (invoiceIds.length > 0) {
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.invoiceId, invoiceIds))
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
    }
    if (detailIds.length > 0) {
      await db.delete(supplierPaymentDetail).where(inArray(supplierPaymentDetail.id, detailIds))
    }
    if (supplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, supplierIds))
    }
    const entityIds = [...transferIds, ...paymentIds, ...invoiceIds, ...detailIds, ...supplierIds]
    if (entityIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds))
    }
    if (branchIds.length > 0) await db.delete(branch).where(inArray(branch.id, branchIds))
    if (adminUserId) await deleteTestUser(adminUserId)
  })

  /** An open instruction with a 50 000 plan against a 100 000 invoice. */
  async function createScenario(options: { amountMinor?: number; plannedMinor?: number } = {}) {
    const token = randomToken(8)
    const [invoice] = await db
      .insert(supplierInvoice)
      .values({
        number: `INV-WH-${token}`,
        supplierId,
        branchId,
        supplierInvoiceNumber: `WH-${token}`,
        invoiceDate: isoToday(),
        dueDate: isoToday(),
        subtotalMinor: 100_000,
        totalMinor: 100_000,
      })
      .returning({ id: supplierInvoice.id })
    const invoiceId = invoice?.id ?? ''
    invoiceIds.push(invoiceId)

    const reference = `sdt-${crypto.randomUUID()}`
    const [transfer] = await db
      .insert(supplierTransfer)
      .values({
        branchId,
        supplierId,
        paymentDetailId,
        method: 'BANK',
        amountMinor: options.amountMinor ?? 50_000,
        reference,
        idempotencyKey: crypto.randomUUID(),
        provider: 'PAYSTACK',
        reason: 'Webhook fixture',
      })
      .returning({ id: supplierTransfer.id })
    const transferId = transfer?.id ?? ''
    transferIds.push(transferId)
    references.push(reference)

    await db.insert(supplierTransferAllocation).values({
      transferId,
      invoiceId,
      amountMinor: options.plannedMinor ?? 50_000,
    })

    return { transferId, invoiceId, reference }
  }

  async function paymentFor(transferId: string) {
    const rows = await db
      .select()
      .from(supplierPayment)
      .where(eq(supplierPayment.idempotencyKey, `transfer:${transferId}`))
    return rows[0] ?? null
  }

  it('settles a transfer.success into one payment and marks the event processed', async () => {
    const { transferId, invoiceId, reference } = await createScenario()
    const body = transferBody('transfer.success', reference)

    const response = await send(body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })

    const payment = await paymentFor(transferId)
    expect(payment).not.toBeNull()
    expect(payment).toMatchObject({
      supplierId,
      branchId,
      method: 'BANK',
      amountMinor: 50_000,
      reference,
      status: 'COMPLETED',
      createdBy: 'system:paystack',
    })
    expect(payment?.paidAt.toISOString()).toBe('2026-10-27T10:05:00.000Z')

    const allocations = await db
      .select({
        kind: supplierPaymentAllocation.kind,
        amountMinor: supplierPaymentAllocation.amountMinor,
      })
      .from(supplierPaymentAllocation)
      .where(eq(supplierPaymentAllocation.paymentId, payment?.id ?? ''))
    expect(allocations).toEqual([{ kind: 'APPLY', amountMinor: 50_000 }])

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'PARTIAL', amountPaidMinor: 50_000 })

    const [transfer] = await db
      .select()
      .from(supplierTransfer)
      .where(eq(supplierTransfer.id, transferId))
    expect(transfer).toMatchObject({
      status: 'SUCCESS',
      paymentId: payment?.id,
      unallocatedMinor: 0,
      providerTransferCode: 'TRF_WH_1',
      providerTransferId: '2233445566778899',
    })
    expect(transfer?.settledAt).not.toBeNull()

    const events = await db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.providerReference, reference))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'transfer.success',
      status: 'PROCESSED',
      supplierTransferId: transferId,
      paymentId: null,
    })
    expect(events[0]?.detail).toMatchObject({
      reference,
      status: 'success',
      amount: 50_000,
      currency: 'GHS',
    })
    // The allowlisted projection keeps the recipient out (P14-D28).
    expect(JSON.stringify(events[0]?.detail)).not.toContain('RCP_wh_secret')
    expect(JSON.stringify(events[0]?.detail)).not.toContain('1234567890')
  })

  it('stores one event and posts one payment when the same delivery arrives twice', async () => {
    const { transferId, reference } = await createScenario()
    const body = transferBody('transfer.success', reference)

    expect((await send(body)).status).toBe(200)
    const first = await paymentFor(transferId)
    const firstPaidAt = first?.paidAt.getTime()

    expect((await send(body)).status).toBe(200)

    const second = await paymentFor(transferId)
    expect(second?.id).toBe(first?.id)
    expect(second?.paidAt.getTime()).toBe(firstPaidAt)

    const events = await db
      .select({ status: paymentEvent.status })
      .from(paymentEvent)
      .where(eq(paymentEvent.providerReference, reference))
    expect(events).toHaveLength(1)
    expect(events[0]?.status).toBe('PROCESSED')
  })

  it('posts nothing for transfer.failed and leaves the invoice untouched', async () => {
    const { transferId, invoiceId, reference } = await createScenario()
    const body = transferBody('transfer.failed', reference, {
      failures: [{ reason: 'declined', message: 'The recipient account is invalid' }],
    })

    expect((await send(body)).status).toBe(200)
    expect(await paymentFor(transferId)).toBeNull()

    const [transfer] = await db
      .select()
      .from(supplierTransfer)
      .where(eq(supplierTransfer.id, transferId))
    expect(transfer).toMatchObject({
      status: 'FAILED',
      paymentId: null,
      failureCode: 'declined',
      failureMessage: 'The recipient account is invalid',
    })

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'OPEN', amountPaidMinor: 0 })
  })

  it('keeps the payment when a settled transfer is reversed', async () => {
    const { transferId, reference } = await createScenario()
    expect((await send(transferBody('transfer.success', reference))).status).toBe(200)
    const payment = await paymentFor(transferId)
    expect(payment).not.toBeNull()

    expect((await send(transferBody('transfer.reversed', reference))).status).toBe(200)

    const [transfer] = await db
      .select()
      .from(supplierTransfer)
      .where(eq(supplierTransfer.id, transferId))
    expect(transfer).toMatchObject({ status: 'REVERSED', paymentId: payment?.id })

    const [stillThere] = await db
      .select({ status: supplierPayment.status })
      .from(supplierPayment)
      .where(eq(supplierPayment.id, payment?.id ?? ''))
    expect(stillThere?.status).toBe('COMPLETED')

    const detail = await payablesService.getTransfer(adminUser, transferId)
    expect(detail.attention).toBe(true)
    expect(detail.payment?.payment.id).toBe(payment?.id)

    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.entityId, transferId), eq(auditLog.action, 'supplier_transfer.reversed')),
      )
    expect(auditRows).toHaveLength(1)
  })

  it('never posts a payment for a success that arrives after a reversal', async () => {
    const { transferId, reference } = await createScenario()

    expect((await send(transferBody('transfer.reversed', reference))).status).toBe(200)
    expect((await send(transferBody('transfer.success', reference))).status).toBe(200)

    expect(await paymentFor(transferId)).toBeNull()
    const [transfer] = await db
      .select()
      .from(supplierTransfer)
      .where(eq(supplierTransfer.id, transferId))
    expect(transfer).toMatchObject({ status: 'REVERSED', paymentId: null })
  })

  it('ignores a delivery that names no transfer and answers 200', async () => {
    const reference = `sdt-${crypto.randomUUID()}`
    references.push(reference)

    const response = await send(transferBody('transfer.success', reference))
    expect(response.status).toBe(200)

    const events = await db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.providerReference, reference))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'transfer.success',
      status: 'IGNORED',
      supplierTransferId: null,
    })
  })

  it('refuses to post a success whose amount differs from the intent', async () => {
    const { transferId, invoiceId, reference } = await createScenario()
    const body = transferBody('transfer.success', reference, { amount: 50_001 })

    expect((await send(body)).status).toBe(200)
    expect(await paymentFor(transferId)).toBeNull()

    const [transfer] = await db
      .select()
      .from(supplierTransfer)
      .where(eq(supplierTransfer.id, transferId))
    expect(transfer).toMatchObject({ status: 'PENDING', failureCode: 'AMOUNT_MISMATCH' })

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'OPEN', amountPaidMinor: 0 })

    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, transferId),
          eq(auditLog.action, 'supplier_transfer.amount_mismatch'),
        ),
      )
    expect(auditRows).toHaveLength(1)
  })

  it('rejects a bad signature with 401 and writes no event', async () => {
    const { reference } = await createScenario()
    const body = transferBody('transfer.success', reference)

    const bad = await send(body, { signature: '0'.repeat(128) })
    expect(bad.status).toBe(401)

    const missing = await send(body, { signature: null })
    expect(missing.status).toBe(401)

    const events = await db
      .select({ id: paymentEvent.id })
      .from(paymentEvent)
      .where(eq(paymentEvent.providerReference, reference))
    expect(events).toHaveLength(0)
  })

  /**
   * The harness route settles through `applyTransferEvent`, so these cases are
   * the production state machine reached over HTTP — the same writer the webhook
   * above uses.
   */
  describe('settling a transfer over the mock harness route', () => {
    beforeEach(() => {
      resetMockProvider()
    })

    function postSettleTransfer(body: { reference: string; outcome: string }) {
      return harnessApp.request('/api/payments/mock/settle-transfer', {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify(body),
      })
    }

    /** The mock only settles a transfer it issued; this is its `initiateTransfer`. */
    async function registerMockTransfer(reference: string, amountMinor: number) {
      await getPaymentProvider().initiateTransfer({
        reference,
        amountMinor,
        recipientCode: 'RCP_mock_harness',
        reason: 'Harness fixture',
        currency: 'GHS',
      })
    }

    it('posts exactly one payment and moves the transfer to SUCCESS', async () => {
      const { transferId, invoiceId, reference } = await createScenario()
      await registerMockTransfer(reference, 50_000)

      const response = await postSettleTransfer({ reference, outcome: 'SUCCESS' })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        transfer: TransferView
        paymentId: string | null
      }

      expect(body.transfer).toMatchObject({
        id: transferId,
        reference,
        status: 'SUCCESS',
        amountMinor: 50_000,
        unallocatedMinor: 0,
        failureCode: null,
      })
      expect(body.transfer.settledAt).not.toBeNull()
      expect(body.paymentId).not.toBeNull()
      expect(body.transfer.paymentId).toBe(body.paymentId)
      // The view never carries routing state (P14-D28).
      expect(JSON.stringify(body.transfer)).not.toContain('RCP_mock_harness')

      const payments = await db
        .select()
        .from(supplierPayment)
        .where(eq(supplierPayment.idempotencyKey, `transfer:${transferId}`))
      expect(payments).toHaveLength(1)
      expect(payments[0]).toMatchObject({
        id: body.paymentId,
        amountMinor: 50_000,
        reference,
        status: 'COMPLETED',
        createdBy: 'system:paystack',
      })

      const [invoice] = await db
        .select({
          status: supplierInvoice.status,
          amountPaidMinor: supplierInvoice.amountPaidMinor,
        })
        .from(supplierInvoice)
        .where(eq(supplierInvoice.id, invoiceId))
      expect(invoice).toMatchObject({ status: 'PARTIAL', amountPaidMinor: 50_000 })

      // The settlement row proves it went through `applyTransferEvent`.
      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, transferId), eq(auditLog.action, 'supplier_transfer.settled')),
        )
      expect(auditRows).toHaveLength(1)
    })

    it('changes nothing when the same settlement is replayed', async () => {
      const { transferId, invoiceId, reference } = await createScenario()
      await registerMockTransfer(reference, 50_000)

      const firstResponse = await postSettleTransfer({ reference, outcome: 'SUCCESS' })
      expect(firstResponse.status).toBe(200)
      const first = (await firstResponse.json()) as {
        transfer: TransferView
        paymentId: string | null
      }

      const secondResponse = await postSettleTransfer({ reference, outcome: 'SUCCESS' })
      expect(secondResponse.status).toBe(200)
      const second = (await secondResponse.json()) as {
        transfer: TransferView
        paymentId: string | null
      }

      expect(second.paymentId).toBe(first.paymentId)
      expect(second.transfer.settledAt).toBe(first.transfer.settledAt)

      const payments = await db
        .select({ id: supplierPayment.id })
        .from(supplierPayment)
        .where(eq(supplierPayment.idempotencyKey, `transfer:${transferId}`))
      expect(payments).toHaveLength(1)

      const [invoice] = await db
        .select({ amountPaidMinor: supplierInvoice.amountPaidMinor })
        .from(supplierInvoice)
        .where(eq(supplierInvoice.id, invoiceId))
      expect(invoice?.amountPaidMinor).toBe(50_000)
    })

    it('posts nothing for FAILED and leaves the invoice untouched', async () => {
      const { transferId, invoiceId, reference } = await createScenario()
      await registerMockTransfer(reference, 50_000)

      const response = await postSettleTransfer({ reference, outcome: 'FAILED' })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        transfer: TransferView
        paymentId: string | null
      }

      expect(body.transfer).toMatchObject({ id: transferId, status: 'FAILED', paymentId: null })
      expect(body.paymentId).toBeNull()
      expect(await paymentFor(transferId)).toBeNull()

      const [invoice] = await db
        .select({
          status: supplierInvoice.status,
          amountPaidMinor: supplierInvoice.amountPaidMinor,
        })
        .from(supplierInvoice)
        .where(eq(supplierInvoice.id, invoiceId))
      expect(invoice).toMatchObject({ status: 'OPEN', amountPaidMinor: 0 })
    })

    it('answers 404 with a stable code for a reference the mock never issued', async () => {
      const reference = `sdt-${crypto.randomUUID()}`

      const response = await postSettleTransfer({ reference, outcome: 'SUCCESS' })
      expect(response.status).toBe(404)

      const body = (await response.json()) as { error?: { code?: string } }
      expect(body.error?.code).toBe('MOCK_TRANSFER_NOT_FOUND')
    })

    it('rejects an unknown outcome with 400 before the provider moves', async () => {
      const { transferId, reference } = await createScenario()
      await registerMockTransfer(reference, 50_000)

      const response = await postSettleTransfer({ reference, outcome: 'PAID' })
      expect(response.status).toBe(400)

      expect(getMockTransferByReference(reference)?.status).toBe('pending')
      expect(await paymentFor(transferId)).toBeNull()
      const [transfer] = await db
        .select({ status: supplierTransfer.status })
        .from(supplierTransfer)
        .where(eq(supplierTransfer.id, transferId))
      expect(transfer?.status).toBe('PENDING')
    })
  })
})
