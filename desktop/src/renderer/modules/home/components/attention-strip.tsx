import { formatCount } from '@sceptre/shared'
import { navigate } from '@/lib/router'
import type { AttentionItem, AttentionTone } from '../types'

/**
 * The four things that need somebody — never a sale blocker (P10-D2).
 *
 * `attentionItems` has already dropped zero counts, so an empty list means a quiet till and the
 * strip does not render at all. A count with a route is a button; out-of-stock has no route
 * because the POS has no stock screen yet, and a link that goes nowhere is worse than a
 * label. The tone is a dot, not a background: a conflict the server rated HIGH is the only red
 * one, and the text stays foreground contrast (Phase 7's chip rule).
 */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null

  return (
    <section
      aria-labelledby="home-attention-heading"
      className="mt-4 rounded-lg border border-border bg-card px-4 py-3"
      data-testid="home-attention"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2
          id="home-attention-heading"
          className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
        >
          Needs attention
        </h2>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {items.map((item) => (
            <li key={item.id}>{renderItem(item)}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function renderItem(item: AttentionItem) {
  const body = (
    <>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${TONE[item.tone]}`} />
      <span className="font-mono tabular-nums">{formatCount(item.count)}</span>
      <span>{item.label}</span>
      <span className="sr-only"> — {item.detail}</span>
    </>
  )

  if (!item.route) {
    return (
      <span
        className="flex h-11 items-center gap-1.5 text-sm"
        title={item.detail}
        data-testid={`attention-${item.id}`}
      >
        {body}
      </span>
    )
  }

  const route = item.route
  return (
    <button
      type="button"
      onClick={() => navigate(route)}
      className="flex h-11 items-center gap-1.5 rounded-md px-1 text-sm hover:bg-accent"
      title={item.detail}
      data-testid={`attention-${item.id}`}
    >
      {body}
    </button>
  )
}

const TONE: Record<AttentionTone, string> = {
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
}
