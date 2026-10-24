import { accraDay, formatTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { AppHeader } from '../../components/pos/app-header'
import type { StaffSession } from '../../lib/auth/staff-session'
import { formatGhs } from '../../lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { usePos } from '../../lib/powersync/provider'
import { navigate } from '../../lib/router'
import {
  listSalesBetween,
  listSaleTenders,
  type SaleRow,
  type SaleTenderRow,
} from '../../lib/sale/sale-repository'

/**
 * Today's sales on this terminal (Plan 07 Task 4).
 *
 * The local reprint path: every sale the terminal wrote today, whether the
 * shift is still open or was closed. Server-wide reporting is Phase 8; this is
 * what a cashier or manager needs at the counter, offline.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  PRINTING: 'bg-sky-50 text-sky-800',
  PRINTED: 'bg-emerald-50 text-emerald-800',
  FAILED: 'bg-amber-50 text-amber-900',
}

function dayBounds(now = new Date()): { from: string; to: string; label: string } {
  const day = accraDay(now)
  const isoDay = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const nextDay = accraDay(next)
  const nextIso = `${nextDay.slice(0, 4)}-${nextDay.slice(4, 6)}-${nextDay.slice(6, 8)}`
  return { from: `${isoDay}T00:00:00.000Z`, to: `${nextIso}T00:00:00.000Z`, label: isoDay }
}

interface Row {
  sale: SaleRow
  tender: SaleTenderRow | null
}

export function SalesScreen({
  identity,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  const { db } = usePos()
  const [rows, setRows] = useState<Row[]>([])
  const [bounds, setBounds] = useState(() => dayBounds())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!db) return
      try {
        const range = dayBounds()
        const sales = await listSalesBetween(db, identity.terminalId, range.from, range.to)
        const withTenders = await Promise.all(
          sales.map(async (sale) => ({
            sale,
            tender: (await listSaleTenders(db, sale.id))[0] ?? null,
          })),
        )
        if (cancelled) return
        setBounds(range)
        setRows(withTenders)
        setError(null)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Sales could not be loaded')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, identity.terminalId])

  const pending = rows.filter((row) => row.sale.printStatus !== 'PRINTED').length

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate(shift ? 'pos' : 'pos/sales')}
        lockNote="Back to selling"
      />

      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Today's sales</h1>
            <p className="text-sm text-muted-foreground">
              {bounds.label} · {rows.length} sale{rows.length === 1 ? '' : 's'} on{' '}
              {identity.terminalCode}
              {pending > 0 ? ` · ${pending} not printed` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('pos')}
              className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              data-testid="back-to-selling"
            >
              Back to selling
            </button>
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading today's sales…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No sales yet today. Completed sales appear here and survive a restart.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Receipt</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Tender</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Print</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ sale, tender }) => (
                  <tr
                    key={sale.id}
                    className="border-t border-border hover:bg-muted/30"
                    data-testid="sale-row"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{sale.receiptNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs">{formatTime(sale.occurredAt)}</td>
                    <td className="px-3 py-2 text-xs">{tender?.method ?? 'NONE'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatGhs(sale.totalMinor)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_STYLES[sale.printStatus] ?? ''
                        }`}
                      >
                        {sale.printStatus.toLowerCase()}
                        {sale.reprintCount > 0 ? ` · ${sale.reprintCount}x` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`pos/receipt/${sale.id}`)}
                        className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Opening a receipt lets you reprint it or open the cash drawer. Any older receipt that
          still needs printing is listed here too, so a printer problem never hides a sale.
        </p>
      </main>
    </div>
  )
}
