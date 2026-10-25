import { accraDay, formatTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { ScreenHeader } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import type { StaffSession } from '@/lib/auth/staff-session'
import { formatGhs } from '@/lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { navigate } from '@/lib/router'
import {
  listSalesBetween,
  listSaleTenders,
  type SaleRow,
  type SaleTenderRow,
} from '@/lib/sale/sale-repository'

/**
 * Today's sales on this terminal (Plan 07 Task 4).
 *
 * The local reprint path: every sale the terminal wrote today, whether the
 * shift is still open or was closed. Server-wide reporting is Phase 8; this is
 * what a cashier or manager needs at the counter, offline.
 */

/*
 * The tint and the dot carry the print state; the label stays `text-foreground`
 * so a 11 px chip keeps its contrast (Phase 7's rule).
 */
const STATUS_TINT: Record<string, string> = {
  PENDING: 'bg-muted',
  PRINTING: 'bg-sky-50',
  PRINTED: 'bg-emerald-50',
  FAILED: 'bg-amber-50',
}

const STATUS_DOT: Record<string, string> = {
  PENDING: 'bg-topbar-muted',
  PRINTING: 'bg-info',
  PRINTED: 'bg-ok',
  FAILED: 'bg-warn',
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
        <ScreenHeader
          title="Today's sales"
          description={
            <>
              {bounds.label} · {rows.length} sale{rows.length === 1 ? '' : 's'} on{' '}
              {identity.terminalCode}
              {pending > 0 ? ` · ${pending} not printed` : ''}
            </>
          }
          actions={
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('pos')}
              className="h-11"
              data-testid="back-to-selling"
            >
              Back to selling
            </Button>
          }
        />

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : loading ? (
          <div className="grid gap-2">
            <span className="sr-only">Loading today's sales…</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <Empty className="border border-border bg-card">
            <EmptyHeader>
              <EmptyTitle>No sales yet today.</EmptyTitle>
              <EmptyDescription>
                Completed sales appear here and survive a restart.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
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
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">
                      {formatTime(sale.occurredAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">{tender?.method ?? 'NONE'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {formatGhs(sale.totalMinor)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        className={`gap-1.5 border-transparent text-[11px] ${
                          STATUS_TINT[sale.printStatus] ?? ''
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${
                            STATUS_DOT[sale.printStatus] ?? 'bg-topbar-muted'
                          }`}
                        />
                        {sale.printStatus.toLowerCase()}
                        {sale.reprintCount > 0 ? ` · ${sale.reprintCount}x` : ''}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`pos/receipt/${sale.id}`)}
                        className="h-11 px-3 text-xs"
                      >
                        Open
                      </Button>
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
