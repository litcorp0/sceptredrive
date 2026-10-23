import type { CartCustomer, CartOverrideProof } from '../../lib/cart/types'
import {
  CREDIT_DECISION_MESSAGES,
  type CreditSnapshot,
  creditDecision,
  creditHeadroom,
  creditUsed,
  overLimitMinor,
} from '../../lib/credit/headroom'
import { formatGhs } from '../../lib/format'

/**
 * Credit rail (Plan 06 Task 5).
 *
 * Credit is only ever a *choice at tender time*; this panel tells the cashier
 * whether that choice will be clean or need a manager, and holds the approval
 * once granted. Nothing here blocks a sale: an over-limit sale can still be
 * completed (the debt is recorded and a conflict raised server-side).
 */
export function CreditPanel({
  customer,
  credit,
  totalMinor,
  override,
  onRequestApproval,
  onClearApproval,
}: {
  customer: CartCustomer | null
  credit: CreditSnapshot
  totalMinor: number
  override: CartOverrideProof | null
  onRequestApproval: () => void
  onClearApproval: () => void
}) {
  const decision = creditDecision({
    hasCustomer: Boolean(customer),
    snapshot: credit,
    amountMinor: totalMinor,
  })

  return (
    <section aria-label="Credit" className="rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Credit
      </h2>

      {!customer ? (
        <p className="text-xs text-muted-foreground">Choose a customer to sell on credit.</p>
      ) : (
        <div className="grid gap-2 text-xs" data-testid="credit-panel">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Available</span>
            <span className="font-mono font-semibold" data-testid="credit-available">
              {formatGhs(creditHeadroom(credit))}
            </span>
          </div>
          {credit.hasProfile ? (
            <p className="text-[11px] text-muted-foreground">
              Limit {formatGhs(credit.limitMinor)} · used {formatGhs(creditUsed(credit))}
              {credit.pendingMinor > 0 ? ' (incl. unsynced)' : ''}
            </p>
          ) : null}

          <p
            className={
              decision === 'OK'
                ? 'rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800'
                : 'rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900'
            }
            data-testid="credit-decision"
            data-decision={decision}
          >
            {CREDIT_DECISION_MESSAGES[decision]}
          </p>

          {decision !== 'OK' && decision !== 'NO_CUSTOMER' ? (
            override ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-900">
                <p className="font-medium" data-testid="credit-approved">
                  Approved by {override.approverStaffId} · {override.reasonCode}
                </p>
                <p className="text-[10px]">
                  {override.note ? `${override.note} · ` : ''}
                  The debt is still recorded.
                </p>
                <button
                  type="button"
                  onClick={onClearApproval}
                  className="mt-1 rounded px-1 py-0.5 text-[10px] font-medium text-emerald-900 underline"
                >
                  Remove approval
                </button>
              </div>
            ) : (
              <div className="grid gap-1">
                <button
                  type="button"
                  onClick={onRequestApproval}
                  className="h-9 w-full rounded-md border border-border text-xs font-medium hover:bg-muted"
                  data-testid="request-credit-approval"
                >
                  Ask a manager
                </button>
                <p className="text-[10px] text-muted-foreground">
                  Over by {formatGhs(overLimitMinor(credit, totalMinor))}. The sale can still
                  complete without approval — the server records the conflict.
                </p>
              </div>
            )
          ) : null}
        </div>
      )}
    </section>
  )
}
