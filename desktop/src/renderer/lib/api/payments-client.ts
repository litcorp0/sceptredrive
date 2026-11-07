import type { TenderMethod } from '@sceptre/shared'
import { posRuntimeConfig } from '../config'
import { describeNetworkFailure } from '../network-status'
import { getAccessToken, refreshSessionToken } from './client'

/**
 * The device-facing payment-intent client (Plan 09 Task 1).
 *
 * An electronic tender is a server `payment`, not a local fact: the till mints
 * a `clientPaymentId`, the server talks to Paystack, and only the server's
 * view says whether the money arrived (P13-D6). This client is therefore
 * deliberately thin — it never derives a status, never retries a POST by
 * itself, and never treats a lost connection as a failed payment.
 *
 * A network failure is **retryable** and the till keeps showing "still
 * pending". A 401 is terminal: the device must re-enrol, and pretending
 * otherwise would poll a dead session for three minutes.
 */

export type PaymentMethod = Extract<TenderMethod, 'MOMO' | 'CARD' | 'BANK_TRANSFER'>

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'ABANDONED' | 'EXPIRED'

export type MobileMoneyProvider = 'mtn' | 'atl' | 'vod'

/** What the server lets the terminal see. No card data, no provider email (P13-D15). */
export interface PaymentView {
  id: string
  clientPaymentId: string
  shiftId: string
  method: PaymentMethod
  amountMinor: number
  provider: 'PAYSTACK' | 'MOCK'
  providerReference: string
  status: PaymentStatus
  channel: string | null
  displayText: string | null
  /** The customer must give the till a one-time code before this can settle. */
  requiresOtp: boolean
  authorizationUrl: string | null
  accountNumber: string | null
  accountName: string | null
  accountBank: string | null
  expiresAt: string | null
  paidAt: string | null
  failedCode: string | null
  failedMessage: string | null
  orphaned: boolean
  createdAt: string
}

export type PaymentClientErrorCode =
  | 'NETWORK'
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'API_ERROR'

export class PaymentClientError extends Error {
  readonly code: string
  /** True when the same call may succeed later without changing the payment. */
  readonly retryable: boolean
  readonly status: number
  /** The server's own code (e.g. `PAYMENT_PROVIDER_DISABLED`), when it sent one. */
  readonly serverCode: string | null

  constructor(
    code: PaymentClientErrorCode,
    message: string,
    options: { retryable: boolean; status?: number; serverCode?: string | null },
  ) {
    super(message)
    this.name = 'PaymentClientError'
    this.code = code
    this.retryable = options.retryable
    this.status = options.status ?? 0
    this.serverCode = options.serverCode ?? null
  }
}

/**
 * Only a transport failure, a timeout, a throttle and a 5xx are worth asking
 * again. A 4xx means the request itself is wrong or the device is not trusted.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function readError(response: Response): Promise<PaymentClientError> {
  let body: ErrorBody | null = null
  try {
    body = (await response.json()) as ErrorBody
  } catch {
    body = null
  }

  const serverCode = body?.error?.code ?? null
  const message = body?.error?.message ?? `Payment request failed (${response.status})`

  if (response.status === 401) {
    return new PaymentClientError('UNAUTHORIZED', message, {
      retryable: false,
      status: 401,
      serverCode,
    })
  }
  if (response.status === 403) {
    return new PaymentClientError('FORBIDDEN', message, {
      retryable: false,
      status: 403,
      serverCode,
    })
  }
  if (response.status === 404) {
    return new PaymentClientError('NOT_FOUND', message, {
      retryable: false,
      status: 404,
      serverCode,
    })
  }
  if (response.status === 409) {
    return new PaymentClientError('CONFLICT', message, {
      retryable: false,
      status: 409,
      serverCode,
    })
  }
  if (response.status === 429) {
    return new PaymentClientError('RATE_LIMITED', message, {
      retryable: true,
      status: 429,
      serverCode,
    })
  }
  if (response.status >= 500) {
    return new PaymentClientError('SERVER_ERROR', message, {
      retryable: true,
      status: response.status,
      serverCode,
    })
  }
  return new PaymentClientError('VALIDATION', serverCode ?? message, {
    retryable: false,
    status: response.status,
    serverCode,
  })
}

export interface CreatePaymentInput {
  clientPaymentId: string
  method: PaymentMethod
  amountMinor: number
  shiftId: string
  mobileMoney?: { provider: MobileMoneyProvider; phone: string }
}

export interface PaymentClient {
  create(input: CreatePaymentInput): Promise<PaymentView>
  get(id: string, opts?: { refresh?: boolean }): Promise<PaymentView>
  /** Completes a MoMo charge whose provider asked for an OTP. */
  submitOtp(id: string, otp: string): Promise<PaymentView>
  abandon(id: string): Promise<PaymentView>
  claim(id: string, saleId: string): Promise<PaymentView>
}

export interface PaymentClientDeps {
  baseUrl: string
  /** The in-memory device JWT; never persisted or logged. */
  token(): Promise<string | null> | string | null
  /**
   * Re-mints the device JWT after a 401. The session layer coalesces concurrent refreshes, so
   * this is safe to call from every payment.
   *
   * Without it the payment client held a 15-minute token and had no way to renew it, so the first
   * card or MoMo attempt after a quiet spell failed with "Device token is invalid or expired"
   * while cash — which goes through `apiRequest` and does refresh — kept working.
   */
  refresh?: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

interface PaymentEnvelope {
  payment?: PaymentView
}

const DEFAULT_TIMEOUT_MS = 15_000

export function createPaymentClient(deps: PaymentClientDeps): PaymentClient {
  const doFetch = deps.fetch ?? globalThis.fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseUrl = deps.baseUrl.replace(/\/$/, '')

  async function request(path: string, init: RequestInit, retried = false): Promise<PaymentView> {
    const token = await deps.token()
    if (!token) {
      // A signed-out terminal can still heal: the session layer re-mints from the device token.
      if (!retried && deps.refresh) {
        const refreshed = await deps.refresh()
        if (refreshed) return request(path, init, true)
      }
      throw new PaymentClientError('UNAUTHORIZED', 'Sign in again to take card or MoMo', {
        retryable: false,
        status: 401,
      })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (error) {
      // A timeout is still "we do not know": the money may be in flight.
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      const failure = timedOut
        ? { code: 'TIMEOUT' as const, message: 'The server did not answer in time' }
        : describeNetworkFailure('the payment server')
      const code: PaymentClientErrorCode =
        failure.code === 'NETWORK_ERROR' ? 'NETWORK' : failure.code
      throw new PaymentClientError(code, failure.message, { retryable: true })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const error = await readError(response)
      // The device JWT lives 15 minutes. Retry once with a freshly minted one instead of telling
      // the cashier to sign in to a terminal that is already signed in. `serverCode` carries the
      // API's own reason (`DEVICE_TOKEN_INVALID`); a revoked device simply fails again below.
      if (!retried && error.status === 401 && deps.refresh) {
        const refreshed = await deps.refresh()
        if (refreshed) return request(path, init, true)
      }
      throw error
    }

    let body: PaymentEnvelope
    try {
      body = (await response.json()) as PaymentEnvelope
    } catch {
      throw new PaymentClientError('API_ERROR', 'The server sent an unreadable payment', {
        retryable: false,
        status: response.status,
      })
    }
    if (!body.payment) {
      throw new PaymentClientError('API_ERROR', 'The server sent no payment', {
        retryable: false,
        status: response.status,
      })
    }
    return body.payment
  }

  return {
    create(input) {
      return request('/api/pos/payments', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    get(id, opts) {
      const query = opts?.refresh ? '?refresh=1' : ''
      return request(`/api/pos/payments/${encodeURIComponent(id)}${query}`, { method: 'GET' })
    },

    submitOtp(id, otp) {
      return request(`/api/pos/payments/${encodeURIComponent(id)}/otp`, {
        method: 'POST',
        body: JSON.stringify({ otp }),
      })
    },

    abandon(id) {
      return request(`/api/pos/payments/${encodeURIComponent(id)}/abandon`, { method: 'POST' })
    },

    claim(id, saleId) {
      return request(`/api/pos/payments/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        body: JSON.stringify({ saleId }),
      })
    },
  }
}

/**
 * The app's single client. The factory stays exported so tests (and any future
 * second transport) can drive it with a fake `fetch` and token source.
 */
export const paymentsClient: PaymentClient = createPaymentClient({
  baseUrl: posRuntimeConfig.apiBaseUrl,
  token: () => getAccessToken(),
  refresh: () => refreshSessionToken(),
})
