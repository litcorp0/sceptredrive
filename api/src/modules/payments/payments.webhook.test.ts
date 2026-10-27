import { createHmac } from 'node:crypto'
import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable, randomToken } from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { factory } from '../../http/factory.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { shift, syncConflict } from '../pos/pos.schema.ts'
import { payment, paymentEvent } from './payments.schema.ts'
import { createPaystackWebhookRoutes } from './payments.webhook.routes.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[payments.webhook.test] database unavailable; integration tests skipped')

const WEBHOOK_SECRET = 'test-webhook-secret-value-32-characters'

interface ChargeBodyOverrides {
  event?: string
  amount?: number
  currency?: string
  data?: Record<string, unknown>
}

function chargeBody(reference: string, overrides: ChargeBodyOverrides = {}) {
  const success = (overrides.event ?? 'charge.success') === 'charge.success'
  return {
    event: overrides.event ?? 'charge.success',
    data: {
      id: 123456789012345,
      reference,
      status: success ? 'success' : 'failed',
      amount: overrides.amount ?? 5_000,
      currency: overrides.currency ?? 'GHS',
      channel: 'mobile_money',
      paid_at: '2026-10-27T10:05:00.000Z',
      gateway_response: success ? 'Successful' : 'Declined by issuer',
      // Everything below must not reach `payment_event.detail` (P13-D15).
      authorization: {
        authorization_code: 'AUTH_mock',
        bin: '408408',
        last4: '4081',
        card_type: 'visa',
      },
      customer: { email: 'buyer@example.com', phone: '+233241234567' },
      ...overrides.data,
    },
  }
}

function signatureFor(rawBody: string): string {
  return createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex')
}

describe.skipIf(!available)('Paystack webhook', () => {
  const suffix = randomToken(4)
  const createdPaymentIds: string[] = []
  const createdReferences: string[] = []
  const createdShiftIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdBranchIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let terminalCode = ''
  let cashierUserId = ''
  let cashierStaffId = ''

  const webhookApp = factory.createApp()
  webhookApp.route('/', createPaystackWebhookRoutes({ secret: WEBHOOK_SECRET }))

  async function insertPaymentRow(options: {
    reference: string
    amountMinor?: number
    status?: 'PENDING' | 'EXPIRED'
    shiftId?: string
  }): Promise<string> {
    const id = crypto.randomUUID()
    const clientPaymentId = crypto.randomUUID()
    await db.insert(payment).values({
      id,
      branchId,
      terminalId,
      deviceId,
      shiftId: options.shiftId ?? shiftId,
      clientPaymentId,
      cashierUserId,
      cashierStaffId,
      method: 'MOMO',
      amountMinor: options.amountMinor ?? 5_000,
      provider: 'PAYSTACK',
      providerReference: options.reference,
      providerEmail: `pos+${terminalCode}-${clientPaymentId}@sceptre-drive.example`,
      status: options.status ?? 'PENDING',
    })
    createdPaymentIds.push(id)
    createdReferences.push(options.reference)
    return id
  }

  async function insertExtraShift(label: string): Promise<string> {
    const id = crypto.randomUUID()
    await db.insert(shift).values({
      id,
      number: `${suffix}-${label}`,
      branchId,
      terminalId,
      deviceId,
      cashierUserId,
      cashierStaffId,
      status: 'OPEN',
      openedAt: new Date('2026-10-27T08:00:00Z'),
      openingFloatMinor: 0,
    })
    createdShiftIds.push(id)
    return id
  }

  function send(
    body: unknown | string,
    options: { signature?: string | null; target?: typeof webhookApp } = {},
  ) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.signature !== null) {
      headers['x-paystack-signature'] = options.signature ?? signatureFor(rawBody)
    }
    return (options.target ?? webhookApp).request('/api/payments/webhook/paystack', {
      method: 'POST',
      headers,
      body: rawBody,
    })
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({
        code: `${suffix}W`,
        name: `Webhook Branch ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning()
    branchId = branchRow[0]?.id ?? ''
    createdBranchIds.push(branchId)

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `${suffix}-WH`, name: `Webhook ${suffix}` })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''
    terminalCode = terminalRow[0]?.code ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `webhook-${suffix}`,
        tokenHash: crypto.randomUUID(),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    cashierUserId = `cashier-${suffix}`
    cashierStaffId = `GA-WH-${suffix}`

    const shiftRow = await db
      .insert(shift)
      .values({
        id: crypto.randomUUID(),
        number: `${suffix}-WH-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        // The webhook never asks whether the shift is open; closing it here
        // leaves room for a per-test OPEN shift under the one-open rule.
        status: 'CLOSED',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 0,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''
    createdShiftIds.push(shiftId)
  })

  afterAll(async () => {
    if (createdReferences.length > 0) {
      await db
        .delete(paymentEvent)
        .where(inArray(paymentEvent.providerReference, createdReferences))
    }
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    if (createdShiftIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.shiftId, createdShiftIds))
      await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    }
    if (createdDeviceIds.length > 0) {
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('applies a valid charge.success and stores only the allowlisted projection', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })

    const response = await send(chargeBody(reference))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]).toMatchObject({
      status: 'PAID',
      channel: 'mobile_money',
      providerTransactionId: '123456789012345',
      orphaned: false,
    })
    expect(rows[0]?.paidAt).not.toBeNull()

    const events = await db.select().from(paymentEvent).where(eq(paymentEvent.paymentId, paymentId))
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('charge.success')
    expect(events[0]?.status).toBe('PROCESSED')

    const detail = events[0]?.detail as Record<string, unknown>
    expect(detail).toMatchObject({
      reference,
      status: 'success',
      amount: 5_000,
      currency: 'GHS',
      channel: 'mobile_money',
    })
    for (const key of ['authorization', 'customer', 'bin', 'last4']) {
      expect(detail).not.toHaveProperty(key)
    }
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain('408408')
    expect(serialized).not.toContain('4081')
    expect(serialized).not.toContain('buyer@example.com')
    expect(serialized).not.toContain('+233241234567')
  })

  it('returns 200 and changes nothing when the same body is delivered twice', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })
    const body = chargeBody(reference)

    expect((await send(body)).status).toBe(200)
    const first = await db.select().from(payment).where(eq(payment.id, paymentId))
    const firstPaidAt = first[0]?.paidAt?.getTime()

    expect((await send(body)).status).toBe(200)

    const second = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(second[0]?.status).toBe('PAID')
    expect(second[0]?.paidAt?.getTime()).toBe(firstPaidAt)

    const events = await db.select().from(paymentEvent).where(eq(paymentEvent.paymentId, paymentId))
    expect(events).toHaveLength(1)
    expect(events[0]?.status).toBe('PROCESSED')
  })

  it('rejects a bad or missing signature with 401 and writes no event', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })
    const body = chargeBody(reference)

    const bad = await send(body, { signature: '0'.repeat(128) })
    expect(bad.status).toBe(401)

    const missing = await send(body, { signature: null })
    expect(missing.status).toBe(401)

    const events = await db.select().from(paymentEvent).where(eq(paymentEvent.paymentId, paymentId))
    expect(events).toHaveLength(0)

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('mounts on the real app before the session middleware', async () => {
    const response = await app.request('/api/payments/webhook/paystack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '0'.repeat(128),
      },
      body: '{}',
    })
    // 401, not 404 and not a session lookup: the route exists and is not gated
    // by `requireSession`.
    expect(response.status).toBe(401)
  })

  it('raises PAYMENT_AMOUNT_MISMATCH and leaves the status PENDING', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })

    const response = await send(chargeBody(reference, { amount: 4_000 }))
    expect(response.status).toBe(200)

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]?.status).toBe('PENDING')
    expect(rows[0]?.paidAt).toBeNull()

    const conflicts = await db
      .select()
      .from(syncConflict)
      .where(
        and(eq(syncConflict.shiftId, shiftId), eq(syncConflict.type, 'PAYMENT_AMOUNT_MISMATCH')),
      )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.severity).toBe('HIGH')
    expect(conflicts[0]?.details).toMatchObject({
      expectedAmountMinor: 5_000,
      providerAmountMinor: 4_000,
    })

    const events = await db.select().from(paymentEvent).where(eq(paymentEvent.paymentId, paymentId))
    expect(events[0]?.status).toBe('PROCESSED')
  })

  it('marks a bank transfer rejection FAILED even when the amount differs', async () => {
    const rejectedShift = await insertExtraShift('WH-REJECTED')
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference, shiftId: rejectedShift })

    const response = await send({
      event: 'bank.transfer.rejected',
      data: {
        id: 123456789012346,
        reference,
        status: 'failed',
        amount: 4_000,
        currency: 'GHS',
        channel: 'bank_transfer',
        gateway_response: 'The transfer amount did not match the payment',
      },
    })
    expect(response.status).toBe(200)

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]).toMatchObject({
      status: 'FAILED',
      failedMessage: 'The transfer amount did not match the payment',
    })

    const conflicts = await db
      .select()
      .from(syncConflict)
      .where(
        and(
          eq(syncConflict.shiftId, rejectedShift),
          eq(syncConflict.type, 'PAYMENT_AMOUNT_MISMATCH'),
        ),
      )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.severity).toBe('HIGH')
  })

  it('marks a late settlement PAID and orphaned with one HIGH conflict', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference, status: 'EXPIRED' })
    const body = chargeBody(reference)

    expect((await send(body)).status).toBe(200)

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]).toMatchObject({ status: 'PAID', orphaned: true })

    const conflicts = await db
      .select()
      .from(syncConflict)
      .where(
        and(eq(syncConflict.shiftId, shiftId), eq(syncConflict.type, 'PAYMENT_LATE_SETTLEMENT')),
      )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.severity).toBe('HIGH')

    // The replay is the normal case; it must not add a second conflict.
    expect((await send(body)).status).toBe(200)
    const stillOne = await db
      .select()
      .from(syncConflict)
      .where(
        and(eq(syncConflict.shiftId, shiftId), eq(syncConflict.type, 'PAYMENT_LATE_SETTLEMENT')),
      )
    expect(stillOne).toHaveLength(1)
  })

  it('stores an unknown event as IGNORED and still returns 200', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })

    const response = await send({ event: 'subscription.create', data: { reference } })
    expect(response.status).toBe(200)

    const events = await db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.providerReference, reference))
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('IGNORED')
    expect(events[0]?.status).toBe('IGNORED')

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('marks a charge.failed payment FAILED with the provider message', async () => {
    const reference = `sd-${crypto.randomUUID()}`
    const paymentId = await insertPaymentRow({ reference })

    const response = await send(chargeBody(reference, { event: 'charge.failed' }))
    expect(response.status).toBe(200)

    const rows = await db.select().from(payment).where(eq(payment.id, paymentId))
    expect(rows[0]).toMatchObject({
      status: 'FAILED',
      failedMessage: 'Declined by issuer',
    })
  })
})
