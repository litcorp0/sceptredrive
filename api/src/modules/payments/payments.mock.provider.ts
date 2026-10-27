import type {
  ChargeInput,
  PaymentProvider,
  ProviderChargeResult,
  ProviderRefund,
  ProviderVerification,
} from './payments.provider.ts'
import type { MockSettlementOutcome, PaymentMethod } from './payments.types.ts'

/**
 * A process-local provider for development, CI and the mock walkthrough.
 *
 * It holds state in module-level maps on purpose: a mock has no business
 * surviving a restart, and a test can wipe it with `resetMockProvider()`. The
 * call counters exist so an idempotency test can prove that a retried POST did
 * not reach the provider a second time.
 */

interface MockChargeRecord {
  reference: string
  amountMinor: number
  method: PaymentMethod
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED'
  expiresAt: Date
  displayText: string | null
  authorizationUrl: string | null
  accountNumber: string | null
  accountName: string | null
  accountBank: string | null
  channel: string
  paidAt: Date | null
}

interface MockRefundRecord {
  reference: string
  status: ProviderRefund['status']
  refundReference: string
}

const charges = new Map<string, MockChargeRecord>()
const refunds = new Map<string, MockRefundRecord>()

interface MockCallCounts {
  charge: number
  verify: number
  refund: number
}

let calls: MockCallCounts = { charge: 0, verify: 0, refund: 0 }

const MOMO_EXPIRY_MS = 180_000
const BANK_TRANSFER_EXPIRY_MS = 15 * 60_000
const CARD_EXPIRY_MS = 30 * 60_000

function baseResult(
  input: ChargeInput,
  status: ProviderChargeResult['status'],
  record: Partial<MockChargeRecord>,
): ProviderChargeResult {
  return {
    reference: input.reference,
    status,
    displayText: record.displayText ?? null,
    authorizationUrl: record.authorizationUrl ?? null,
    accountNumber: record.accountNumber ?? null,
    accountName: record.accountName ?? null,
    accountBank: record.accountBank ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    transactionId: null,
    failureCode: null,
    failureMessage: null,
  }
}

function store(input: ChargeInput, record: Omit<MockChargeRecord, 'reference'>) {
  charges.set(input.reference, { reference: input.reference, ...record })
}

function verification(record: MockChargeRecord): ProviderVerification {
  switch (record.status) {
    case 'PAID':
      return {
        reference: record.reference,
        status: 'success',
        amountMinor: record.amountMinor,
        currency: 'GHS',
        channel: record.channel,
        paidAt: (record.paidAt ?? new Date()).toISOString(),
        gatewayResponse: 'Mock payment approved',
      }
    case 'FAILED':
      return {
        reference: record.reference,
        status: 'failed',
        amountMinor: record.amountMinor,
        currency: 'GHS',
        channel: record.channel,
        paidAt: null,
        gatewayResponse: 'Mock payment failed',
        failureCode: 'failed',
        failureMessage: 'Mock payment failed',
      }
    case 'EXPIRED':
      return {
        reference: record.reference,
        status: 'abandoned',
        amountMinor: record.amountMinor,
        currency: 'GHS',
        channel: record.channel,
        paidAt: null,
        gatewayResponse: 'Mock payment expired',
        failureCode: 'abandoned',
        failureMessage: 'Mock payment expired',
      }
    default:
      return {
        reference: record.reference,
        status: 'pending',
        amountMinor: record.amountMinor,
        currency: 'GHS',
        channel: record.channel,
        paidAt: null,
        gatewayResponse: 'Awaiting authorisation',
      }
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK' as const

  async createMobileMoneyCharge(input: ChargeInput): Promise<ProviderChargeResult> {
    calls.charge += 1
    const expiresAt = new Date(Date.now() + MOMO_EXPIRY_MS)
    const record = {
      amountMinor: input.amountMinor,
      method: 'MOMO' as const,
      status: 'PENDING' as const,
      expiresAt,
      displayText: "Approve the prompt on the customer's phone",
      authorizationUrl: null,
      accountNumber: null,
      accountName: null,
      accountBank: null,
      channel: 'mobile_money',
      paidAt: null,
    }
    store(input, record)
    return baseResult(input, 'PAY_OFFLINE', record)
  }

  async createCardCheckout(input: ChargeInput): Promise<ProviderChargeResult> {
    calls.charge += 1
    const record = {
      amountMinor: input.amountMinor,
      method: 'CARD' as const,
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() + CARD_EXPIRY_MS),
      displayText: null,
      authorizationUrl: `https://checkout.paystack.com/mock/${input.reference}`,
      accountNumber: null,
      accountName: null,
      accountBank: null,
      channel: 'card',
      paidAt: null,
    }
    store(input, record)
    return baseResult(input, 'PENDING', record)
  }

  async createBankTransferCharge(input: ChargeInput): Promise<ProviderChargeResult> {
    calls.charge += 1
    const record = {
      amountMinor: input.amountMinor,
      method: 'BANK_TRANSFER' as const,
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() + BANK_TRANSFER_EXPIRY_MS),
      displayText: 'Transfer the exact amount to the account shown',
      authorizationUrl: null,
      accountNumber: '1234567890',
      accountName: 'Sceptre Drive Mock',
      accountBank: 'Test Bank',
      channel: 'bank_transfer',
      paidAt: null,
    }
    store(input, record)
    return baseResult(input, 'PENDING_BANK_TRANSFER', record)
  }

  async verify(reference: string): Promise<ProviderVerification> {
    calls.verify += 1
    const record = charges.get(reference)
    if (!record) {
      return {
        reference,
        status: 'pending',
        amountMinor: 0,
        currency: 'GHS',
        channel: null,
        paidAt: null,
        gatewayResponse: 'Unknown mock reference',
      }
    }
    return verification(record)
  }

  async refund(input: {
    reference: string
    amountMinor: number
    note: string
  }): Promise<ProviderRefund> {
    calls.refund += 1
    const refundReference = `mock-refund-${input.reference}`
    refunds.set(input.reference, { reference: input.reference, status: 'pending', refundReference })
    return {
      reference: input.reference,
      status: 'pending',
      refundReference,
      expectedAt: null,
    }
  }
}

/** Harness hook: the till polls `verify`, which reports what this sets. */
export function settleMockPayment(reference: string, outcome: MockSettlementOutcome): boolean {
  const record = charges.get(reference)
  if (!record) return false
  record.status = outcome === 'PAID' ? 'PAID' : outcome === 'FAILED' ? 'FAILED' : 'EXPIRED'
  record.paidAt = outcome === 'PAID' ? new Date() : null
  return true
}

/** Harness hook for the refund flow owned by a later plan. */
export function settleMockRefund(reference: string, status: ProviderRefund['status']): boolean {
  const record = refunds.get(reference)
  if (!record) return false
  record.status = status
  return true
}

export function getMockCallCounts(): MockCallCounts {
  return { ...calls }
}

/** A test resets this between cases; module state is deliberately process-local. */
export function resetMockProvider(): void {
  charges.clear()
  refunds.clear()
  calls = { charge: 0, verify: 0, refund: 0 }
}
