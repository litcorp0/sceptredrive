import { useQuery } from '@powersync/react'
import { formatDateTime } from '@sceptre/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'

/**
 * Server-raised conflicts, cached locally (Plan 08 Task 3).
 *
 * Conflicts never block a sale: the merchant charged and the sale is recorded.
 * This list is how a manager finds out what needs review, including when the
 * terminal is offline again. Details are operational (amounts, ids, on-hand,
 * limit, timestamps) and never contain customer names, phones, or tokens.
 */

export interface ConflictRow {
  id: string
  sale_id: string | null
  shift_id: string | null
  type: string
  severity: string
  status: string
  details: string
  sale_receipt_number: string | null
  shift_number: string | null
  created_at: string
  resolved_at: string | null
}

/*
 * `HIGH` is the only severity styled as a problem: it is the one a manager must act on, and
 * the one that says a sale, a limit, or a stock figure disagreed with the server. MEDIUM and
 * LOW are informational — recording them in red would make every sync look like a failure and
 * teach a manager to ignore the colour (D10: offline is a normal state).
 *
 * The word carries the severity and the dot repeats it; the label stays `text-foreground`.
 */
const SEVERITY_TINT: Record<string, string> = {
  HIGH: 'bg-danger/10',
  MEDIUM: 'bg-muted',
  LOW: 'bg-muted',
}

const SEVERITY_DOT: Record<string, string> = {
  HIGH: 'bg-danger',
  MEDIUM: 'bg-muted-foreground',
  LOW: 'bg-muted-foreground',
}

const SEVERITY_WORD: Record<string, string> = {
  HIGH: 'High — needs review',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

function pretty(details: string): string {
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}

export function ConflictList() {
  const { data, isLoading } = useQuery<ConflictRow>(
    `SELECT id, sale_id, shift_id, type, severity, status, details,
            sale_receipt_number, shift_number, created_at, resolved_at
       FROM sync_conflict_local
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
  )

  if (isLoading && !data?.length) {
    return (
      <div className="grid gap-2">
        <span className="sr-only">Loading conflicts…</span>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (!data?.length) {
    return (
      <Empty className="border border-border bg-card">
        <EmptyHeader>
          <EmptyTitle>No conflicts.</EmptyTitle>
          <EmptyDescription>
            Oversells, credit overrides, price drift, and loyalty issues would appear here after a
            sync.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="grid gap-2" data-testid="conflict-list">
      {data.map((conflict) => (
        <li key={conflict.id} className="rounded-lg border border-border bg-card">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Badge
                className={`gap-1.5 border-transparent text-[11px] font-semibold text-foreground ${
                  SEVERITY_TINT[conflict.severity] ?? ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${
                    SEVERITY_DOT[conflict.severity] ?? 'bg-muted-foreground'
                  }`}
                />
                {SEVERITY_WORD[conflict.severity] ?? conflict.severity}
              </Badge>
              <span className="font-medium">{conflict.type.replaceAll('_', ' ')}</span>
              {conflict.sale_receipt_number ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {conflict.sale_receipt_number}
                </span>
              ) : conflict.shift_number ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {conflict.shift_number}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatDateTime(conflict.created_at)} · {conflict.status}
              </span>
            </summary>
            <div className="grid gap-2 border-t border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                The sale is recorded. A manager reviews this in the back office; nothing needs to
                block the till.
              </p>
              <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {pretty(conflict.details)}
              </pre>
              <div className="flex gap-2">
                {conflict.sale_id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`pos/receipt/${conflict.sale_id}`)}
                    className="h-11 px-3 text-xs"
                  >
                    Open receipt
                  </Button>
                ) : null}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
