import { formatTime } from '@sceptre/shared'
import { Button } from '@/components/ui/button'
import { formatGhs } from '@/lib/format'
import type { HeldCartSummary } from '@/lib/hold/hold-service'

/**
 * The holds tray (P13-D29).
 *
 * A queue of parked baskets is visible above the products, oldest first, because
 * a hold nobody can see is a customer nobody serves. Each chip carries the four
 * facts a cashier needs to pick the right one — name, size, value, and who
 * parked it — and the actions are real buttons, so the tray works from the
 * keyboard and from a screen reader.
 *
 * `F3` recalls the next hold without leaving the scanner; the label is on the
 * hint line so the accelerator is discoverable.
 */
export function HoldsTray({
  holds,
  busy,
  onRecall,
  onVoid,
}: {
  holds: readonly HeldCartSummary[]
  busy: boolean
  onRecall: (hold: HeldCartSummary) => void
  onVoid: (hold: HeldCartSummary) => void
}) {
  if (holds.length === 0) return null

  return (
    <section
      aria-label="Held carts"
      className="border-b border-border bg-muted/30 px-3 py-2"
      data-testid="holds-tray"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Held · {holds.length}
        </p>
        {/* A `<ul>` is already a list in the accessibility tree; an explicit
            `role="list"` on it is redundant and Biome rejects it. */}
        <ul className="flex flex-1 flex-wrap gap-2">
          {holds.map((hold) => {
            const summary = [
              hold.label,
              `${hold.itemCount} item${hold.itemCount === 1 ? '' : 's'}`,
              formatGhs(hold.totalMinor),
              `held at ${formatTime(hold.heldAt)} by ${hold.heldByName ?? hold.heldByStaffId}`,
            ].join(', ')

            return (
              <li
                key={hold.id}
                className="flex items-center gap-2 rounded-full border border-border bg-card py-0.5 pr-1 pl-3"
              >
                <span className="flex min-w-0 items-baseline gap-2 text-xs">
                  <span className="truncate font-medium">{hold.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {hold.itemCount} · {formatGhs(hold.totalMinor)}
                  </span>
                  <span className="hidden text-muted-foreground tabular-nums sm:inline">
                    {formatTime(hold.heldAt)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold"
                    title={hold.heldByName ?? hold.heldByStaffId}
                  >
                    {hold.heldByInitials}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onRecall(hold)}
                  aria-label={`Recall ${summary}`}
                  className="h-8 rounded-full px-3 text-[11px]"
                >
                  Recall
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onVoid(hold)}
                  aria-label={`Void ${summary}`}
                  className="h-8 rounded-full px-2 text-[11px] text-muted-foreground"
                >
                  Void
                </Button>
              </li>
            )
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          <kbd className="font-mono">F3</kbd> recall next
        </p>
      </div>
    </section>
  )
}
