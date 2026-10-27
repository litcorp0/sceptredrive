import { useState } from 'react'
import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { paymentsClient } from '@/lib/api/payments-client'
import { attachPaidCartTender } from '@/lib/cart/cart-repository'
import { usePosDatabase } from '@/lib/powersync/provider'
import type { DraftForClaim } from '../hooks/use-payment-attention'
import { canAttachToCart, type OrphanPayment, orphanSentence } from '../utils/payment-attention'

/**
 * A payment that arrived after the cashier gave up is on the screen a manager
 * looks at (P13-D9).
 *
 * Two actions, no dismissal and no refund: **Add to this sale** is offered only
 * when the open cart owes exactly the amount that arrived, and **Tell a
 * manager** shows the provider reference for the person who will decide what
 * happens. The banner is `role="status"` — it announces itself without
 * stealing focus from a till that may be mid-sale.
 */
export function PaymentAttention({
  orphans,
  draft,
}: {
  orphans: OrphanPayment[]
  draft: DraftForClaim | null
}) {
  const db = usePosDatabase()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [managerFor, setManagerFor] = useState<OrphanPayment | null>(null)

  const visible = orphans.filter((orphan) => !added.has(orphan.paymentId))
  if (visible.length === 0) return null

  async function addToSale(orphan: OrphanPayment): Promise<void> {
    if (!draft || !canAttachToCart(orphan.amountMinor, draft.totalMinor)) return
    setBusy(orphan.conflictId)
    setError(null)
    try {
      const claimed = await paymentsClient.claim(orphan.paymentId, draft.draftId)
      // The claim clears `orphaned` on the server; the tender row is what puts
      // the money on this sale locally, so both happen or neither is shown.
      await attachPaidCartTender(db, draft.draftId, {
        paymentId: claimed.id,
        providerReference: claimed.providerReference,
        method: claimed.method,
        amountMinor: claimed.amountMinor,
      })
      setAdded((current) => new Set(current).add(orphan.paymentId))
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? `Could not add that payment: ${claimError.message}`
          : 'Could not add that payment',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <output
      aria-live="polite"
      aria-labelledby="payment-attention-heading"
      className="mt-4 block rounded-lg border border-warn/50 bg-warn/5 px-4 py-3"
      data-testid="payment-attention"
    >
      <h2
        id="payment-attention-heading"
        className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
      >
        Payment received without a sale
      </h2>

      <ul className="mt-2 grid gap-3">
        {visible.map((orphan) => {
          const canAdd = canAttachToCart(orphan.amountMinor, draft?.totalMinor ?? null)
          return (
            <li
              key={orphan.conflictId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
              data-testid="orphan-payment"
            >
              <p className="min-w-0 flex-1 text-sm">{orphanSentence(orphan)}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAdd || busy === orphan.conflictId}
                  title={
                    canAdd
                      ? undefined
                      : draft
                        ? 'This cart does not owe exactly that amount'
                        : 'There is no cart open on this terminal'
                  }
                  onClick={() => void addToSale(orphan)}
                  data-testid="orphan-add-to-sale"
                >
                  {busy === orphan.conflictId ? 'Adding…' : 'Add to this sale'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setManagerFor(orphan)}
                  data-testid="orphan-tell-manager"
                >
                  Tell a manager
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {error ? (
        <StatusNote tone="danger" role="alert" className="mt-2">
          {error}
        </StatusNote>
      ) : null}

      <Dialog open={managerFor !== null} onOpenChange={(open) => !open && setManagerFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tell a manager</DialogTitle>
            <DialogDescription>
              This money is with the provider, not on a sale. Write down the reference below so a
              manager can decide what happens. Nothing is refunded automatically.
            </DialogDescription>
          </DialogHeader>

          {managerFor ? (
            <dl className="grid gap-1 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-mono tabular-nums">{orphanSentence(managerFor)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Provider reference</dt>
                <dd className="font-mono" data-testid="orphan-reference">
                  {managerFor.providerReference}
                </dd>
              </div>
            </dl>
          ) : null}

          <DialogFooter>
            <Button type="button" onClick={() => setManagerFor(null)} className="h-11">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </output>
  )
}
