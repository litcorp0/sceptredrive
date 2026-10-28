/**
 * Payment intent types. The server owns every value here: the till mints a
 * `clientPaymentId` and an amount, and receives a view it may only display.
 * Nothing in this file is a request shape except `CreatePaymentInput`, which the
 * route validator builds from a strict body (P13-D6, P13-D15).
 */

export type PaymentMethod = 'MOMO' | 'CARD' | 'BANK_TRANSFER'

export type MobileMoneyProvider = 'mtn' | 'atl' | 'vod'

export type PaymentMode = 'mock' | 'test' | 'live'

export interface MobileMoneyInput {
  provider: MobileMoneyProvider
  /** Normalised to E.164 (`+233…`) before it reaches the provider. */
  phone: string
}

export interface CreatePaymentInput {
  method: PaymentMethod
  amountMinor: number
  clientPaymentId: string
  shiftId: string
  mobileMoney?: MobileMoneyInput
}

/**
 * What the terminal may see. `providerEmail` is deliberately absent: it is a
 * routing label, never a contact channel and never shown (P13-D7). Card data has
 * no representation at all (P13-D15).
 */
export interface PaymentView {
  id: string
  clientPaymentId: string
  shiftId: string
  method: PaymentMethod
  amountMinor: number
  provider: 'PAYSTACK' | 'MOCK'
  providerReference: string
  status: 'PENDING' | 'PAID' | 'FAILED' | 'ABANDONED' | 'EXPIRED'
  channel: string | null
  displayText: string | null
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

export type MockSettlementOutcome = 'PAID' | 'FAILED' | 'EXPIRED'

/**
 * The outcomes the mock transfer harness can settle into. Uppercase on purpose:
 * the body is strict, so `paid` or `SUCCESS ` is a 400 rather than a settlement
 * that silently moved nothing (the provider's own vocabulary is lowercase).
 */
export type MockTransferSettlementOutcome = 'SUCCESS' | 'FAILED' | 'REVERSED'

export interface MockSettleTransferInput {
  /** Our `sdt-…` reference, never the provider's transfer code. */
  reference: string
  outcome: MockTransferSettlementOutcome
}

export interface PaymentQuery {
  refresh: boolean
}

export interface ClaimPaymentInput {
  saleId: string
}
