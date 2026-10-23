import { useQuery } from '@powersync/react'
import { navigate } from '../../lib/router'

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

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: 'bg-red-50 text-red-700',
  MEDIUM: 'bg-amber-50 text-amber-900',
  LOW: 'bg-muted text-muted-foreground',
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
    return <p className="text-sm text-muted-foreground">Loading conflicts…</p>
  }
  if (!data?.length) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No conflicts. Oversells, credit overrides, price drift, and loyalty issues would appear here
        after a sync.
      </p>
    )
  }

  return (
    <ul className="grid gap-2" data-testid="conflict-list">
      {data.map((conflict) => (
        <li key={conflict.id} className="rounded-lg border border-border bg-card">
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  SEVERITY_STYLES[conflict.severity] ?? ''
                }`}
              >
                {conflict.severity}
              </span>
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
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {conflict.created_at.slice(0, 16).replace('T', ' ')} · {conflict.status}
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
                  <button
                    type="button"
                    onClick={() => navigate(`pos/receipt/${conflict.sale_id}`)}
                    className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    Open receipt
                  </button>
                ) : null}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
