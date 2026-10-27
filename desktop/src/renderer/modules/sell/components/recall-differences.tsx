import type { HoldDifference } from '@sceptre/shared'
import { Button } from '@/components/ui/button'
import { formatGhs } from '@/lib/format'
import type { RecallLoyaltyNotice } from '@/lib/hold/hold-service'

/**
 * What changed while the cart was parked (P13-D35).
 *
 * A hold is a promise made at an earlier price. Recall re-prices against today's
 * catalogue and shows **every** difference by product — a price that moved, a tax
 * reclassification, a product that was archived, a product that no longer exists
 * — and the sale cannot complete until the cashier acknowledges the list. A line
 * whose product is gone or archived additionally has to be removed; the block is
 * named here rather than left for the completion path to discover.
 *
 * A loyalty redemption that had to shrink is listed in the same panel, because
 * "1 200 points" becoming "800" is a change to what the customer was promised.
 */

function describe(difference: HoldDifference): { text: string; detail: string | null } {
  switch (difference.kind) {
    case 'PRICE':
      return {
        text: `${difference.name}: ${formatGhs(difference.fromMinor)} → ${formatGhs(difference.toMinor)}`,
        detail: null,
      }
    case 'TAX':
      return {
        text: `${difference.name}: tax treatment changed`,
        detail: `${formatGhs(difference.fromMinor)} → ${formatGhs(difference.toMinor)}`,
      }
    case 'ARCHIVED':
      return {
        text: `${difference.name}: archived — remove or replace this line`,
        detail: null,
      }
    default:
      return {
        text: `${difference.name}: no longer in the catalogue — remove this line`,
        detail: null,
      }
  }
}

export function RecallDifferences({
  differences,
  blockingProductIds,
  loyalty,
  acknowledged,
  onAcknowledge,
  onRemoveBlocking,
  onDismiss,
}: {
  differences: readonly HoldDifference[]
  blockingProductIds: readonly string[]
  loyalty: RecallLoyaltyNotice | null
  acknowledged: boolean
  onAcknowledge: () => void
  onRemoveBlocking: () => void
  onDismiss: () => void
}) {
  return (
    <section
      aria-label="Changes since this cart was held"
      data-testid="recall-panel"
      className="border-b border-warn/40 bg-warn/10 px-4 py-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold">This cart was held at older prices</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Nothing is charged yet. Acknowledge the changes, and remove any line named below, before
            taking payment.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onDismiss}
          className="h-8 shrink-0 px-2 text-[11px]"
        >
          Hide
        </Button>
      </div>

      <ul className="mt-2 grid gap-1">
        {differences.map((difference) => {
          const described = describe(difference)
          return (
            <li key={`${difference.kind}-${difference.productId}`} className="text-xs">
              <span>{described.text}</span>
              {described.detail ? (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {described.detail}
                </span>
              ) : null}
            </li>
          )
        })}
        {loyalty?.notice ? (
          <li className="text-xs" data-testid="recall-loyalty">
            Loyalty: {loyalty.notice}
          </li>
        ) : null}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onAcknowledge}
          disabled={acknowledged}
          className="h-9 px-4 text-xs"
          data-testid="recall-acknowledge"
        >
          {acknowledged ? 'Acknowledged' : 'Acknowledge changes'}
        </Button>
        {blockingProductIds.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={onRemoveBlocking}
            className="h-9 px-4 text-xs"
            data-testid="recall-remove-blocking"
          >
            Remove {blockingProductIds.length === 1 ? 'that line' : 'those lines'}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
