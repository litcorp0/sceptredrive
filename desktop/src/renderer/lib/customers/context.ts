import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import type { CartCustomer } from '../cart/types'
import { type CreditSnapshot, EMPTY_CREDIT } from '../credit/headroom'
import {
  availablePoints,
  expiringSoonPoints,
  type LotLike,
  pendingPoints,
} from '../loyalty/balance'

/**
 * Everything the terminal knows about the cart's customer, from local data.
 *
 * - **Credit** is branch-local (`credit_profile` for this branch) plus this
 *   terminal's unacked charges.
 * - **Loyalty** is global (`loyalty_account`) plus unacked deltas, with live
 *   lots for the expiry hint.
 *
 * An offline draft has no server records yet, so both come back empty — which
 * is also the truthful answer: the profile is bootstrapped by the first
 * server-side charge.
 */

export interface CustomerLoyalty {
  hasAccount: boolean
  balancePoints: number
  pendingPoints: number
  availablePoints: number
  expiringSoonPoints: number
  lots: LotLike[]
}

export interface CustomerContext {
  credit: CreditSnapshot
  /**
   * True while the first local read of the credit profile is still running.
   *
   * Without this, `hasProfile: false` means two different things — "this customer has no
   * account here" and "we have not looked yet" — and a screen that cannot tell them apart
   * states the first one before the second has finished. Plan 09's audit caught the tender
   * screen offering a manager override to a customer who did have a limit.
   */
  creditLoading: boolean
  loyalty: CustomerLoyalty
}

const EMPTY_LOYALTY: CustomerLoyalty = {
  hasAccount: false,
  balancePoints: 0,
  pendingPoints: 0,
  availablePoints: 0,
  expiringSoonPoints: 0,
  lots: [],
}

interface CreditRow {
  limit_minor: number
  balance_minor: number
  hold: number
}

interface TotalRow {
  total: number
}

interface AccountRow {
  id: string
  balance_points: number
}

interface LotRow extends LotLike {
  account_id: string
}

export function useCustomerContext(
  customer: CartCustomer | null,
  branchId: string,
): CustomerContext {
  // Drafts have no synced rows; a stable empty id keeps the hooks unconditional.
  const customerId = customer?.customerId ?? ''

  const creditRow = useQuery<CreditRow>(
    'SELECT limit_minor, balance_minor, hold FROM credit_profile WHERE customer_id = ? AND branch_id = ?',
    [customerId, branchId],
  )
  const creditPending = useQuery<TotalRow>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM local_credit_delta
      WHERE customer_id = ? AND acked_at IS NULL`,
    [customerId],
  )

  const account = useQuery<AccountRow>(
    'SELECT id, balance_points FROM loyalty_account WHERE customer_id = ?',
    [customerId],
  )
  const loyaltyPending = useQuery<TotalRow>(
    `SELECT COALESCE(SUM(points_delta), 0) AS total
       FROM local_loyalty_delta
      WHERE customer_id = ? AND acked_at IS NULL`,
    [customerId],
  )
  const accountId = account.data?.[0]?.id ?? ''
  const lots = useQuery<LotRow>(
    `SELECT account_id, remaining_points, expires_at
       FROM loyalty_lot
      WHERE account_id = ? AND remaining_points > 0
      ORDER BY expires_at`,
    [accountId],
  )

  return useMemo<CustomerContext>(() => {
    if (!customer) return { credit: EMPTY_CREDIT, creditLoading: false, loyalty: EMPTY_LOYALTY }

    const credit = creditRow.data?.[0]
    const accountRow = account.data?.[0]
    const pendingDeltas = [{ points_delta: loyaltyPending.data?.[0]?.total ?? 0 }]
    const balance = accountRow?.balance_points ?? 0
    const lotRows = (lots.data ?? []).map((lot) => ({
      remaining_points: lot.remaining_points,
      expires_at: lot.expires_at,
    }))

    return {
      creditLoading: creditRow.isLoading,
      credit: credit
        ? {
            hasProfile: true,
            limitMinor: credit.limit_minor,
            balanceMinor: credit.balance_minor,
            pendingMinor: creditPending.data?.[0]?.total ?? 0,
            hold: credit.hold === 1,
          }
        : {
            ...EMPTY_CREDIT,
            pendingMinor: creditPending.data?.[0]?.total ?? 0,
          },
      loyalty: {
        hasAccount: Boolean(accountRow),
        balancePoints: balance,
        pendingPoints: pendingPoints(pendingDeltas),
        availablePoints: availablePoints(balance, pendingDeltas),
        expiringSoonPoints: expiringSoonPoints(lotRows),
        lots: lotRows,
      },
    }
  }, [
    account.data,
    creditPending.data,
    creditRow.data,
    creditRow.isLoading,
    customer,
    lots.data,
    loyaltyPending.data,
  ])
}
