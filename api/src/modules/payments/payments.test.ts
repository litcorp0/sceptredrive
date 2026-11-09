import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { env } from '../../config/env.ts'
import { AppError } from '../../http/errors.ts'
import { factory } from '../../http/factory.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { shift, syncConflict } from '../pos/pos.schema.ts'
import { signDeviceJwt } from '../sync/sync.jwt.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import {
  forceMockCheckFailure,
  forceMockVerifyAbandoned,
  getMockCallCounts,
  MOCK_PAYMENT_OTP,
  requestMockPaymentOtp,
  resetMockProvider,
  settleMockPayment,
} from './payments.mock.provider.ts'
import { mountPaymentRoutes } from './payments.routes.ts'
import { payment, paymentEvent } from './payments.schema.ts'
import type { PaymentView } from './payments.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[payments.test] database unavailable; integration tests skipped')

interface TerminalFixture {
  device: DeviceAuthContext
  token: string
  terminalCode: string
}

interface CreateBody {
  clientPaymentId: string
  shiftId: string
  method: 'MOMO' | 'CARD' | 'BANK_TRANSFER'
  amountMinor: number
  mobileMoney?: { provider: 'mtn' | 'atl' | 'vod'; phone: string }
}

const MOMO_EXPIRY_MS = 180_000
const BANK_TRANSFER_EXPIRY_MS = 15 * 60_000
const CARD_EXPIRY_MS = 30 * 60_000
const REFRESH_THROTTLE_MS = 5_000

describe('mock settlement route registration', () => {
  function settleRequest() {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'sd-any', outcome: 'PAID' }),
    }
  }

  it('is absent in test mode and session-gated in mock mode', async () => {
    const testMode = factory.createApp()
    mountPaymentRoutes(testMode, 'test')
    const absent = await testMode.request('/api/payments/mock/settle', settleRequest())
    expect(absent.status).toBe(404)

    const mockMode = factory.createApp()
    // The real app maps AppError to its status; the mini app needs the same seam
    // to prove the route exists rather than merely 500ing.
    mockMode.onError((error, c) => {
      if (error instanceof AppError) {
        return c.json({ error: error.code }, error.statusCode as 500)
      }
      return c.json({ error: 'INTERNAL' }, 500)
    })
    mountPaymentRoutes(mockMode, 'mock')
    const present = await mockMode.request('/api/payments/mock/settle', settleRequest())
    expect(present.status).toBe(401)
  })
})

describe.skipIf(!available)('payment intents and provider state', () => {
  const suffix = randomToken(4)
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []
  const createdUserIds: string[] = []
  const trackedPaymentIds = new Set<string>()

  let branchId = ''
  let deviceA: TerminalFixture
  let deviceB: TerminalFixture
  let deviceC: TerminalFixture
  let shiftA = ''
  let closedShiftA = ''
  let shiftB = ''
  let shiftC = ''
  let adminCookie = ''
  let cashierUserId = ''
  let cashierStaffId = ''

  async function createTerminal(label: string): Promise<TerminalFixture> {
    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `${suffix}-${label}`, name: `Payments ${label} ${suffix}` })
      .returning()
    const terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `payments-${label}-${suffix}`,
        tokenHash: crypto.randomUUID(),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    return {
      device: { deviceId, terminalId, branchId },
      token: await signDeviceJwt({ deviceId, terminalId, branchId }),
      terminalCode: terminalRow[0]?.code ?? '',
    }
  }

  async function insertShift(
    fixture: TerminalFixture,
    label: string,
    status: 'OPEN' | 'CLOSED' = 'OPEN',
  ): Promise<string> {
    const id = crypto.randomUUID()
    await db.insert(shift).values({
      id,
      number: `${suffix}-${label}`,
      branchId,
      terminalId: fixture.device.terminalId,
      deviceId: fixture.device.deviceId,
      cashierUserId,
      cashierStaffId,
      status,
      openedAt: new Date('2026-10-27T08:00:00Z'),
      openingFloatMinor: 0,
    })
    createdShiftIds.push(id)
    return id
  }

  function createBody(overrides: Partial<CreateBody> = {}): CreateBody {
    return {
      clientPaymentId: crypto.randomUUID(),
      shiftId: shiftA,
      method: 'MOMO',
      amountMinor: 5_000,
      mobileMoney: { provider: 'mtn', phone: '024 123 4567' },
      ...overrides,
    }
  }

  function authHeaders(token: string) {
    return { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  }

  function postPayment(body: CreateBody, token = deviceA.token) {
    return app.request('/api/pos/payments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    })
  }

  function getPaymentRequest(id: string, token = deviceA.token, refresh = false) {
    return app.request(`/api/pos/payments/${id}${refresh ? '?refresh=1' : ''}`, {
      headers: authHeaders(token),
    })
  }

  function abandonRequest(id: string, token = deviceA.token) {
    return app.request(`/api/pos/payments/${id}/abandon`, {
      method: 'POST',
      headers: authHeaders(token),
    })
  }

  function submitOtpRequest(id: string, otp: string, token = deviceA.token) {
    return app.request(`/api/pos/payments/${id}/otp`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ otp }),
    })
  }

  async function readPayment(response: Response): Promise<PaymentView> {
    const body = (await response.json()) as { payment?: PaymentView; error?: unknown }
    if (!response.ok || !body.payment) {
      throw new Error(`payment request failed (${response.status}): ${JSON.stringify(body)}`)
    }
    trackedPaymentIds.add(body.payment.id)
    return body.payment
  }

  function expiresIn(iso: string | null): number {
    if (!iso) throw new Error('payment has no expiry')
    return new Date(iso).getTime() - Date.now()
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({
        code: `${suffix}P`,
        name: `Payments Branch ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning()
    branchId = branchRow[0]?.id ?? ''
    createdBranchIds.push(branchId)

    cashierUserId = `cashier-${suffix}`
    cashierStaffId = `SD-P13-${suffix}`

    deviceA = await createTerminal('A')
    deviceB = await createTerminal('B')
    deviceC = await createTerminal('C')
    shiftA = await insertShift(deviceA, 'A-OPEN')
    closedShiftA = await insertShift(deviceA, 'A-CLOSED', 'CLOSED')
    shiftB = await insertShift(deviceB, 'B-OPEN')
    shiftC = await insertShift(deviceC, 'C-OPEN')

    const admin = await createTestUser({ role: 'ADMIN', branchId, name: 'Payments Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)
  })

  afterAll(async () => {
    const paymentIds = [...trackedPaymentIds]
    if (paymentIds.length > 0) {
      await db.delete(paymentEvent).where(inArray(paymentEvent.paymentId, paymentIds))
      await db.delete(payment).where(inArray(payment.id, paymentIds))
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
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  beforeEach(() => {
    resetMockProvider()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a MoMo payment pending with our reference and a 180-second expiry', async () => {
    const body = createBody()
    const response = await postPayment(body)
    expect(response.status).toBe(201)

    const created = await readPayment(response)
    expect(created).toMatchObject({
      clientPaymentId: body.clientPaymentId,
      method: 'MOMO',
      amountMinor: 5_000,
      provider: 'MOCK',
      providerReference: `sd-${body.clientPaymentId}`,
      status: 'PENDING',
    })
    expect(expiresIn(created.expiresAt)).toBeGreaterThan(MOMO_EXPIRY_MS - 10_000)
    expect(expiresIn(created.expiresAt)).toBeLessThanOrEqual(MOMO_EXPIRY_MS)

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.providerEmail).toBe(
      `pos+${deviceA.terminalCode}-${body.clientPaymentId}@${env.PAYSTACK_EMAIL_DOMAIN}`,
    )
    expect(rows[0]?.providerReference).toBe(`sd-${body.clientPaymentId}`)
    expect(getMockCallCounts().charge).toBe(1)
  })

  it('returns the same payment for a repeated clientPaymentId without charging twice', async () => {
    const body = createBody()
    const first = await readPayment(await postPayment(body))
    const second = await readPayment(await postPayment(body))

    expect(second.id).toBe(first.id)
    const rows = await db
      .select()
      .from(payment)
      .where(eq(payment.clientPaymentId, body.clientPaymentId))
    expect(rows).toHaveLength(1)
    expect(getMockCallCounts().charge).toBe(1)
  })

  it('asks for the one-time code Paystack sends and settles when it is submitted', async () => {
    requestMockPaymentOtp()

    const created = await readPayment(await postPayment(createBody()))
    expect(created.status).toBe('PENDING')
    expect(created.requiresOtp).toBe(true)
    expect(created.displayText).toContain('one-time code')

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows[0]?.requiresOtp).toBe(true)

    // A wrong code keeps the charge alive: it is not a failure, and the
    // customer may read the message again.
    const wrong = await submitOtpRequest(created.id, '000000')
    expect(wrong.status).toBe(200)
    const stillPending = await readPayment(wrong)
    expect(stillPending.status).toBe('PENDING')
    expect(stillPending.requiresOtp).toBe(true)
    expect(stillPending.failedCode).toBe('otp_invalid')
    expect(stillPending.paidAt).toBeNull()

    // The right code moves money only through the provider's own success.
    const right = await submitOtpRequest(created.id, MOCK_PAYMENT_OTP)
    expect(right.status).toBe(200)
    const paid = await readPayment(right)
    expect(paid.status).toBe('PAID')
    expect(paid.requiresOtp).toBe(false)
    expect(paid.paidAt).not.toBeNull()
  })

  it('polls an OTP-pending charge with check-charge, so it cannot fail before the code', async () => {
    requestMockPaymentOtp()
    const created = await readPayment(await postPayment(createBody()))
    expect(created.requiresOtp).toBe(true)

    // The first tick of the till's poll must not call transaction/verify:
    // Paystack can report "Transaction was not completed" while it is still
    // waiting for the OTP, which is the regression this pins.
    const refreshed = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(refreshed.status).toBe('PENDING')
    expect(refreshed.requiresOtp).toBe(true)
    expect(getMockCallCounts().check).toBe(1)
    expect(getMockCallCounts().verify).toBe(0)

    const paid = await readPayment(await submitOtpRequest(created.id, MOCK_PAYMENT_OTP))
    expect(paid.status).toBe('PAID')
  })

  it('ignores a premature failed check while the OTP window is still open', async () => {
    requestMockPaymentOtp()
    forceMockCheckFailure()
    const created = await readPayment(await postPayment(createBody()))
    expect(created.requiresOtp).toBe(true)

    // Paystack's check call can answer `failed` with "Reference check
    // successful" before the code is submitted. That is not a decline while
    // the 180-second window is open, so the row must stay PENDING.
    const refreshed = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(refreshed.status).toBe('PENDING')
    expect(refreshed.requiresOtp).toBe(true)
    expect(refreshed.failedCode).toBeNull()

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows[0]?.status).toBe('PENDING')
    expect(rows[0]?.requiresOtp).toBe(true)

    // The code can still settle the charge.
    const paid = await readPayment(await submitOtpRequest(created.id, MOCK_PAYMENT_OTP))
    expect(paid.status).toBe('PAID')
  })

  it('lets the same failed check become terminal once the OTP window has closed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const startedAt = new Date()
    vi.setSystemTime(startedAt)

    requestMockPaymentOtp()
    forceMockCheckFailure()
    const created = await readPayment(await postPayment(createBody()))
    expect(created.requiresOtp).toBe(true)

    vi.setSystemTime(new Date(startedAt.getTime() + MOMO_EXPIRY_MS + 1_000))

    const refreshed = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(refreshed.status).toBe('FAILED')
    expect(refreshed.requiresOtp).toBe(false)
  })

  it('refuses an OTP for a payment that never asked for one', async () => {
    const created = await readPayment(await postPayment(createBody()))

    const response = await submitOtpRequest(created.id, MOCK_PAYMENT_OTP)
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('PAYMENT_OTP_NOT_REQUIRED')

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('scopes the OTP route to the owning terminal and rejects a malformed code', async () => {
    requestMockPaymentOtp()
    const created = await readPayment(await postPayment(createBody()))

    const foreign = await submitOtpRequest(created.id, MOCK_PAYMENT_OTP, deviceB.token)
    expect(foreign.status).toBe(404)

    const malformed = await submitOtpRequest(created.id, '12ab')
    expect(malformed.status).toBe(400)

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('settles a pending payment through the mock harness and the refresh path', async () => {
    const created = await readPayment(await postPayment(createBody()))
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)

    const response = await getPaymentRequest(created.id, deviceA.token, true)
    expect(response.status).toBe(200)
    const settled = await readPayment(response)

    expect(settled.status).toBe('PAID')
    expect(settled.paidAt).not.toBeNull()
  })

  it('settles through the admin mock route', async () => {
    const created = await readPayment(await postPayment(createBody()))

    const response = await app.request('/api/payments/mock/settle', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ reference: created.providerReference, outcome: 'PAID' }),
    })
    expect(response.status).toBe(200)

    const refreshed = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(refreshed.status).toBe('PAID')
  })

  it('abandons a pending payment to EXPIRED', async () => {
    const created = await readPayment(await postPayment(createBody()))

    const response = await abandonRequest(created.id)
    expect(response.status).toBe(200)
    const abandoned = await readPayment(response)

    expect(abandoned.status).toBe('EXPIRED')
  })

  it('turns a success inside abandon into PAID, orphaned, and one HIGH conflict', async () => {
    const created = await readPayment(
      await postPayment(createBody({ shiftId: shiftC }), deviceC.token),
    )

    // The customer approves after the cashier gave up but before abandon asks
    // the provider once; a success inside that verify must win.
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)

    const first = await readPayment(await abandonRequest(created.id, deviceC.token))
    expect(first.status).toBe('PAID')
    expect(first.orphaned).toBe(true)

    const conflicts = await db
      .select()
      .from(syncConflict)
      .where(
        and(eq(syncConflict.shiftId, shiftC), eq(syncConflict.type, 'PAYMENT_LATE_SETTLEMENT')),
      )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.severity).toBe('HIGH')

    // Abandoning again is a no-op: no second verify, no second conflict.
    const second = await readPayment(await abandonRequest(created.id, deviceC.token))
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('PAID')

    const stillOne = await db
      .select()
      .from(syncConflict)
      .where(
        and(eq(syncConflict.shiftId, shiftC), eq(syncConflict.type, 'PAYMENT_LATE_SETTLEMENT')),
      )
    expect(stillOne).toHaveLength(1)
  })

  it('claims an orphaned payment and clears the banner flag', async () => {
    const created = await readPayment(await postPayment(createBody()))
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)

    const paid = await readPayment(await abandonRequest(created.id))
    expect(paid.orphaned).toBe(true)

    const response = await app.request(`/api/pos/payments/${created.id}/claim`, {
      method: 'POST',
      headers: authHeaders(deviceA.token),
      body: JSON.stringify({ saleId: crypto.randomUUID() }),
    })
    expect(response.status).toBe(200)

    const claimed = await readPayment(response)
    expect(claimed.orphaned).toBe(false)
  })

  it('returns 404 for a payment owned by another terminal', async () => {
    const created = await readPayment(await postPayment(createBody()))

    const read = await getPaymentRequest(created.id, deviceB.token)
    expect(read.status).toBe(404)

    const abandon = await abandonRequest(created.id, deviceB.token)
    expect(abandon.status).toBe(404)

    const rows = await db.select().from(payment).where(eq(payment.id, created.id))
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('calls verify at most once per five seconds on the refresh path', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const startedAt = new Date()
    vi.setSystemTime(startedAt)

    const created = await readPayment(await postPayment(createBody()))
    expect(getMockCallCounts().verify).toBe(0)

    await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(getMockCallCounts().verify).toBe(1)

    await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(getMockCallCounts().verify).toBe(1)

    vi.setSystemTime(new Date(startedAt.getTime() + REFRESH_THROTTLE_MS + 1_000))
    await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(getMockCallCounts().verify).toBe(2)
  })

  it('creates a card checkout with an https authorization url and a 30-minute expiry', async () => {
    const body = createBody({ method: 'CARD', mobileMoney: undefined })
    const created = await readPayment(await postPayment(body))

    expect(created.status).toBe('PENDING')
    expect(created.authorizationUrl).toMatch(/^https:\/\//)
    expect(created.authorizationUrl).toContain(created.providerReference)
    expect(expiresIn(created.expiresAt)).toBeGreaterThan(CARD_EXPIRY_MS - 10_000)
    expect(expiresIn(created.expiresAt)).toBeLessThanOrEqual(CARD_EXPIRY_MS)
  })

  it('keeps a card checkout pending when verify reports it abandoned before expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const startedAt = new Date()
    vi.setSystemTime(startedAt)

    forceMockVerifyAbandoned()
    const created = await readPayment(
      await postPayment(createBody({ method: 'CARD', mobileMoney: undefined })),
    )
    expect(created.authorizationUrl).not.toBeNull()

    // The till's first poll must not close the checkout: `abandoned` means the
    // customer has not finished, not that the card was declined.
    const waiting = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(waiting.status).toBe('PENDING')
    expect(waiting.failedCode).toBeNull()

    vi.setSystemTime(new Date(startedAt.getTime() + REFRESH_THROTTLE_MS + 1_000))
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)
    const paid = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(paid.status).toBe('PAID')
  })

  it('lets an abandoned card checkout become terminal once its window closes', async () => {
    forceMockVerifyAbandoned()
    const created = await readPayment(
      await postPayment(createBody({ method: 'CARD', mobileMoney: undefined })),
    )

    // Move the row's own expiry into the past; the device token stays valid.
    await db
      .update(payment)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(payment.id, created.id))

    const expired = await readPayment(await getPaymentRequest(created.id, deviceA.token, true))
    expect(expired.status).toBe('FAILED')
    expect(expired.failedCode).toBe('abandoned')
  })

  it('creates a bank transfer with the three account fields and a 15-minute expiry', async () => {
    const body = createBody({ method: 'BANK_TRANSFER', mobileMoney: undefined })
    const created = await readPayment(await postPayment(body))

    expect(created.status).toBe('PENDING')
    expect(created.accountNumber).toBe('1234567890')
    expect(created.accountName).toBe('Sceptre Drive Mock')
    expect(created.accountBank).toBe('Test Bank')
    expect(expiresIn(created.expiresAt)).toBeGreaterThan(BANK_TRANSFER_EXPIRY_MS - 10_000)
    expect(expiresIn(created.expiresAt)).toBeLessThanOrEqual(BANK_TRANSFER_EXPIRY_MS)
  })

  it('rejects MoMo without a phone and a phone on a card payment', async () => {
    const noPhone = await app.request('/api/pos/payments', {
      method: 'POST',
      headers: authHeaders(deviceA.token),
      body: JSON.stringify({ ...createBody(), mobileMoney: undefined }),
    })
    expect(noPhone.status).toBe(400)

    const cardWithPhone = await app.request('/api/pos/payments', {
      method: 'POST',
      headers: authHeaders(deviceA.token),
      body: JSON.stringify(createBody({ method: 'CARD' })),
    })
    expect(cardWithPhone.status).toBe(400)

    const badPhone = await app.request('/api/pos/payments', {
      method: 'POST',
      headers: authHeaders(deviceA.token),
      body: JSON.stringify(createBody({ mobileMoney: { provider: 'mtn', phone: 'not-a-number' } })),
    })
    expect(badPhone.status).toBe(400)
  })

  it('refuses a closed shift and a shift owned by another terminal', async () => {
    const closed = await postPayment(createBody({ shiftId: closedShiftA }))
    expect(closed.status).toBe(409)

    const foreign = await postPayment(createBody({ shiftId: shiftB }))
    expect(foreign.status).toBe(403)

    const closedRows = await db.select().from(payment).where(eq(payment.shiftId, closedShiftA))
    expect(closedRows).toHaveLength(0)
    const foreignRows = await db.select().from(payment).where(eq(payment.shiftId, shiftB))
    expect(foreignRows).toHaveLength(0)
  })
})
