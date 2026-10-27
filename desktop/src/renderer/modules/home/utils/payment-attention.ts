import { ELECTRONIC_TENDER_METHODS, formatTenderLabel, type TenderMethod } from '@sceptre/shared'
import { formatGhs } from '@/lib/format'

/**
 * Money that arrived after the cashier gave up (P13-D9).
 *
 * The server raises a `PAYMENT_LATE_SETTLEMENT` conflict at HIGH, and the till
 * already keeps a copy of server conflicts (`sync_conflict_local`). That is the
 * banner's source: no new route is invented, the screen works offline, and the
 * amount, method and provider reference are exactly the ones the server wrote.
 *
 * Nothing here refunds, dismisses or claims by itself.
 */

export interface OrphanConflictRow {
  id: string
  details: string
  created_at: string
}

export interface OrphanPayment {
  /** The server conflict id, stable for React keys and for hiding after a claim. */
  conflictId: string
  paymentId: string
  providerReference: string
  method: TenderMethod
  amountMinor: number
  paidAt: string | null
  createdAt: string
}

const KNOWN_METHODS = new Set<string>(ELECTRONIC_TENDER_METHODS)

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Parses the allowlisted `details` projection the server writes. Anything that
 * does not have a payment id, a reference and a positive integer amount is
 * dropped: a half-known orphan is a number a cashier cannot act on.
 */
export function parseOrphanConflicts(
  rows: readonly OrphanConflictRow[],
  attachedPaymentIds: ReadonlySet<string> = new Set(),
): OrphanPayment[] {
  const orphans: OrphanPayment[] = []

  for (const row of rows) {
    let details: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(row.details)
      if (!parsed || typeof parsed !== 'object') continue
      details = parsed as Record<string, unknown>
    } catch {
      continue
    }

    const paymentId = asString(details.paymentId)
    const providerReference = asString(details.providerReference)
    const method = asString(details.method)
    const amountMinor = details.amountMinor

    if (!paymentId || !providerReference || !method || !KNOWN_METHODS.has(method)) continue
    if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) continue
    if (attachedPaymentIds.has(paymentId)) continue

    orphans.push({
      conflictId: row.id,
      paymentId,
      providerReference,
      method: method as TenderMethod,
      amountMinor: amountMinor as number,
      paidAt: asString(details.providerPaidAt),
      createdAt: row.created_at,
    })
  }

  return orphans
}

/**
 * "Payment received without a sale — GH₵50.00 MoMo, 14:32".
 *
 * The time is the payment's own paid-at when the provider gave one, otherwise
 * the moment the conflict was raised. Africa/Accra is UTC with no DST, so the
 * `UTC` formatter is the Accra clock (the same fact `@sceptre/shared` dates
 * documents).
 */
export function orphanSentence(orphan: OrphanPayment): string {
  const when = orphan.paidAt ?? orphan.createdAt
  const time = accraClock(when)
  const clock = time ? `, ${time}` : ''
  return `Payment received without a sale — ${formatGhs(orphan.amountMinor)} ${formatTenderLabel(orphan.method)}${clock}`
}

export function accraClock(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * "Add to this sale" is only honest when the cart still owes exactly the money
 * that arrived. A partial fit would either invent a tender or silently leave a
 * balance; both are the cashier's call, not the banner's.
 */
export function canAttachToCart(amountMinor: number, draftTotalMinor: number | null): boolean {
  return (
    draftTotalMinor !== null &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor > 0 &&
    amountMinor === draftTotalMinor
  )
}
