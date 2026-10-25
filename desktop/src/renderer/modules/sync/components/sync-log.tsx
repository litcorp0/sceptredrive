import { useQuery } from '@powersync/react'
import { formatDateTime, formatRelative } from '@sceptre/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'

/**
 * The outbox table on `/sync` (Plan 08 Task 3).
 *
 * Read-only except for the manager-only Retry on a dead letter. It shows only
 * operational metadata: type, receipt, timestamps, attempts, state, and a short
 * error. No receipt lines, tokens, or customer PII ever reach this table.
 */

export interface OutboxLogRow {
  id: string
  type: string
  status: string
  occurred_at: string
  attempts: number
  next_attempt_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  receipt_number: string | null
}

/* The tint and the dot carry the state; the label stays `text-foreground`. A dead letter is
   the only state that is a problem — the rest are a queue working as designed. */
const STATE_TINT: Record<string, string> = {
  pending: 'bg-muted',
  in_flight: 'bg-info/10',
  acked: 'bg-ok/10',
  conflict: 'bg-muted',
  dead_letter: 'bg-danger/10',
}

const STATE_DOT: Record<string, string> = {
  pending: 'bg-muted-foreground',
  in_flight: 'bg-info',
  acked: 'bg-ok',
  conflict: 'bg-warn',
  dead_letter: 'bg-danger',
}

export function SyncLog({
  canRetry,
  onRetry,
}: {
  canRetry: boolean
  onRetry: (id: string) => Promise<void> | void
}) {
  const { data, isLoading } = useQuery<OutboxLogRow>(
    `SELECT o.id, o.type, o.status, o.occurred_at, o.attempts, o.next_attempt_at,
            o.last_error_code, o.last_error_message, s.receipt_number
       FROM outbox o
       LEFT JOIN sale s ON s.id = o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 100`,
  )

  if (isLoading && !data?.length) {
    return (
      <div className="grid gap-2">
        <span className="sr-only">Loading the outbox…</span>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (!data?.length) {
    return (
      <Empty className="border border-border bg-card">
        <EmptyHeader>
          <EmptyTitle>The outbox is empty.</EmptyTitle>
          <EmptyDescription>
            Completed sales appear here until the server acknowledges them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm" data-testid="outbox-table">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Attempts</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium">Next retry</th>
            <th className="px-3 py-2 font-medium">Last error</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-t border-border" data-testid="outbox-row">
              <td className="px-3 py-2">
                {row.receipt_number ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => navigate(`pos/receipt/${row.id}`)}
                    className="-mx-2 h-11 px-2 font-mono text-xs"
                  >
                    {row.receipt_number}
                  </Button>
                ) : (
                  <span className="font-mono text-xs">{row.type}</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums">
                {formatDateTime(row.occurred_at)}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums">{row.attempts}</td>
              <td className="px-3 py-2">
                <Badge
                  className={`gap-1.5 border-transparent text-[11px] ${
                    STATE_TINT[row.status] ?? ''
                  }`}
                  data-testid="outbox-state"
                  data-state={row.status}
                >
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${
                      STATE_DOT[row.status] ?? 'bg-muted-foreground'
                    }`}
                  />
                  {row.status.replace('_', ' ')}
                </Badge>
              </td>
              <td
                className="px-3 py-2 font-mono text-xs tabular-nums"
                title={row.next_attempt_at ? formatDateTime(row.next_attempt_at) : undefined}
              >
                {row.next_attempt_at ? formatRelative(row.next_attempt_at) : '—'}
              </td>
              <td className="max-w-[18rem] px-3 py-2 text-xs">
                {row.last_error_code ? (
                  <span title={row.last_error_message ?? undefined}>
                    {row.last_error_code}
                    {row.last_error_message ? ` — ${row.last_error_message}` : ''}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {canRetry && row.status === 'dead_letter' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onRetry(row.id)}
                    className="h-11 px-3 text-xs"
                    data-testid="retry-dead-letter"
                  >
                    Retry
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
