import { env } from '../../config/env.ts'
import { MockPaymentProvider } from './payments.mock.provider.ts'
import { PaystackPaymentProvider } from './payments.paystack.provider.ts'

/**
 * The provider seam (P13-D10). Two implementations answer, and nothing above
 * this file knows which one is live except the factory.
 *
 * Every method returns a result. The only exception a method may throw is
 * `ProviderUnavailableError`: a network failure, a timeout or a 5xx means "we do
 * not know", which the service keeps as `PENDING`. Any other failure — a decline,
 * a rejected request — is a result with `status: 'FAILED'` and a message. That
 * split is what lets a timeout stay pending while a decline becomes terminal.
 */

export interface ChargeInput {
  reference: string
  amountMinor: number
  email: string
  currency: 'GHS'
  metadata: { paymentId: string; terminalId: string; branchId: string }
  mobileMoney?: { provider: 'mtn' | 'atl' | 'vod'; phone: string }
  bankTransfer?: { accountExpiresAt: string }
}

export type ProviderChargeStatus =
  | 'PENDING'
  | 'PAY_OFFLINE'
  | 'PENDING_BANK_TRANSFER'
  | 'SUCCESS'
  | 'FAILED'

export interface ProviderChargeResult {
  reference: string
  status: ProviderChargeStatus
  displayText: string | null
  authorizationUrl: string | null
  accountNumber: string | null
  accountName: string | null
  accountBank: string | null
  expiresAt: string | null
  /** The provider's transaction id, as text: it is a u64, not a JS number. */
  transactionId: string | null
  failureCode: string | null
  failureMessage: string | null
}

export interface ProviderVerification {
  reference: string
  status: 'success' | 'failed' | 'abandoned' | 'pending' | 'ongoing' | 'reversed'
  amountMinor: number
  currency: string
  channel: string | null
  paidAt: string | null
  gatewayResponse: string | null
  /** Optional extras a verification or webhook can carry; never persisted raw. */
  transactionId?: string | null
  failureCode?: string | null
  failureMessage?: string | null
}

export interface ProviderRefund {
  reference: string
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'needs-attention'
  refundReference: string | null
  expectedAt: string | null
}

export interface PaymentProvider {
  readonly name: 'PAYSTACK' | 'MOCK'
  createMobileMoneyCharge(input: ChargeInput): Promise<ProviderChargeResult>
  createCardCheckout(input: ChargeInput): Promise<ProviderChargeResult>
  createBankTransferCharge(input: ChargeInput): Promise<ProviderChargeResult>
  verify(reference: string): Promise<ProviderVerification>
  refund(input: { reference: string; amountMinor: number; note: string }): Promise<ProviderRefund>
}

/** A retryable provider condition: the payment is uncertain, not declined. */
export class ProviderUnavailableError extends Error {
  constructor(message = 'The payment provider is unavailable') {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}

let cached: PaymentProvider | null = null

/**
 * One provider per process. `mock` needs no credentials; `test`/`live` are
 * refused at boot by `env.ts` when the secret key is absent, and the second check
 * here keeps a direct caller honest.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached

  if (env.PAYSTACK_MODE === 'mock') {
    cached = new MockPaymentProvider()
    return cached
  }

  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error(`PAYSTACK_SECRET_KEY is required when PAYSTACK_MODE is '${env.PAYSTACK_MODE}'`)
  }

  cached = new PaystackPaymentProvider({
    secretKey: env.PAYSTACK_SECRET_KEY,
    baseUrl: env.PAYSTACK_BASE_URL,
  })
  return cached
}
