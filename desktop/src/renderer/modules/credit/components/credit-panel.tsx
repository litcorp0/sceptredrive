import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { CartCustomer, CartOverrideProof } from '@/lib/cart/types'
import {
  CREDIT_DECISION_MESSAGES,
  type CreditSnapshot,
  creditDecision,
  creditHeadroom,
  creditUsed,
  overLimitMinor,
} from '@/lib/credit/headroom'
import { formatGhs } from '@/lib/format'

/**
 * Credit rail (Plan 06 Task 5).
 *
 * Credit is only ever a *choice at tender time*; this panel tells the cashier
 * whether that choice will be clean or need a manager, and holds the approval
 * once granted. Nothing here blocks a sale: an over-limit sale can still be
 * completed (the debt is recorded and a conflict raised server-side).
 *
 * A clean decision is `--ok`, an over-limit one is `--warn`, and an approval is
 * `--ok` again; all three keep the copy in `text-foreground` because a 10 %
 * tint cannot carry a coloured 10 px label. The numbers are unchanged.
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
    <Card aria-label="Credit" role="region" className="gap-2 py-3" data-testid="credit-card">
      <CardHeader className="items-center gap-1.5 px-3">
        <CardTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Credit
        </CardTitle>
      </CardHeader>

      <CardContent className="px-3">
        {!customer ? (
          <Empty className="items-start gap-1 border-0 p-0 text-left md:p-0">
            <EmptyHeader className="items-start gap-1 text-left">
              <EmptyTitle className="text-sm font-medium text-foreground">
                No customer yet
              </EmptyTitle>
              <EmptyDescription className="text-xs">
                Choose a customer to sell on credit.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-2 text-xs" data-testid="credit-panel">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Available</span>
              <span className="font-mono font-semibold tabular-nums" data-testid="credit-available">
                {formatGhs(creditHeadroom(credit))}
              </span>
            </div>
            {credit.hasProfile ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Limit {formatGhs(credit.limitMinor)} · used {formatGhs(creditUsed(credit))}
                {credit.pendingMinor > 0 ? ' (incl. unsynced)' : ''}
              </p>
            ) : null}

            <StatusNote
              tone={decision === 'OK' ? 'ok' : 'notice'}
              className="px-2 py-1 text-[11px] font-medium"
              data-testid="credit-decision"
              data-decision={decision}
            >
              {CREDIT_DECISION_MESSAGES[decision]}
            </StatusNote>

            {decision !== 'OK' && decision !== 'NO_CUSTOMER' ? (
              override ? (
                <StatusNote tone="ok" className="px-2 py-1.5" data-testid="credit-approved">
                  <p className="font-medium">
                    Approved by {override.approverStaffId} · {override.reasonCode}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {override.note ? `${override.note} · ` : ''}
                    The debt is still recorded.
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    onClick={onClearApproval}
                    className="h-11 min-w-11 justify-start px-0 text-[10px] text-foreground"
                  >
                    Remove approval
                  </Button>
                </StatusNote>
              ) : (
                <div className="grid gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onRequestApproval}
                    className="h-11 w-full text-xs"
                    data-testid="request-credit-approval"
                  >
                    Ask a manager
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Over by {formatGhs(overLimitMinor(credit, totalMinor))}. The sale can still
                    complete without approval — the server records the conflict.
                  </p>
                </div>
              )
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
