import { formatGhanaPhone } from '@sceptre/shared'
import type { CartCustomer } from '../../lib/cart/types'
import { creditHeadroom, creditUsed } from '../../lib/credit/headroom'
import type { CustomerContext } from '../../lib/customers/context'
import { formatGhs } from '../../lib/format'

/**
 * The customer rail (Plan 06 Task 3).
 *
 * Always answers three questions at a glance: who is this sale for, can they
 * take credit here, and what loyalty do they hold. Nothing here blocks selling;
 * a customer with no credit profile can still pay cash.
 */
export function CustomerPanel({
  customer,
  context,
  onFind,
  onClear,
}: {
  customer: CartCustomer | null
  context: CustomerContext
  onFind: () => void
  onClear: () => void
}) {
  const { credit, loyalty } = context

  return (
    <section aria-label="Customer" className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Customer
        </h2>
        {customer ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            data-testid="clear-customer"
          >
            Walk-in
          </button>
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
            <p
              className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
              data-testid="customer-draft-note"
            >
              New customer — will link on sync
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="walk-in">
          Walk-in customer
        </p>
      )}

      <button
        type="button"
        onClick={onFind}
        className="mt-2 h-9 w-full rounded-md border border-border text-xs font-medium hover:bg-muted"
        data-testid="find-customer"
      >
        {customer ? 'Change customer' : 'Find or create'} <span className="opacity-60">F4</span>
      </button>

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
              <span className="font-mono" data-testid="credit-headroom">
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
            <span className="font-mono" data-testid="loyalty-balance">
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
  )
}
