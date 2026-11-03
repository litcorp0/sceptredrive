import { createHmac } from 'node:crypto'
import { db } from '@sceptre/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { databaseAvailable, randomToken } from '../../../test/integration.ts'
import { factory } from '../../http/factory.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { findRefundTenderByIdForUpdate } from '../pos/pos.repository.ts'
import { refund, refundTender, sale, saleTender, shift } from '../pos/pos.schema.ts'
import { getMockCallCounts, resetMockProvider } from './payments.mock.provider.ts'
import { payment } from './payments.schema.ts'
import {
  applyProviderRefund,
  dispatchPendingRefunds,
  REFUND_EVENT_NAMES,
} from './payments.service.ts'
import { createPaystackWebhookRoutes } from './payments.webhook.routes.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[payments.refund.test] database unavailable; integration tests skipped')

const WEBHOOK_SECRET = 'refund-webhook-secret-value-32-chars'
const suffix = randomToken(5)

/**
 * The electronic half of a refund (P13-D26).
 *
 * The document is written `PENDING` inside the upload; only the dispatch job and
 * the webhook move it, and both are idempotent. A `SETTLED` row is terminal: a
 * late or replayed event must never un-settle money a customer already has.
 */
describe.skipIf(!available)('payments — refund dispatch and settlement', () => {
  const createdPaymentIds: string[] = []
  const createdRefundIds: string[] = []
  const createdSaleIds: string[] = []
  const createdShiftIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdBranchIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let sequence = 0

  const webhookApp = factory.createApp()
  webhookApp.route('/', createPaystackWebhookRoutes({ secret: WEBHOOK_SECRET }))

  function signatureFor(rawBody: string): string {
    return createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex')
  }

  async function postWebhook(body: unknown): Promise<Response> {
    const raw = JSON.stringify(body)
    return webhookApp.request('/api/payments/webhook/paystack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': signatureFor(raw) },
      body: raw,
    })
  }

  interface ElectronicRefund {
    paymentId: string
    providerReference: string
    refundId: string
    refundTenderId: string
  }

  /**
   * The smallest honest set of rows the provider path needs: one paid card
   * payment, one sale tender pointing at it, and one refund tender waiting for
   * the provider. The refund document itself is exercised in `pos.refund.test`.
   */
  async function electronicRefund(): Promise<ElectronicRefund> {
    sequence += 1
    const providerReference = `sd-refund-${suffix}-${sequence}`
    const amountMinor = 4_000

    const [paymentRow] = await db
      .insert(payment)
      .values({
        branchId,
        terminalId,
        deviceId,
        shiftId,
        clientPaymentId: crypto.randomUUID(),
        cashierUserId: `cashier-${suffix}`,
        cashierStaffId: `SD-${suffix}`,
        method: 'CARD',
        amountMinor,
        provider: 'PAYSTACK',
        providerReference,
        providerEmail: `pos+${suffix}@sceptre-drive.example`,
        status: 'PAID',
        channel: 'card',
        paidAt: new Date(),
      })
      .returning()
    const paymentId = paymentRow?.id ?? ''
    createdPaymentIds.push(paymentId)

    const saleId = crypto.randomUUID()
    createdSaleIds.push(saleId)
    await db.insert(sale).values({
      id: saleId,
      receiptNumber: `RFW-${suffix}-${sequence}`,
      branchId,
      terminalId,
      deviceId,
      shiftId,
      clientTransactionId: saleId,
      cashierUserId: `cashier-${suffix}`,
      cashierStaffId: `SD-${suffix}`,
      occurredAt: new Date(),
      subtotalMinor: amountMinor,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: amountMinor,
      tenderTotalMinor: amountMinor,
      changeMinor: 0,
      taxMode: 'INCLUSIVE',
    })

    const [saleTenderRow] = await db
      .insert(saleTender)
      .values({
        saleId,
        sequence: 1,
        method: 'CARD',
        amountMinor,
        paymentId,
        reference: providerReference,
      })
      .returning()

    const refundId = crypto.randomUUID()
    createdRefundIds.push(refundId)
    await db.insert(refund).values({
      id: refundId,
      number: `RF-${suffix}-${sequence}`,
      saleId,
      branchId,
      terminalId,
      deviceId,
      shiftId,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      refundedMinor: amountMinor,
      baseMinor: 3_333,
      vatMinor: 500,
      nhilMinor: 84,
      getfundMinor: 83,
      taxTotalMinor: 667,
      approvedByUserId: `manager-${suffix}`,
      approvedByStaffId: `SD-M-${suffix}`,
      approvalPinVersion: 1,
      approvalReasonCode: 'RETURN',
      approvedAt: new Date(),
      occurredAt: new Date(),
    })

    const [tenderRow] = await db
      .insert(refundTender)
      .values({
        refundId,
        sequence: 1,
        method: 'CARD',
        amountMinor,
        saleTenderId: saleTenderRow?.id ?? '',
        paymentId,
        status: 'PENDING',
        // Backdated past the worker's 2-second guard.
        createdAt: new Date(Date.now() - 10_000),
      })
      .returning()

    return {
      paymentId,
      providerReference,
      refundId,
      refundTenderId: tenderRow?.id ?? '',
    }
  }

  async function tenderState(refundTenderId: string) {
    const rows = await db.select().from(refundTender).where(eq(refundTender.id, refundTenderId))
    return rows[0]
  }

  beforeAll(async () => {
    const [branchRow] = await db
      .insert(branch)
      .values({
        code: `P${suffix}`,
        name: `Refund Webhook ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning()
    branchId = branchRow?.id ?? ''
    createdBranchIds.push(branchId)

    const [terminalRow] = await db
      .insert(terminal)
      .values({ branchId, code: `P${suffix}-T01`, name: 'Refund Webhook Counter' })
      .returning()
    terminalId = terminalRow?.id ?? ''
    createdTerminalIds.push(terminalId)

    const [deviceRow] = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `refund-webhook-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow?.id ?? ''
    createdDeviceIds.push(deviceId)

    const [shiftRow] = await db
      .insert(shift)
      .values({
        number: `RFW-${suffix}-S-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId: `cashier-${suffix}`,
        cashierStaffId: `SD-${suffix}`,
        status: 'OPEN',
        openedAt: new Date(),
        openingFloatMinor: 0,
        openedBy: `SD-${suffix}`,
      })
      .returning()
    shiftId = shiftRow?.id ?? ''
    createdShiftIds.push(shiftId)
  })

  beforeEach(() => {
    resetMockProvider()
  })

  afterAll(async () => {
    if (createdRefundIds.length > 0) {
      await db.delete(refundTender).where(inArray(refundTender.refundId, createdRefundIds))
      await db.delete(refund).where(inArray(refund.id, createdRefundIds))
    }
    if (createdSaleIds.length > 0) {
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    // Refund events carry no payment id, so the suite clears its own events by
    // the event type it is the only producer of.
    await db.execute(sql`DELETE FROM payment_event WHERE event_type LIKE 'refund.%'`)
    if (createdShiftIds.length > 0) await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    if (createdDeviceIds.length > 0)
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    if (createdTerminalIds.length > 0)
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    if (createdBranchIds.length > 0)
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
  })

  it('dispatches once and never twice, however often the job runs', async () => {
    const fixture = await electronicRefund()

    const first = await dispatchPendingRefunds()
    expect(first.dispatched).toBe(1)

    const afterFirst = await tenderState(fixture.refundTenderId)
    expect(afterFirst?.status).toBe('PENDING')
    expect(afterFirst?.providerRefundReference).toBe(`mock-refund-${fixture.providerReference}`)
    expect(getMockCallCounts().refund).toBe(1)

    // The second run sees a tender that already carries a provider reference.
    await dispatchPendingRefunds()
    expect(getMockCallCounts().refund).toBe(1)
  })

  it('settles on refund.processed and changes nothing on a replay', async () => {
    const fixture = await electronicRefund()

    const body = {
      event: 'refund.processed',
      data: {
        refund_reference: `mock-refund-${fixture.providerReference}`,
        transaction_reference: fixture.providerReference,
        amount: 4_000,
        currency: 'GHS',
        status: 'processed',
        gateway_response: 'Refund successful',
      },
    }

    const first = await postWebhook(body)
    expect(first.status).toBe(200)

    const settled = await tenderState(fixture.refundTenderId)
    expect(settled?.status).toBe('SETTLED')
    expect(settled?.settledAt).not.toBeNull()

    // The unique body hash makes a redelivery a no-op that still answers 200.
    const replay = await postWebhook(body)
    expect(replay.status).toBe(200)
    const after = await tenderState(fixture.refundTenderId)
    expect(after).toEqual(settled)
  })

  it('finds an undispatched tender by the charge reference and the amount', async () => {
    const fixture = await electronicRefund()

    const response = await postWebhook({
      event: 'refund.processed',
      data: {
        // No refund_reference yet: dispatch has not stored one in this case.
        transaction_reference: fixture.providerReference,
        amount: 4_000,
        currency: 'GHS',
        status: 'processed',
      },
    })
    expect(response.status).toBe(200)

    const settled = await tenderState(fixture.refundTenderId)
    expect(settled?.status).toBe('SETTLED')
  })

  it('records a failed refund with its message and an audit row', async () => {
    const fixture = await electronicRefund()

    const response = await postWebhook({
      event: 'refund.failed',
      data: {
        transaction_reference: fixture.providerReference,
        amount: 4_000,
        status: 'failed',
        gateway_response: 'The refund could not be completed',
      },
    })
    expect(response.status).toBe(200)

    const failed = await tenderState(fixture.refundTenderId)
    expect(failed?.status).toBe('FAILED')
    expect(failed?.failedMessage).toBe('The refund could not be completed')

    const audited = await db.execute<{ value: string }>(sql`
      SELECT count(*)::text AS value FROM audit_log
      WHERE action = 'pos.refund.failed' AND entity_id = ${fixture.refundTenderId}
    `)
    expect(Number(audited.rows[0]?.value ?? 0)).toBe(1)
  })

  it('surfaces a needs-attention refund and settles only on a later processed event', async () => {
    const fixture = await electronicRefund()
    const refundReference = `mock-refund-${fixture.providerReference}`
    const base = {
      refund_reference: refundReference,
      transaction_reference: fixture.providerReference,
      amount: 4_000,
    }

    // The first event is what teaches us the provider's refund reference.
    await postWebhook({
      event: 'refund.pending',
      data: { ...base, status: 'pending' },
    })
    expect((await tenderState(fixture.refundTenderId))?.providerRefundReference).toBe(
      refundReference,
    )

    await postWebhook({
      event: 'refund.needs-attention',
      data: {
        ...base,
        status: 'needs-attention',
        gateway_response: 'The customer account was closed',
      },
    })
    const attention = await tenderState(fixture.refundTenderId)
    expect(attention?.status).toBe('NEEDS_ATTENTION')
    expect(attention?.failedMessage).toBe('The customer account was closed')

    // Once the same refund is identified, the provider's own settlement wins.
    await postWebhook({
      event: 'refund.processed',
      data: { ...base, status: 'processed' },
    })
    expect((await tenderState(fixture.refundTenderId))?.status).toBe('SETTLED')
  })

  it('treats a settled refund as terminal', async () => {
    const fixture = await electronicRefund()

    await postWebhook({
      event: 'refund.processed',
      data: {
        transaction_reference: fixture.providerReference,
        amount: 4_000,
        status: 'processed',
      },
    })

    await postWebhook({
      event: 'refund.failed',
      data: {
        transaction_reference: fixture.providerReference,
        amount: 4_000,
        status: 'failed',
        gateway_response: 'A late failure',
      },
    })

    const state = await tenderState(fixture.refundTenderId)
    expect(state?.status).toBe('SETTLED')

    // The writer itself refuses to downgrade, so a stale row cannot either.
    await db.transaction(async (tx) => {
      const locked = await findRefundTenderByIdForUpdate(fixture.refundTenderId, tx)
      expect(locked).not.toBeNull()
      if (locked) {
        await applyProviderRefund(tx, locked, {
          reference: fixture.providerReference,
          status: 'failed',
          refundReference: null,
          expectedAt: null,
        })
      }
    })
    expect((await tenderState(fixture.refundTenderId))?.status).toBe('SETTLED')
  })

  it('knows the five refund event names and nothing else', () => {
    expect([...REFUND_EVENT_NAMES].sort()).toEqual([
      'refund.failed',
      'refund.needs-attention',
      'refund.pending',
      'refund.processed',
      'refund.processing',
    ])
  })
})
