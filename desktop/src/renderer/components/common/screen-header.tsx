import type { ReactNode } from 'react'

/**
 * The heading block every non-selling counter screen repeats (Plan 03).
 *
 * Sales, sync, settings, receipt, and shift all render a title, one line of
 * context, and the screen's actions in that order. Extracting it keeps the
 * order — and the type scale — in one place instead of five, and it is the slot
 * Plans 06–08 retune without touching a page.
 *
 * The strings stay at the call sites: this component owns layout, not copy.
 */
export function ScreenHeader({
  title,
  description,
  badge,
  actions,
  children,
  className = 'mb-4',
}: {
  title: string
  /** One short line under the title. A node, so a screen can use monospace data. */
  description?: ReactNode
  /** A status chip that belongs beside the title rather than among the actions. */
  badge?: ReactNode
  actions?: ReactNode
  /** Extra rows under the description (a receipt number, an explanatory note). */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          {badge}
        </div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
