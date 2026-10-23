import { describe, expect, it } from 'vitest'
import type { OutboxRow } from './outbox-types'
import {
  backoffDelay,
  errorSummary,
  MAX_ERROR_MESSAGE,
  parseRetryAfter,
  RETRY_AFTER_CAP_MS,
  toUploadTransaction,
} from './outbox-types'

/** Pure retry math — the part that must be exactly predictable in the field. */

describe('backoffDelay', () => {
  it('doubles from one second and caps at five minutes (no jitter at 0.5)', () => {
    const noJitter = () => 0.5
    expect(backoffDelay(0, noJitter)).toBe(1_000)
    expect(backoffDelay(1, noJitter)).toBe(2_000)
    expect(backoffDelay(2, noJitter)).toBe(4_000)
    expect(backoffDelay(3, noJitter)).toBe(8_000)
    expect(backoffDelay(8, noJitter)).toBe(256_000)
    expect(backoffDelay(9, noJitter)).toBe(300_000)
    expect(backoffDelay(50, noJitter)).toBe(300_000)
  })

  it('adds at most ±20% jitter and never drops below half a second', () => {
    expect(backoffDelay(0, () => 0)).toBe(800)
    expect(backoffDelay(0, () => 1)).toBe(1_200)
    expect(backoffDelay(20, () => 0)).toBe(240_000)
    expect(backoffDelay(20, () => 1)).toBe(360_000)
  })

  it('treats negative/corrupt attempt counts as zero', () => {
    expect(backoffDelay(-5, () => 0.5)).toBe(1_000)
    expect(backoffDelay(Number.NaN, () => 0.5)).toBe(1_000)
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-23T10:00:00.000Z')

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter('0', now)).toBe(0)
  })

  it('parses an HTTP-date', () => {
    expect(parseRetryAfter('Fri, 23 Oct 2026 10:01:30 GMT', now)).toBe(90_000)
    expect(parseRetryAfter('Fri, 23 Oct 2026 09:00:00 GMT', now)).toBe(0)
  })

  it('caps a hostile value and ignores nonsense', () => {
    expect(parseRetryAfter('999999', now)).toBe(RETRY_AFTER_CAP_MS)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter('', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })
})

describe('error text', () => {
  it('bounds what reaches the database/UI', () => {
    const text = errorSummary('SERVER', 'x'.repeat(500))
    expect(text.length).toBe(MAX_ERROR_MESSAGE)
    expect(text.startsWith('SERVER: ')).toBe(true)
  })
})

describe('toUploadTransaction', () => {
  it('copies exactly the contract fields and never the local status', () => {
    const row: OutboxRow = {
      id: 'sale-1',
      clientTransactionId: 'sale-1',
      type: 'SALE',
      occurredAt: '2026-10-23T10:00:00.000Z',
      payloadVersion: 1,
      payload: { receiptNumber: 'R-1' },
      status: 'in_flight',
      attempts: 3,
      nextAttemptAt: null,
      lastErrorCode: 'X',
      lastErrorMessage: 'y',
      serverResult: null,
      ackedAt: null,
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
    }

    expect(toUploadTransaction(row)).toEqual({
      clientTransactionId: 'sale-1',
      type: 'SALE',
      occurredAt: '2026-10-23T10:00:00.000Z',
      payloadVersion: 1,
      payload: { receiptNumber: 'R-1' },
    })
  })
})
