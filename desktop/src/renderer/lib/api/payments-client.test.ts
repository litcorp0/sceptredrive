import { describe, expect, it, vi } from 'vitest'
import {
  createPaymentClient,
  PaymentClientError,
  type PaymentView,
  paymentsClient,
} from './payments-client'

/**
 * The client's one job is classification: a lost connection must never read as
 * a failed payment (P13-D9), and a dead session must not be polled.
 */

const PAYMENT: PaymentView = {
  id: 'pay_1',
  clientPaymentId: 'cp_1',
  shiftId: 'shift_1',
  method: 'MOMO',
  amountMinor: 5_000,
  provider: 'MOCK',
  providerReference: 'sd-cp_1',
  status: 'PENDING',
  channel: null,
  displayText: 'Approve the prompt on your phone',
  requiresOtp: false,
  authorizationUrl: null,
  accountNumber: null,
  accountName: null,
  accountBank: null,
  expiresAt: '2026-10-27T14:03:00.000Z',
  paidAt: null,
  failedCode: null,
  failedMessage: null,
  orphaned: false,
  createdAt: '2026-10-27T14:00:00.000Z',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function client(fetchImpl: typeof globalThis.fetch, token: string | null = 'jwt') {
  return createPaymentClient({
    baseUrl: 'https://api.example.test',
    token: () => token,
    fetch: fetchImpl,
  })
}

/** Vitest types a `vi.fn(async () => …)` call as zero arguments; ours has two. */
function calls(fn: { mock: { calls: unknown[] } }): Array<[string, RequestInit]> {
  return fn.mock.calls as unknown as Array<[string, RequestInit]>
}

describe('payments client', () => {
  it('renews an expired device token once and retries the payment', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            error: { code: 'DEVICE_TOKEN_INVALID', message: 'Device token is invalid or expired' },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(json({ payment: PAYMENT }, 201))

    const refresh = vi.fn(async () => 'fresh-jwt')
    const api = createPaymentClient({
      baseUrl: 'https://api.example.test',
      token: () => 'stale-jwt',
      refresh,
      fetch: fetchImpl,
    })

    const viewed = await api.create({
      clientPaymentId: 'cp_1',
      method: 'MOMO',
      amountMinor: 5_000,
      shiftId: 'shift_1',
      mobileMoney: { provider: 'mtn', phone: '+233241234567' },
    })

    expect(viewed).toEqual(PAYMENT)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry a second time, so a revoked device still fails', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        { error: { code: 'DEVICE_TOKEN_INVALID', message: 'Device token is invalid or expired' } },
        401,
      ),
    )
    const refresh = vi.fn(async () => null)
    const api = createPaymentClient({
      baseUrl: 'https://api.example.test',
      token: () => 'stale-jwt',
      refresh,
      fetch: fetchImpl,
    })

    await expect(
      api.create({
        clientPaymentId: 'cp_1',
        method: 'MOMO',
        amountMinor: 5_000,
        shiftId: 'shift_1',
        mobileMoney: { provider: 'mtn', phone: '+233241234567' },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('creates a payment with the device bearer and returns the server view', async () => {
    const fetchImpl = vi.fn(async () => json({ payment: PAYMENT }, 201))
    const viewed = await client(fetchImpl).create({
      clientPaymentId: 'cp_1',
      method: 'MOMO',
      amountMinor: 5_000,
      shiftId: 'shift_1',
      mobileMoney: { provider: 'mtn', phone: '+233241234567' },
    })

    expect(viewed).toEqual(PAYMENT)
    const [url, init] = calls(fetchImpl)[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.test/api/pos/payments')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt')
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientPaymentId: 'cp_1',
      method: 'MOMO',
      mobileMoney: { provider: 'mtn' },
    })
  })

  it('submits a one-time code to the payment, never to the provider directly', async () => {
    const fetchImpl = vi.fn(async () => json({ payment: { ...PAYMENT, requiresOtp: true } }))
    const viewed = await client(fetchImpl).submitOtp('pay_1', '123456')

    expect(viewed.requiresOtp).toBe(true)
    const [url, init] = calls(fetchImpl)[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.test/api/pos/payments/pay_1/otp')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ otp: '123456' })
  })

  it('asks for a refresh only when told to', async () => {
    const fetchImpl = vi.fn(async () => json({ payment: PAYMENT }))
    const api = client(fetchImpl)

    await api.get('pay_1')
    await api.get('pay_1', { refresh: true })

    expect(calls(fetchImpl)[0]?.[0]).toBe('https://api.example.test/api/pos/payments/pay_1')
    expect(calls(fetchImpl)[1]?.[0]).toBe(
      'https://api.example.test/api/pos/payments/pay_1?refresh=1',
    )
  })

  it('classifies a 401 as terminal — polling a dead session cannot help', async () => {
    const error = await client(async () =>
      json({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }, 401),
    )
      .get('pay_1')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PaymentClientError)
    expect(error).toMatchObject({ code: 'UNAUTHORIZED', retryable: false, status: 401 })
  })

  it('classifies a lost connection as retryable', async () => {
    const error = await client(async () => {
      throw new TypeError('fetch failed')
    })
      .get('pay_1')
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'NETWORK', retryable: true })
  })

  it('classifies a timeout as retryable', async () => {
    const error = await client(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
      .get('pay_1')
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true })
  })

  it('classifies a 5xx as retryable and a provider-disabled 4xx as terminal', async () => {
    const server = await client(async () => json({ error: { code: 'INTERNAL' } }, 503))
      .get('pay_1')
      .catch((caught: unknown) => caught)
    expect(server).toMatchObject({ code: 'SERVER_ERROR', retryable: true, status: 503 })

    const disabled = await client(async () =>
      json({ error: { code: 'PAYMENT_PROVIDER_DISABLED', message: 'Card is not enabled' } }, 400),
    )
      .create({ clientPaymentId: 'cp_1', method: 'CARD', amountMinor: 5_000, shiftId: 'shift_1' })
      .catch((caught: unknown) => caught)
    expect(disabled).toMatchObject({
      code: 'VALIDATION',
      serverCode: 'PAYMENT_PROVIDER_DISABLED',
      retryable: false,
      status: 400,
    })
  })

  it('refuses to call without a session token', async () => {
    const fetchImpl = vi.fn()
    const error = await client(fetchImpl, null)
      .get('pay_1')
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'UNAUTHORIZED', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('abandons and claims through the documented paths', async () => {
    const fetchImpl = vi.fn(async () => json({ payment: PAYMENT }))
    const api = client(fetchImpl)

    await api.abandon('pay_1')
    await api.claim('pay_1', 'sale_1')

    expect(calls(fetchImpl)[0]?.[0]).toBe('https://api.example.test/api/pos/payments/pay_1/abandon')
    expect(calls(fetchImpl)[1]?.[0]).toBe('https://api.example.test/api/pos/payments/pay_1/claim')
    expect(JSON.parse(String(calls(fetchImpl)[1]?.[1]?.body))).toEqual({
      saleId: 'sale_1',
    })
  })

  it('exposes the app client as a singleton', () => {
    expect(paymentsClient.create).toBeTypeOf('function')
    expect(paymentsClient.get).toBeTypeOf('function')
  })
})
