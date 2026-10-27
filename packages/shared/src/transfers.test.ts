import { describe, expect, it } from 'vitest'
import {
  isTerminalTransferStatus,
  mapProviderTransferStatus,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUSES,
  transferMovedMoney,
} from './transfers.ts'

describe('transfer vocabulary', () => {
  it('labels every status in words', () => {
    expect(TRANSFER_STATUSES).toEqual([
      'PENDING',
      'AWAITING_OTP',
      'SUCCESS',
      'FAILED',
      'REVERSED',
      'BLOCKED',
      'REJECTED',
    ])
    for (const status of TRANSFER_STATUSES) {
      expect(TRANSFER_STATUS_LABELS[status].length).toBeGreaterThan(0)
      expect(TRANSFER_STATUS_LABELS[status]).not.toBe(status)
    }
  })

  it("maps Paystack's seven spellings to our statuses", () => {
    expect(mapProviderTransferStatus('pending')).toBe('PENDING')
    expect(mapProviderTransferStatus('otp')).toBe('AWAITING_OTP')
    expect(mapProviderTransferStatus('success')).toBe('SUCCESS')
    expect(mapProviderTransferStatus('failed')).toBe('FAILED')
    expect(mapProviderTransferStatus('reversed')).toBe('REVERSED')
    expect(mapProviderTransferStatus('blocked')).toBe('BLOCKED')
    expect(mapProviderTransferStatus('rejected')).toBe('REJECTED')
    expect(mapProviderTransferStatus('SUCCESS')).toBe('SUCCESS')
  })

  it('maps an unknown status to null rather than a failure', () => {
    expect(mapProviderTransferStatus('abandoned')).toBeNull()
    expect(mapProviderTransferStatus('')).toBeNull()
  })

  it('counts only SUCCESS as money moved', () => {
    expect(transferMovedMoney('SUCCESS')).toBe(true)
    // A reversal is money that came back; it is not a payment.
    expect(transferMovedMoney('REVERSED')).toBe(false)
    expect(transferMovedMoney('FAILED')).toBe(false)
    expect(transferMovedMoney('PENDING')).toBe(false)
  })

  it('treats five statuses as terminal and two as still moving', () => {
    for (const status of ['SUCCESS', 'FAILED', 'REVERSED', 'BLOCKED', 'REJECTED'] as const) {
      expect(isTerminalTransferStatus(status)).toBe(true)
    }
    expect(isTerminalTransferStatus('PENDING')).toBe(false)
    expect(isTerminalTransferStatus('AWAITING_OTP')).toBe(false)
  })
})
