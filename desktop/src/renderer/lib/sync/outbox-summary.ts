import { useQuery } from '@powersync/react'

/**
 * Outbox summary for the POS header (Plan 06 Task 1 badge; Plan 08 adds the
 * uploader and the full sync screen).
 *
 * Reading the queue is read-only and local, so it is safe to show before the
 * uploader exists: the count tells the cashier whether anything is waiting to
 * reach the server.
 */

interface OutboxCountRow {
  pending: number
  failed: number
}

export interface OutboxSummary {
  pending: number
  failed: number
}

export function useOutboxSummary(): OutboxSummary {
  const { data } = useQuery<OutboxCountRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending', 'in_flight') THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status IN ('conflict', 'dead_letter') THEN 1 ELSE 0 END), 0) AS failed
       FROM outbox`,
  )

  return { pending: data?.[0]?.pending ?? 0, failed: data?.[0]?.failed ?? 0 }
}

/**
 * Sales on this till that the server does not have yet.
 *
 * `pending` rows upload by themselves; `blocked` rows were refused (or cannot be
 * sent) and need a manager's Retry on the sync screen. They are counted apart
 * because one is "waiting" and the other is "stuck", and a cashier can only act
 * on the first.
 */
export interface UnsyncedSales {
  pending: number
  blocked: number
}

interface UnsyncedSalesRow {
  pending: number
  blocked: number
}

export const NO_UNSYNCED_SALES: UnsyncedSales = { pending: 0, blocked: 0 }

export function useUnsyncedSales(): UnsyncedSales {
  const { data } = useQuery<UnsyncedSalesRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending', 'in_flight') THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status IN ('conflict', 'dead_letter') THEN 1 ELSE 0 END), 0) AS blocked
       FROM outbox
       WHERE type = 'SALE'`,
  )

  return {
    pending: data?.[0]?.pending ?? 0,
    blocked: data?.[0]?.blocked ?? 0,
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * Why an unsynced sale matters at the close, in the cashier's words.
 *
 * Closing is never blocked (SYNC-05, POS-06): the drawer is in front of the
 * cashier and the money has to be counted. But a sale that reaches the server
 * after its shift closed arrives against a drawer that has already been counted,
 * so the manager has to reconcile it. Saying so before the count is cheaper than
 * explaining it after the variance review.
 */
export function unsyncedSalesWarning(sales: UnsyncedSales): string | null {
  if (sales.pending === 0 && sales.blocked === 0) return null

  const parts: string[] = []
  if (sales.pending > 0) {
    parts.push(
      `${plural(sales.pending, 'sale')} saved here ${sales.pending === 1 ? 'has' : 'have'} not reached the server yet and will upload when the connection is back`,
    )
  }
  if (sales.blocked > 0) {
    parts.push(
      sales.blocked === 1
        ? '1 sale was refused by the server and needs a manager to retry it from Sync'
        : `${plural(sales.blocked, 'sale')} were refused by the server and need a manager to retry them from Sync`,
    )
  }

  return `${parts.join('; ')}. A sale that arrives after this close is applied, but a manager has to review it against this drawer.`
}

/** The acknowledgement label. A close with nothing waiting asks for none. */
export function unsyncedSalesAcknowledgement(sales: UnsyncedSales): string | null {
  if (sales.pending === 0 && sales.blocked === 0) return null
  return 'I understand this close happens before every sale has reached the server'
}

/** True when the close button must wait for that acknowledgement. */
export function needsUnsyncedAcknowledgement(sales: UnsyncedSales): boolean {
  return unsyncedSalesAcknowledgement(sales) !== null
}
