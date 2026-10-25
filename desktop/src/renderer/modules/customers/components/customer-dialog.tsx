import { formatGhanaPhone } from '@sceptre/shared'
import { useEffect, useRef, useState } from 'react'
import { useDialogFocusReturn } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import type { CartCustomer } from '@/lib/cart/types'
import { type CustomerHit, searchCustomers } from '@/lib/customers/search'
import { useDebouncedValue } from '@/lib/hooks'
import { usePosDatabase } from '@/lib/powersync/provider'

/**
 * Find a customer (F4). Searches the synced list and this terminal's offline
 * drafts together, so a customer created five minutes ago is not invisible
 * until the network comes back.
 */
export function CustomerDialog({
  current,
  onClose,
  onSelect,
  onCreate,
}: {
  current: CartCustomer | null
  onClose: () => void
  onSelect: (hit: CustomerHit) => void
  onCreate: () => void
}) {
  const focusReturn = useDialogFocusReturn()
  const db = usePosDatabase()
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 150)
  const [hits, setHits] = useState<CustomerHit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    searchCustomers(db, debounced)
      .then((rows) => {
        if (cancelled) return
        setHits(rows)
        setActive(0)
        setError(null)
      })
      .catch((searchError: unknown) => {
        if (cancelled) return
        setError(searchError instanceof Error ? searchError.message : 'Could not search customers')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [db, debounced])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(hit: CustomerHit) {
    onSelect(hit)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="customer-dialog"
        className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Find customer</DialogTitle>
          <DialogDescription>
            Search by name or phone. Customers created here work offline.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <input
            id="customer-search"
            data-autofocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const hit = hits[active]
                if (hit) choose(hit)
              }
            }}
            data-testid="customer-search"
            placeholder="Name or phone"
            autoComplete="off"
            className="mb-3 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
          />

          {error ? (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Searching…
            </p>
          ) : hits.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <p>No customer matches “{term.trim()}”.</p>
              <p className="mt-1">Create one to sell on credit or earn loyalty points.</p>
            </div>
          ) : (
            <ul ref={listRef} className="max-h-80 overflow-y-auto">
              {hits.map((hit, index) => {
                const isCurrent = current
                  ? (hit.customerId && hit.customerId === current.customerId) ||
                    (hit.draftId && hit.draftId === current.draftId)
                  : false
                return (
                  <li key={hit.customerId ?? hit.draftId}>
                    <button
                      type="button"
                      data-index={index}
                      data-testid="customer-hit"
                      onClick={() => choose(hit)}
                      onPointerEnter={() => setActive(index)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${
                        index === active ? 'bg-muted' : 'hover:bg-muted/60'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{hit.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {hit.phone ? formatGhanaPhone(hit.phone) : '—'}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {hit.isDraft ? (
                          <Badge className="border-transparent bg-amber-50 text-[10px] text-foreground">
                            New — links on sync
                          </Badge>
                        ) : null}
                        {isCurrent ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Current
                          </Badge>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onSelect({
                  customerId: null,
                  draftId: null,
                  name: 'Walk-in',
                  phone: '',
                  isDraft: false,
                })
                onClose()
              }}
              className="h-11"
              data-testid="choose-walk-in"
            >
              Walk-in
            </Button>
            <Button type="button" onClick={onCreate} className="h-11" data-testid="new-customer">
              New customer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
