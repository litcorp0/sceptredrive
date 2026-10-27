import { createHash } from 'node:crypto'
import type {
  ChargeInput,
  PaymentProvider,
  ProviderBalance,
  ProviderChargeResult,
  ProviderRefund,
  ProviderTransferInput,
  ProviderTransferResult,
  ProviderTransferStatus,
  ProviderVerification,
  TransferRecipientInput,
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

/** The one OTP the mock accepts; a test signs in with anything else to fail. */
export const MOCK_TRANSFER_OTP = '123456'

/** Enough for any fixture; a test lowers it to prove the precheck (P14-D29). */
const DEFAULT_MOCK_BALANCE_MINOR = 100_000_000

interface MockRecipientRecord {
  recipientCode: string
  type: 'ghipss' | 'mobile_money'
  accountNumber: string
  bankCode: string
  name: string
}

interface MockTransferRecord {
  reference: string
  recipientCode: string
  amountMinor: number
  reason: string
  status: ProviderTransferStatus
  transferCode: string
  transferId: string
  failureCode: string | null
  failureMessage: string | null
  transferredAt: Date | null
}

const recipients = new Map<string, MockRecipientRecord>()
const transfers = new Map<string, MockTransferRecord>()
const awaitingOtp = new Set<string>()
let otpForNextTransfer = false
let balanceMinor = DEFAULT_MOCK_BALANCE_MINOR

interface MockCallCounts {
  charge: number
  verify: number
  refund: number
  recipient: number
  transfer: number
  balance: number
}

let calls: MockCallCounts = {
  charge: 0,
  verify: 0,
  refund: 0,
  recipient: 0,
  transfer: 0,
  balance: 0,
}

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

  /**
   * Recipients are deterministic from the destination, so a test can prove the
   * service reuses the stored code instead of minting a second one.
   */
  async createTransferRecipient(input: TransferRecipientInput): Promise<{ recipientCode: string }> {
    calls.recipient += 1
    const key = `${input.type}|${input.accountNumber}|${input.bankCode}`
    const existing = recipients.get(key)
    if (existing) return { recipientCode: existing.recipientCode }

    const digest = createHash('sha256').update(key).digest('hex').slice(0, 16)
    const record: MockRecipientRecord = {
      recipientCode: `RCP_mock_${digest}`,
      type: input.type,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      name: input.name,
    }
    recipients.set(key, record)
    return { recipientCode: record.recipientCode }
  }

  /**
   * The delayed path is the mock's whole point: test keys at Paystack return
   * `success` immediately, so a mock that did the same would never exercise the
   * webhook (P14 research 4).
   */
  async initiateTransfer(input: ProviderTransferInput): Promise<ProviderTransferResult> {
    calls.transfer += 1
    const transferCode = `TRF_mock_${input.reference.slice(-10)}`
    const wantsOtp = otpForNextTransfer || awaitingOtp.has(input.reference)
    otpForNextTransfer = false

    const insufficient = input.amountMinor > balanceMinor
    if (insufficient) awaitingOtp.delete(input.reference)

    const record: MockTransferRecord = {
      reference: input.reference,
      recipientCode: input.recipientCode,
      amountMinor: input.amountMinor,
      reason: input.reason,
      status: insufficient ? 'failed' : wantsOtp ? 'otp' : 'pending',
      transferCode,
      transferId: String(1_000_000 + transfers.size),
      failureCode: insufficient ? 'insufficient_balance' : null,
      failureMessage: insufficient ? 'Your balance is not enough to fulfill this request' : null,
      transferredAt: null,
    }
    transfers.set(input.reference, record)
    return transferResult(record)
  }

  async finalizeTransfer(input: {
    transferCode: string
    otp: string
  }): Promise<ProviderTransferResult> {
    const record = [...transfers.values()].find(
      (candidate) => candidate.transferCode === input.transferCode,
    )
    if (!record) {
      return {
        reference: '',
        status: 'otp',
        transferCode: input.transferCode,
        transferId: null,
        amountMinor: 0,
        currency: 'GHS',
        failureCode: 'transfer_not_found',
        failureMessage: 'Transfer not found',
        transferredAt: null,
        feeMinor: null,
      }
    }

    if (input.otp !== MOCK_TRANSFER_OTP) {
      return {
        ...transferResult(record),
        status: 'otp',
        failureCode: 'otp_invalid',
        failureMessage: 'Transfer OTP is invalid',
      }
    }

    record.status = 'pending'
    record.failureCode = null
    record.failureMessage = null
    awaitingOtp.delete(record.reference)
    return transferResult(record)
  }

  async verifyTransfer(reference: string): Promise<ProviderTransferResult> {
    const record = transfers.get(reference)
    if (!record) {
      return {
        reference,
        status: 'pending',
        transferCode: null,
        transferId: null,
        amountMinor: 0,
        currency: 'GHS',
        failureCode: null,
        failureMessage: null,
        transferredAt: null,
        feeMinor: null,
      }
    }
    return transferResult(record)
  }

  async getBalance(): Promise<ProviderBalance | null> {
    calls.balance += 1
    return { currency: 'GHS', balanceMinor }
  }
}

function transferResult(record: MockTransferRecord, feeMinor: number | null = 0) {
  return {
    reference: record.reference,
    status: record.status,
    transferCode: record.transferCode,
    transferId: record.transferId,
    amountMinor: record.amountMinor,
    currency: 'GHS' as const,
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    transferredAt: record.transferredAt?.toISOString() ?? null,
    feeMinor,
  }
}

/**
 * Harness hooks for the transfer lifecycle. The mock never settles by itself:
 * a test (or the webhook test) moves a transfer the way Paystack's webhook does.
 */
export function settleMockTransfer(
  reference: string,
  status: 'success' | 'failed' | 'reversed',
): boolean {
  const record = transfers.get(reference)
  if (!record) return false
  record.status = status
  record.transferredAt = status === 'success' ? new Date() : record.transferredAt
  record.failureCode = status === 'failed' ? 'failed' : status === 'reversed' ? 'reversed' : null
  record.failureMessage =
    status === 'failed'
      ? 'Mock transfer failed'
      : status === 'reversed'
        ? 'Mock transfer reversed'
        : null
  return true
}

/**
 * Makes the next initiation demand an OTP. With a reference it targets that
 * transfer — which a server-minted reference makes impossible to know in
 * advance, hence the one-shot form a test normally uses.
 */
export function requestMockOtp(reference?: string): void {
  if (reference) awaitingOtp.add(reference)
  else otpForNextTransfer = true
}

/** Lowers the mock's GHS balance so the precheck can be proven to refuse. */
export function setMockTransferBalance(minor: number): void {
  balanceMinor = minor
}

export function getMockTransferByReference(reference: string): {
  recipientCode: string
  status: ProviderTransferStatus
} | null {
  const record = transfers.get(reference)
  return record ? { recipientCode: record.recipientCode, status: record.status } : null
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
  recipients.clear()
  transfers.clear()
  awaitingOtp.clear()
  otpForNextTransfer = false
  balanceMinor = DEFAULT_MOCK_BALANCE_MINOR
  calls = { charge: 0, verify: 0, refund: 0, recipient: 0, transfer: 0, balance: 0 }
}
