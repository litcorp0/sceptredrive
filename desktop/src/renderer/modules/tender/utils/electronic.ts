import { normalizeGhanaPhone } from '@sceptre/shared'
import type {
  MobileMoneyProvider,
  PaymentMethod,
  PaymentStatus,
  PaymentView,
} from '@/lib/api/payments-client'

/**
 * The electronic tender's state machine, extracted from the panel (Plan 09).
 *
 * Three rules are enforced here rather than in JSX, because they are the rules
 * that lose money when they are wrong:
 *
 * - an electronic tender becomes money only on `PAID`, never on "the charge was
 *   accepted"; a `FAILED` result keeps every other tender on the sale;
 * - the 180-second stop calls `abandon` **once** per payment, even if polling
 *   and a re-render race (P13-D8);
 * - a resumed `PAID` row adds its line without polling, and a resumed
 *   `EXPIRED`/`FAILED` row is dropped with one sentence.
 */

export type MomoProvider = MobileMoneyProvider

export const MOMO_PROVIDERS = ['mtn', 'atl', 'vod'] as const

export const MOMO_PROVIDER_LABELS: Record<MobileMoneyProvider, string> = {
  mtn: 'MTN MoMo',
  atl: 'AirtelTigo Money',
  vod: 'Telecel Cash',
}

/** The poll cadence the server's rate limit and Paystack's 180 s both tolerate. */
export const PAYMENT_POLL_INTERVAL_MS = 3_000

export const PAYMENT_EXPIRED_MESSAGE = 'That payment expired — try again or take cash.'
export const PAYMENT_FAILED_FALLBACK =
  'The payment did not go through. Try again or switch to cash.'
export const PAYMENT_DROPPED_MESSAGE = 'A payment from before the restart did not complete.'

/** A Ghana number typed at the counter becomes E.164 for the provider. */
export function normalizeMomoPhone(input: string): string | null {
  return normalizeGhanaPhone(input)
}

export interface ElectronicTender {
  paymentId: string | null
  method: PaymentMethod
  amountMinor: number
  status: PaymentStatus
  displayText: string | null
  /** The provider asked for a one-time code before it will settle. */
  requiresOtp: boolean
  expiresAt: string | null
  providerReference: string | null
  /** Present on the live view; not persisted, refetched on resume for a card. */
  authorizationUrl?: string | null
  accountNumber?: string | null
  accountName?: string | null
  accountBank?: string | null
  failedCode?: string | null
  failedMessage?: string | null
  momoProvider?: string | null
  phone?: string | null
  /** Set once `abandon` has been requested; the second attempt is a no-op. */
  abandoned: boolean
}

/** The locally persisted shape a restart reads back (P13-D31). */
export interface ResumableTender {
  paymentId: string | null
  method: PaymentMethod
  amountMinor: number
  status: string
  displayText: string | null
  expiresAt: string | null
  providerReference: string | null
}

export type ElectronicEvent =
  | { type: 'update'; payment: PaymentView; now: number }
  | { type: 'abandoned'; payment: PaymentView }
  | { type: 'resume'; row: ResumableTender; now: number }

export interface ElectronicOutcome {
  /** `null` means the row is dropped, not shown. */
  tender: ElectronicTender | null
  /** Add the amount to the sale's tender lines; false when already added. */
  addTender: boolean
  /** Request `POST /abandon`; true at most once per payment. */
  abandon: boolean
  shouldPoll: boolean
  message: string | null
}

const IDLE: ElectronicOutcome = {
  tender: null,
  addTender: false,
  abandon: false,
  shouldPoll: false,
  message: null,
}

function expiryMs(expiresAt: string | null): number {
  if (!expiresAt) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

export function remainingMs(expiresAt: string | null, now: number): number {
  return Math.max(0, expiryMs(expiresAt) - now)
}

function base(payment: PaymentView): ElectronicTender {
  return {
    paymentId: payment.id,
    method: payment.method,
    amountMinor: payment.amountMinor,
    status: payment.status,
    displayText: payment.displayText,
    requiresOtp: payment.requiresOtp,
    expiresAt: payment.expiresAt,
    providerReference: payment.providerReference,
    authorizationUrl: payment.authorizationUrl,
    accountNumber: payment.accountNumber,
    accountName: payment.accountName,
    accountBank: payment.accountBank,
    failedCode: payment.failedCode,
    failedMessage: payment.failedMessage,
    abandoned: false,
  }
}

function fromStatus(payment: PaymentView, current: ElectronicTender | null): ElectronicOutcome {
  const next: ElectronicTender = { ...base(payment), abandoned: current?.abandoned ?? false }

  switch (payment.status) {
    case 'PAID':
      return {
        tender: { ...next, abandoned: false },
        // Exactly once: the same payment may be polled again by a slow request.
        addTender: current?.status !== 'PAID',
        abandon: false,
        shouldPoll: false,
        message: null,
      }
    case 'FAILED':
      return {
        tender: next,
        addTender: false,
        abandon: false,
        shouldPoll: false,
        message: payment.failedMessage ?? payment.displayText ?? PAYMENT_FAILED_FALLBACK,
      }
    case 'EXPIRED':
      return {
        tender: next,
        addTender: false,
        abandon: false,
        shouldPoll: false,
        message: PAYMENT_EXPIRED_MESSAGE,
      }
    case 'ABANDONED':
      return {
        tender: next,
        addTender: false,
        abandon: false,
        shouldPoll: false,
        message: PAYMENT_FAILED_FALLBACK,
      }
    default:
      return {
        tender: next,
        addTender: false,
        abandon: false,
        shouldPoll: true,
        message: payment.displayText,
      }
  }
}

export function transition(
  current: ElectronicTender | null,
  event: ElectronicEvent,
): ElectronicOutcome {
  if (event.type === 'resume') {
    const row = event.row
    const resumed: ElectronicTender = {
      paymentId: row.paymentId,
      method: row.method,
      amountMinor: row.amountMinor,
      status: row.status as PaymentStatus,
      displayText: row.displayText,
      // Not persisted in the draft row: the first poll after a restart asks
      // the server and turns the OTP field on.
      requiresOtp: false,
      expiresAt: row.expiresAt,
      providerReference: row.providerReference,
      abandoned: false,
    }

    if (row.status === 'PAID') {
      return { tender: resumed, addTender: true, abandon: false, shouldPoll: false, message: null }
    }
    if (row.status === 'PENDING') {
      if (event.now >= expiryMs(row.expiresAt)) {
        return {
          tender: { ...resumed, status: 'EXPIRED', abandoned: true },
          addTender: false,
          abandon: true,
          shouldPoll: false,
          message: PAYMENT_EXPIRED_MESSAGE,
        }
      }
      return {
        tender: resumed,
        addTender: false,
        abandon: false,
        shouldPoll: true,
        message: row.displayText,
      }
    }
    if (row.status === 'FAILED') {
      return { ...IDLE, message: PAYMENT_DROPPED_MESSAGE }
    }
    if (row.status === 'EXPIRED' || row.status === 'ABANDONED') {
      return { ...IDLE, message: PAYMENT_EXPIRED_MESSAGE }
    }
    return IDLE
  }

  const payment = event.payment

  if (event.type === 'abandoned') {
    return fromStatus(payment, current)
  }

  if (payment.status === 'PENDING') {
    const expired = event.now >= expiryMs(payment.expiresAt)
    if (expired) {
      const next: ElectronicTender = {
        ...base(payment),
        status: 'EXPIRED',
        abandoned: true,
      }
      return {
        tender: next,
        addTender: false,
        abandon: !(current?.abandoned ?? false),
        shouldPoll: false,
        message: PAYMENT_EXPIRED_MESSAGE,
      }
    }
  }

  return fromStatus(payment, current)
}
