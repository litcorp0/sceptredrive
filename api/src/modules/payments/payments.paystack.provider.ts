import { logger } from '../../logger.ts'
import {
  type ChargeInput,
  type PaymentProvider,
  type ProviderChargeResult,
  type ProviderRefund,
  ProviderUnavailableError,
  type ProviderVerification,
} from './payments.provider.ts'

/**
 * Paystack over plain `fetch`: no SDK and no new dependency (P13-D10).
 *
 * The request helper logs only `{ provider, endpoint, status, durationMs }`.
 * The charge body, the response body, the headers and the secret key never reach
 * the logger (P13-D15).
 */

interface PaystackEnvelope<T> {
  status?: boolean
  message?: string
  data?: T
}

interface PaystackChargeData {
  id?: number | string
  reference?: string
  status?: string
  display_text?: string
  authorization_url?: string
  access_code?: string
  account_number?: string
  account_name?: string
  bank?: string
  account_expires_at?: string
  gateway_response?: string
}

interface PaystackTransactionData {
  id?: number | string
  reference?: string
  status?: string
  amount?: number
  currency?: string
  channel?: string
  paid_at?: string
  gateway_response?: string
}

interface PaystackRefundData {
  id?: number | string
  status?: string
  refund_reference?: string
  expected_at?: string
}

interface RequestOutcome<T> {
  ok: boolean
  status: number
  message: string
  data: T | null
}

const REQUEST_TIMEOUT_MS = 20_000

const CHARGE_STATUS: Record<string, ProviderChargeResult['status']> = {
  pay_offline: 'PAY_OFFLINE',
  success: 'SUCCESS',
  pending: 'PENDING',
  pending_bank_transfer: 'PENDING_BANK_TRANSFER',
  failed: 'FAILED',
  timeout: 'FAILED',
}

const VERIFY_STATUSES = new Set<ProviderVerification['status']>([
  'success',
  'failed',
  'abandoned',
  'pending',
  'ongoing',
  'reversed',
])

const REFUND_STATUSES = new Set<ProviderRefund['status']>([
  'pending',
  'processing',
  'processed',
  'failed',
  'needs-attention',
])

function failureResult(
  input: ChargeInput,
  message: string,
  status: ProviderChargeResult['status'] = 'FAILED',
): ProviderChargeResult {
  return {
    reference: input.reference,
    status,
    displayText: null,
    authorizationUrl: null,
    accountNumber: null,
    accountName: null,
    accountBank: null,
    expiresAt: null,
    transactionId: null,
    failureCode: 'provider_error',
    failureMessage: message,
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export class PaystackPaymentProvider implements PaymentProvider {
  readonly name = 'PAYSTACK' as const

  private readonly secretKey: string
  private readonly baseUrl: string

  constructor(options: { secretKey: string; baseUrl: string }) {
    this.secretKey = options.secretKey
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
  }

  async createMobileMoneyCharge(input: ChargeInput): Promise<ProviderChargeResult> {
    const mobileMoney = input.mobileMoney
    if (!mobileMoney) {
      return failureResult(input, 'A mobile money charge needs a provider and a phone')
    }

    const response = await this.request<PaystackChargeData>('POST', '/charge', {
      amount: input.amountMinor,
      email: input.email,
      currency: input.currency,
      reference: input.reference,
      mobile_money: { phone: mobileMoney.phone, provider: mobileMoney.provider },
      metadata: input.metadata,
    })

    return this.toChargeResult(input, response, 'PAY_OFFLINE')
  }

  async createCardCheckout(input: ChargeInput): Promise<ProviderChargeResult> {
    const response = await this.request<PaystackChargeData>('POST', '/transaction/initialize', {
      amount: input.amountMinor,
      email: input.email,
      currency: input.currency,
      reference: input.reference,
      channels: ['card'],
      metadata: input.metadata,
    })

    if (!response.ok || !response.data) {
      return failureResult(input, response.message)
    }

    return {
      reference: text(response.data.reference) ?? input.reference,
      // Checkout is a redirect, not a charge result: the outcome arrives on the
      // webhook or through verify, never from the window that rendered the page.
      status: 'PENDING',
      displayText: null,
      authorizationUrl: text(response.data.authorization_url),
      accountNumber: null,
      accountName: null,
      accountBank: null,
      expiresAt: null,
      transactionId:
        response.data.id === undefined || response.data.id === null
          ? null
          : String(response.data.id),
      failureCode: null,
      failureMessage: null,
    }
  }

  async createBankTransferCharge(input: ChargeInput): Promise<ProviderChargeResult> {
    if (!input.bankTransfer) {
      return failureResult(input, 'A bank transfer charge needs an account expiry')
    }

    const response = await this.request<PaystackChargeData>('POST', '/charge', {
      amount: input.amountMinor,
      email: input.email,
      currency: input.currency,
      reference: input.reference,
      bank_transfer: { account_expires_at: input.bankTransfer.accountExpiresAt },
      metadata: input.metadata,
    })

    return this.toChargeResult(input, response, 'PENDING_BANK_TRANSFER')
  }

  async verify(reference: string): Promise<ProviderVerification> {
    const response = await this.request<PaystackTransactionData>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    )

    if (!response.ok || !response.data) {
      return {
        reference,
        status: 'failed',
        amountMinor: 0,
        currency: 'GHS',
        channel: null,
        paidAt: null,
        gatewayResponse: response.message,
        failureCode: 'verify_failed',
        failureMessage: response.message,
      }
    }

    const data = response.data
    const status = VERIFY_STATUSES.has(data.status as ProviderVerification['status'])
      ? (data.status as ProviderVerification['status'])
      : 'pending'

    return {
      reference: text(data.reference) ?? reference,
      status,
      amountMinor: typeof data.amount === 'number' ? data.amount : 0,
      currency: text(data.currency) ?? 'GHS',
      channel: text(data.channel),
      paidAt: text(data.paid_at),
      gatewayResponse: text(data.gateway_response),
      transactionId: data.id === undefined || data.id === null ? null : String(data.id),
      failureCode: status === 'failed' ? (text(data.status) ?? 'failed') : null,
      failureMessage: status === 'failed' ? text(data.gateway_response) : null,
    }
  }

  async refund(input: {
    reference: string
    amountMinor: number
    note: string
  }): Promise<ProviderRefund> {
    const response = await this.request<PaystackRefundData>('POST', '/refund', {
      transaction: input.reference,
      amount: input.amountMinor,
      merchant_note: input.note,
    })

    if (!response.ok || !response.data) {
      return {
        reference: input.reference,
        status: 'failed',
        refundReference: null,
        expectedAt: null,
      }
    }

    const data = response.data
    const status = REFUND_STATUSES.has(data.status as ProviderRefund['status'])
      ? (data.status as ProviderRefund['status'])
      : 'pending'

    return {
      reference: input.reference,
      status,
      refundReference:
        text(data.refund_reference) ??
        (data.id === undefined || data.id === null ? null : String(data.id)),
      expectedAt: text(data.expected_at),
    }
  }

  private toChargeResult(
    input: ChargeInput,
    response: RequestOutcome<PaystackChargeData>,
    fallbackStatus: ProviderChargeResult['status'],
  ): ProviderChargeResult {
    if (!response.ok || !response.data) {
      return failureResult(input, response.message)
    }

    const data = response.data
    const providerStatus = text(data.status)
    const status = (providerStatus ? CHARGE_STATUS[providerStatus] : undefined) ?? fallbackStatus
    const failed = status === 'FAILED'

    return {
      reference: text(data.reference) ?? input.reference,
      status,
      displayText: text(data.display_text),
      authorizationUrl: text(data.authorization_url),
      accountNumber: text(data.account_number),
      accountName: text(data.account_name),
      accountBank: text(data.bank),
      expiresAt: text(data.account_expires_at),
      transactionId: data.id === undefined || data.id === null ? null : String(data.id),
      failureCode: failed ? (providerStatus ?? 'failed') : null,
      failureMessage: failed ? (text(data.gateway_response) ?? response.message) : null,
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown,
  ): Promise<RequestOutcome<T>> {
    const startedAt = performance.now()
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      // A timeout or a socket failure is "we do not know", never a decline.
      logger.warn(
        {
          provider: 'PAYSTACK',
          endpoint,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'payment provider unreachable',
      )
      throw new ProviderUnavailableError()
    }

    const durationMs = Math.round(performance.now() - startedAt)

    // Only the endpoint, the status and the duration. Never the body or headers.
    logger.info(
      { provider: 'PAYSTACK', endpoint, status: response.status, durationMs },
      'provider request',
    )

    if (response.status >= 500) {
      throw new ProviderUnavailableError()
    }

    let envelope: PaystackEnvelope<T> | null = null
    try {
      envelope = (await response.json()) as PaystackEnvelope<T>
    } catch {
      envelope = null
    }

    if (!response.ok || envelope?.status === false || !envelope) {
      return {
        ok: false,
        status: response.status,
        message: text(envelope?.message) ?? 'The payment provider rejected the request',
        data: null,
      }
    }

    return {
      ok: true,
      status: response.status,
      message: text(envelope.message) ?? 'OK',
      data: envelope.data ?? null,
    }
  }
}
