import { formatGhanaPhone } from '@gikautos/shared'
import { useEffect, useRef, useState } from 'react'
import type { CartCustomer } from '../../lib/cart/types'
import { type CustomerHit, searchCustomers } from '../../lib/customers/search'
import { useDebouncedValue } from '../../lib/hooks'
import { usePosDatabase } from '../../lib/powersync/provider'
import { Modal } from './modal'

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
    <Modal
      title="Find customer"
      description="Search by name or phone. Customers created here work offline."
      onClose={onClose}
      wide
      testId="customer-dialog"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
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
            className="h-10 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            data-testid="choose-walk-in"
          >
            Walk-in
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            data-testid="new-customer"
          >
            New customer
          </button>
        </div>
      }
    >
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
        <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
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
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${
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
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        New — links on sync
                      </span>
                    ) : null}
                    {isCurrent ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        Current
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
