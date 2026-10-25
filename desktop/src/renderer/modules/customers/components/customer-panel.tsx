import { formatGhanaPhone } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { CartCustomer } from '@/lib/cart/types'
import { creditHeadroom, creditUsed } from '@/lib/credit/headroom'
import type { CustomerContext } from '@/lib/customers/context'
import type { CustomerHit } from '@/lib/customers/search'
import { formatGhs } from '@/lib/format'
import { CustomerCreateDialog } from './customer-create-dialog'
import { CustomerDialog } from './customer-dialog'

/**
 * The customer rail (Plan 06 Task 3).
 *
 * Always answers three questions at a glance: who is this sale for, can they
 * take credit here, and what loyalty do they hold. Nothing here blocks selling;
 * a customer with no credit profile can still pay cash.
 *
 * The panel owns its two dialogs (P10-D11): "find" and "create" are one flow —
 * create is only reachable from find — so the surface costs the sell page a
 * single `open` flag instead of two dialogs and their state. The dialogs portal
 * themselves to the body (`DialogContent`), so the rail sitting below the cart
 * under 1024 px does not stop F4 from opening them.
 *
 * Colours are semantic tokens only: a draft is a notice tint, a held account is
 * `--danger`, and an expiring balance is `--warn`. The numbers themselves are
 * unchanged and still come from `lib/customers/context.ts`.
 */
export function CustomerPanel({
  customer,
  context,
  open,
  onFind,
  onClose,
  onSelect,
  onClear,
}: {
  customer: CartCustomer | null
  context: CustomerContext
  /** The customer surface (find, or the create form reached from it) is open. */
  open: boolean
  onFind: () => void
  onClose: () => void
  onSelect: (hit: CustomerHit) => void
  onClear: () => void
}) {
  const { credit, loyalty } = context
  const [creating, setCreating] = useState(false)

  // Closing the surface resets the flow, so reopening starts at the search
  // rather than a blank create form.
  useEffect(() => {
    if (!open) setCreating(false)
  }, [open])

  function close() {
    setCreating(false)
    onClose()
  }

  return (
    <>
      <Card aria-label="Customer" role="region" className="gap-2 py-3" data-testid="customer-panel">
        <CardHeader className="items-center gap-1.5 px-3">
          <CardTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Customer
          </CardTitle>
          {customer ? (
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                onClick={onClear}
                className="h-11 min-w-11 px-2 text-[11px] text-muted-foreground"
                data-testid="clear-customer"
              >
                Walk-in
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>

        <CardContent className="px-3">
          {customer ? (
            <div data-testid="customer-current">
              <p className="truncate text-sm font-semibold" data-testid="customer-name">
                {customer.name}
              </p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {customer.phone ? formatGhanaPhone(customer.phone) : '—'}
              </p>
              {customer.isDraft ? (
                <Badge
                  className="mt-1 border-transparent bg-warn/10 text-[10px] text-foreground"
                  data-testid="customer-draft-note"
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
                  New customer — will link on sync
                </Badge>
              ) : null}
            </div>
          ) : (
            <Empty className="items-start gap-1 border-0 p-0 text-left md:p-0">
              <EmptyHeader className="items-start gap-1 text-left">
                <EmptyTitle className="text-sm font-medium text-foreground" data-testid="walk-in">
                  Walk-in customer
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  No customer yet — cash sales are fine. Add one to sell on credit or earn points.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={onFind}
            className="mt-2 h-11 w-full text-xs"
            data-testid="find-customer"
          >
            {customer ? 'Change customer' : 'Find or create'}
            <span className="font-mono text-[11px] font-normal text-muted-foreground">F4</span>
          </Button>

          {customer && !customer.isDraft ? (
            <div className="mt-3 grid gap-1 border-t border-border pt-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Credit</span>
                {!credit.hasProfile ? (
                  <span className="text-muted-foreground" data-testid="credit-none">
                    No account here
                  </span>
                ) : credit.hold ? (
                  <span className="font-medium text-danger" data-testid="credit-hold">
                    On hold
                  </span>
                ) : (
                  <span className="font-mono tabular-nums" data-testid="credit-headroom">
                    {formatGhs(creditHeadroom(credit))}
                  </span>
                )}
              </div>
              {credit.hasProfile ? (
                <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    Limit {formatGhs(credit.limitMinor)} · used {formatGhs(creditUsed(credit))}
                  </span>
                </div>
              ) : null}

              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Loyalty</span>
                <span className="font-mono tabular-nums" data-testid="loyalty-balance">
                  {loyalty.availablePoints} pts
                </span>
              </div>
              {loyalty.pendingPoints !== 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {loyalty.pendingPoints > 0 ? '+' : ''}
                  {loyalty.pendingPoints} from unsynced sales
                </p>
              ) : null}
              {loyalty.expiringSoonPoints > 0 ? (
                <p className="text-[11px] text-warn" data-testid="loyalty-expiring">
                  {loyalty.expiringSoonPoints} pts expire within 30 days
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {open ? (
        creating ? (
          <CustomerCreateDialog
            onClose={close}
            onCreated={(hit) => {
              onSelect(hit)
              close()
            }}
          />
        ) : (
          <CustomerDialog
            current={customer}
            onClose={close}
            onSelect={onSelect}
            onCreate={() => setCreating(true)}
          />
        )
      ) : null}
    </>
  )
}
