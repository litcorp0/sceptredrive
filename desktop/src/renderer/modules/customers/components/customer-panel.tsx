import { formatGhanaPhone } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
 * themselves to the body (`DialogContent`), so the rail being hidden below `lg`
 * does not stop F4 from opening them.
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
      <section aria-label="Customer" className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Customer
          </h2>
          {customer ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-11 px-2 text-[11px] text-muted-foreground"
              data-testid="clear-customer"
            >
              Walk-in
            </Button>
          ) : null}
        </div>

        {customer ? (
          <div data-testid="customer-current">
            <p className="text-sm font-semibold" data-testid="customer-name">
              {customer.name}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {customer.phone ? formatGhanaPhone(customer.phone) : '—'}
            </p>
            {customer.isDraft ? (
              <Badge
                className="mt-1 border-transparent bg-amber-50 text-[10px] text-foreground"
                data-testid="customer-draft-note"
              >
                New customer — will link on sync
              </Badge>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="walk-in">
            Walk-in customer
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={onFind}
          className="mt-2 h-11 w-full text-xs"
          data-testid="find-customer"
        >
          {customer ? 'Change customer' : 'Find or create'} <span className="opacity-60">F4</span>
        </Button>

        {customer && !customer.isDraft ? (
          <div className="mt-3 grid gap-1 border-t border-border pt-2 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Credit</span>
              {!credit.hasProfile ? (
                <span className="text-muted-foreground" data-testid="credit-none">
                  No account here
                </span>
              ) : credit.hold ? (
                <span className="font-medium text-red-700" data-testid="credit-hold">
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
                <span>
                  Limit {formatGhs(credit.limitMinor)} · used {formatGhs(creditUsed(credit))}
                </span>
              </div>
            ) : null}

            <div className="mt-1 flex items-baseline justify-between">
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
              <p className="text-[11px] text-amber-700" data-testid="loyalty-expiring">
                {loyalty.expiringSoonPoints} pts expire within 30 days
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

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
