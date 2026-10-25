import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

/**
 * A one-line status strip (P10-D9).
 *
 * The semantic tokens carry the colour through a 10 % tint and a dot; the copy
 * stays `text-foreground` because a coloured 10 px label on its own tint lands
 * under 4.5:1 (Phase 7's measured rule). Callers own the ARIA role: a notice is
 * `role="status"` with `aria-live="polite"`, a failure is `role="alert"`.
 */
export type StatusTone = 'notice' | 'danger' | 'ok' | 'info'

const TONE_BOX: Record<StatusTone, string> = {
  notice: 'border-warn/30 bg-warn/10 text-foreground',
  danger: 'border-danger/30 bg-danger/10 text-foreground',
  ok: 'border-ok/30 bg-ok/10 text-foreground',
  info: 'border-border bg-muted text-muted-foreground',
}

const TONE_DOT: Record<StatusTone, string> = {
  notice: 'bg-warn',
  danger: 'bg-danger',
  ok: 'bg-ok',
  info: 'bg-muted-foreground',
}

export function StatusNote({
  tone = 'info',
  action,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  tone?: StatusTone
  /** Right-aligned control, e.g. a Dismiss button. */
  action?: ReactNode
}) {
  return (
    <div
      data-slot="status-note"
      className={cn(
        'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs',
        TONE_BOX[tone],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT[tone])}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
