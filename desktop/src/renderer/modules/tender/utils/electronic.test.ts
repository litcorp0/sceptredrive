import { describe, expect, it } from 'vitest'
import type { PaymentView } from '@/lib/api/payments-client'
import {
  type ElectronicTender,
  normalizeMomoPhone,
  PAYMENT_EXPIRED_MESSAGE,
  transition,
} from './electronic'

const EXPIRES = '2026-10-27T14:03:00.000Z'
const BEFORE = Date.parse('2026-10-27T14:02:00.000Z')
const AFTER = Date.parse('2026-10-27T14:03:01.000Z')

function payment(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
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
    expiresAt: EXPIRES,
    paidAt: null,
    failedCode: null,
    failedMessage: null,
    orphaned: false,
    createdAt: '2026-10-27T14:00:00.000Z',
    ...overrides,
  }
}

function pending(): ElectronicTender {
  const outcome = transition(null, {
    type: 'resume',
    row: {
      paymentId: 'pay_1',
      method: 'MOMO',
      amountMinor: 5_000,
      status: 'PENDING',
      displayText: 'Approve the prompt on your phone',
      expiresAt: EXPIRES,
      providerReference: 'sd-cp_1',
    },
    now: BEFORE,
  })
  if (!outcome.tender) throw new Error('resume should keep a pending tender')
  return outcome.tender
}

describe('electronic tender state machine', () => {
  it('adds the tender line when the server says PAID, and only once', () => {
    const first = transition(pending(), {
      type: 'update',
      payment: payment({ status: 'PAID' }),
      now: BEFORE,
    })

    expect(first.tender?.status).toBe('PAID')
    expect(first.addTender).toBe(true)
    expect(first.shouldPoll).toBe(false)
    expect(first.abandon).toBe(false)

    const second = transition(first.tender, {
      type: 'update',
      payment: payment({ status: 'PAID' }),
      now: BEFORE,
    })
    expect(second.addTender).toBe(false)
  })

  it('shows a provider failure and does not touch the other tenders', () => {
    const outcome = transition(pending(), {
      type: 'update',
      payment: payment({ status: 'FAILED', failedMessage: 'Insufficient funds' }),
      now: BEFORE,
    })

    expect(outcome.tender?.status).toBe('FAILED')
    expect(outcome.message).toBe('Insufficient funds')
    // Nothing signals "remove the cash tender already added".
    expect(outcome.addTender).toBe(false)
    expect(outcome.shouldPoll).toBe(false)
  })

  it('abandons exactly once when the clock passes expires_at', () => {
    const atExpiry = transition(pending(), {
      type: 'update',
      payment: payment(),
      now: AFTER,
    })

    expect(atExpiry.abandon).toBe(true)
    expect(atExpiry.shouldPoll).toBe(false)
    expect(atExpiry.message).toBe(PAYMENT_EXPIRED_MESSAGE)

    const again = transition(atExpiry.tender, {
      type: 'update',
      payment: payment(),
      now: AFTER + 3_000,
    })
    expect(again.abandon).toBe(false)
  })

  it('keeps polling while PENDING and before expiry', () => {
    const outcome = transition(pending(), { type: 'update', payment: payment(), now: BEFORE })

    expect(outcome.shouldPoll).toBe(true)
    expect(outcome.abandon).toBe(false)
    expect(outcome.addTender).toBe(false)
  })

  it('carries the provider OTP demand to the screen without settling the tender', () => {
    const outcome = transition(pending(), {
      type: 'update',
      payment: payment({
        requiresOtp: true,
        displayText: 'Enter the one-time code sent to the phone',
      }),
      now: BEFORE,
    })

    expect(outcome.tender?.requiresOtp).toBe(true)
    expect(outcome.tender?.status).toBe('PENDING')
    expect(outcome.shouldPoll).toBe(true)
    expect(outcome.addTender).toBe(false)
  })

  it('resumes a PAID row without polling', () => {
    const outcome = transition(null, {
      type: 'resume',
      row: {
        paymentId: 'pay_1',
        method: 'MOMO',
        amountMinor: 5_000,
        status: 'PAID',
        displayText: null,
        expiresAt: EXPIRES,
        providerReference: 'sd-cp_1',
      },
      now: AFTER,
    })

    expect(outcome.tender?.status).toBe('PAID')
    expect(outcome.addTender).toBe(true)
    expect(outcome.shouldPoll).toBe(false)
  })

  it('drops a resumed EXPIRED row with one sentence', () => {
    const outcome = transition(null, {
      type: 'resume',
      row: {
        paymentId: 'pay_1',
        method: 'MOMO',
        amountMinor: 5_000,
        status: 'EXPIRED',
        displayText: null,
        expiresAt: EXPIRES,
        providerReference: 'sd-cp_1',
      },
      now: AFTER,
    })

    expect(outcome.tender).toBeNull()
    expect(outcome.addTender).toBe(false)
    expect(outcome.message).toBe(PAYMENT_EXPIRED_MESSAGE)
  })

  it('resumes a still-valid PENDING row with its remaining time', () => {
    const outcome = transition(null, {
      type: 'resume',
      row: {
        paymentId: 'pay_1',
        method: 'MOMO',
        amountMinor: 5_000,
        status: 'PENDING',
        displayText: 'Approve the prompt on your phone',
        expiresAt: EXPIRES,
        providerReference: 'sd-cp_1',
      },
      now: BEFORE,
    })

    expect(outcome.shouldPoll).toBe(true)
    expect(outcome.tender?.paymentId).toBe('pay_1')
  })

  it('abandons a resumed PENDING row that expired during the restart', () => {
    const outcome = transition(null, {
      type: 'resume',
      row: {
        paymentId: 'pay_1',
        method: 'MOMO',
        amountMinor: 5_000,
        status: 'PENDING',
        displayText: null,
        expiresAt: EXPIRES,
        providerReference: 'sd-cp_1',
      },
      now: AFTER,
    })

    expect(outcome.abandon).toBe(true)
    expect(outcome.shouldPoll).toBe(false)
  })
})

describe('normalizeMomoPhone', () => {
  it('turns a local Ghana number into E.164 for the provider', () => {
    expect(normalizeMomoPhone('024 123 4567')).toBe('+233241234567')
    expect(normalizeMomoPhone('233241234567')).toBe('+233241234567')
    expect(normalizeMomoPhone('+233 24 123 4567')).toBe('+233241234567')
  })

  it('rejects what is not a Ghana number', () => {
    expect(normalizeMomoPhone('not a phone')).toBeNull()
    expect(normalizeMomoPhone('024 123')).toBeNull()
  })
})
