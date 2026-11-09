import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaystackPaymentProvider } from './payments.paystack.provider.ts'

/**
 * The live-provider mapping that caused the reported MoMo dead end: Paystack's
 * `send_otp` is a request for input, not an offline prompt and not a failure.
 */

const INPUT = {
  reference: 'sd-otp-1',
  amountMinor: 5_000,
  email: 'pos+terminal@example.test',
  currency: 'GHS' as const,
  metadata: { paymentId: 'payment-1', terminalId: 'terminal-1', branchId: 'branch-1' },
  mobileMoney: { provider: 'vod' as const, phone: '+233201234567' },
}

function provider(): PaystackPaymentProvider {
  return new PaystackPaymentProvider({
    secretKey: 'sk_test_provider_unit',
    baseUrl: 'https://api.paystack.test',
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Paystack mobile-money charge responses', () => {
  it('maps send_otp to OTP_REQUIRED with the provider prompt intact', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: true,
        message: 'Charge attempted',
        data: {
          reference: INPUT.reference,
          status: 'send_otp',
          display_text: 'Please enter the one-time password sent to your phone',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().createMobileMoneyCharge(INPUT)

    expect(result.status).toBe('OTP_REQUIRED')
    expect(result.displayText).toBe('Please enter the one-time password sent to your phone')
    expect(result.failureCode).toBeNull()
  })

  it('submits the code to /charge/submit_otp and maps success', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: true,
        message: 'Charge attempted',
        data: { id: 42, reference: INPUT.reference, status: 'success' },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().submitOtp(INPUT.reference, '123456')

    expect(result.status).toBe('SUCCESS')
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.paystack.test/charge/submit_otp')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ otp: '123456', reference: INPUT.reference })
  })

  it('checks a pending charge with GET /charge/:reference and keeps send_otp live', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: true,
        message: 'Charge attempted',
        data: {
          reference: INPUT.reference,
          status: 'send_otp',
          display_text: 'Please enter the one-time password sent to your phone',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().checkCharge(INPUT.reference)

    expect(result.status).toBe('OTP_REQUIRED')
    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.paystack.test/charge/sd-otp-1')
    expect(init.method).toBe('GET')
  })

  it('does not use a successful envelope message as the failure reason', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: true,
        message: 'Reference check successful',
        data: { reference: INPUT.reference, status: 'failed' },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().checkCharge(INPUT.reference)

    expect(result.status).toBe('FAILED')
    expect(result.failureCode).toBe('failed')
    expect(result.failureMessage).not.toBe('Reference check successful')
    expect(result.failureMessage).toContain('did not complete')
  })

  it('treats an unreadable check as pending, not a failed payment', async () => {
    const fetchImpl = vi.fn(async () => json({ status: false, message: 'Charge not found' }, 404))
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().checkCharge(INPUT.reference)

    expect(result.status).toBe('PENDING')
    expect(result.failureCode).toBe('check_failed')
  })

  it('treats a repeated send_otp after submission as a code the provider did not accept', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: true,
        message: 'Charge attempted',
        data: {
          reference: INPUT.reference,
          status: 'send_otp',
          display_text: 'The one-time code is not correct',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().submitOtp(INPUT.reference, '000000')

    expect(result.status).toBe('OTP_REQUIRED')
    expect(result.failureCode).toBe('otp_invalid')
    expect(result.failureMessage).toBe('The one-time code is not correct')
  })

  it('keeps a rejected code pending instead of failing the charge', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ status: false, message: 'The one-time code is not correct' }, 400),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const result = await provider().submitOtp(INPUT.reference, '000000')

    expect(result.status).toBe('OTP_REQUIRED')
    expect(result.failureCode).toBe('otp_invalid')
    expect(result.failureMessage).toBe('The one-time code is not correct')
  })
})
