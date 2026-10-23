import { useQuery } from '@powersync/react'
import { navigate } from '../../lib/router'

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

const STATE_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_flight: 'bg-sky-50 text-sky-800',
  acked: 'bg-emerald-50 text-emerald-800',
  conflict: 'bg-amber-50 text-amber-900',
  dead_letter: 'bg-red-50 text-red-700',
}

function time(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toISOString().slice(5, 16).replace('T', ' ')
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
    return <p className="text-sm text-muted-foreground">Loading the outbox…</p>
  }
  if (!data?.length) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        The outbox is empty. Completed sales appear here until the server acknowledges them.
      </p>
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
                  <button
                    type="button"
                    className="font-mono text-xs underline-offset-2 hover:underline"
                    onClick={() => navigate(`pos/receipt/${row.id}`)}
                  >
                    {row.receipt_number}
                  </button>
                ) : (
                  <span className="font-mono text-xs">{row.type}</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{time(row.occurred_at)}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.attempts}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    STATE_STYLES[row.status] ?? ''
                  }`}
                  data-testid="outbox-state"
                  data-state={row.status}
                >
                  {row.status.replace('_', ' ')}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{time(row.next_attempt_at)}</td>
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
                  <button
                    type="button"
                    onClick={() => void onRetry(row.id)}
                    className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                    data-testid="retry-dead-letter"
                  >
                    Retry
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
