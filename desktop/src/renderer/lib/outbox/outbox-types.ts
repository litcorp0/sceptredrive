import type { UploadItemResult } from '../api/types'

/**
 * Durable outbox vocabulary and pure retry math (Plan 08 Task 1).
 *
 * One row is one **client transaction** — a sale, shift open, cash movement,
 * shift close, and since Phase 13 a refund, a credit repayment or a cart void —
 * and the server applies it atomically. The state machine never deletes a row:
 * `acked` is the terminal success state, `dead_letter` needs a human, and
 * everything else is still owed to the server.
 */

export const OUTBOX_STATUSES = ['pending', 'in_flight', 'acked', 'conflict', 'dead_letter'] as const
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

export const OUTBOX_TYPES = [
  'SALE',
  'SHIFT_OPEN',
  'CASH_MOVEMENT',
  'SHIFT_CLOSE',
  // Phase 13: the till can take money back and park a cart with the cable
  // unplugged, so neither can be a request (P13-D18/D27/D28).
  'REFUND',
  'CREDIT_REPAYMENT',
  'CART_VOID',
] as const
export type OutboxType = (typeof OUTBOX_TYPES)[number]

export interface OutboxRow {
  id: string
  clientTransactionId: string
  type: OutboxType
  occurredAt: string
  payloadVersion: number
  /** Parsed JSON payload; `null` means the row is corrupt (dead-letter it). */
  payload: unknown
  status: OutboxStatus
  attempts: number
  nextAttemptAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  serverResult: UploadItemResult | null
  ackedAt: string | null
  createdAt: string
  updatedAt: string
  /** Present when the row is a sale: the receipt it belongs to. */
  receiptNumber?: string | null
}

export interface UploadTransaction {
  clientTransactionId: string
  type: OutboxType
  occurredAt: string
  payloadVersion: number
  payload: unknown
}

export function toUploadTransaction(row: OutboxRow): UploadTransaction {
  return {
    clientTransactionId: row.clientTransactionId,
    type: row.type,
    occurredAt: row.occurredAt,
    payloadVersion: row.payloadVersion,
    payload: row.payload,
  }
}

/** D11's byte/storage bound; errors are informational, never payload data. */
export const MAX_ERROR_MESSAGE = 200

export function errorSummary(code: string, message: string): string {
  return `${code}: ${message}`.slice(0, MAX_ERROR_MESSAGE)
}

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_CAP_MS = 5 * 60_000
/** A malicious/incorrect Retry-After must not park the queue for a day. */
export const RETRY_AFTER_CAP_MS = 60 * 60_000

/**
 * Exponential backoff with ±20% jitter: `min(1s × 2^attempts, 5m)`.
 *
 * `attempts` is the number of **failed** upload attempts, so the first retry is
 * ~1s and the cap is reached after nine failures. The jitter prevents a fleet of
 * terminals reconnecting after an outage at the same instant.
 */
export function backoffDelay(attempts: number, random: () => number = Math.random): number {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0
  const base = Math.min(BACKOFF_BASE_MS * 2 ** safeAttempts, BACKOFF_CAP_MS)
  const jitter = base * 0.2 * (random() * 2 - 1)
  return Math.max(500, Math.round(base + jitter))
}

/**
 * Parses the two RFC 9110 forms of `Retry-After`: delta-seconds or HTTP-date.
 * Returns milliseconds from `now`, or null when the header is absent/invalid.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1_000, RETRY_AFTER_CAP_MS)
  }
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.min(Math.max(0, date - now), RETRY_AFTER_CAP_MS)
}

/** Structural so the uploader never imports the API client (test-friendly). */
export interface RetryableError {
  status?: number
  code?: string
  message?: string
  retryAfterSeconds?: number | null
}

export function isRetryableShape(error: unknown): error is RetryableError {
  return Boolean(error) && typeof error === 'object'
}
