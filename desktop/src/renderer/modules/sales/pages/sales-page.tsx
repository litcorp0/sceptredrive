import { accraDayBounds, formatTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { ScreenHeader, StatusNote } from '@/components/common'
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
 * Today's sales on this terminal (Plan 07 Task 4; day window from Phase 10 Plan 08).
 *
 * The local reprint path: every sale the terminal wrote today, whether the
 * shift is still open or was closed. Server-wide reporting is the console's job;
 * this is what a cashier or manager needs at the counter, offline.
 *
 * The day window comes from `accraDayBounds` in `@sceptre/shared`. The screen used to
 * build it inline by adding 24 hours to the current instant, which is the one thing the
 * shared helper exists to prevent: a day is a calendar concept, and a second copy of that
 * arithmetic is how the till and the dashboard start disagreeing about midnight.
 *
 * `listSalesBetween` also returns any sale whose print state is still pending, whatever its
 * date, so an older receipt that never printed is never hidden by a printer problem.
 */

/* The tint and the dot carry the print state; the label stays `text-foreground`
   so an 11 px chip keeps its contrast (Phase 7's rule). */
const STATUS_TINT: Record<string, string> = {
  PENDING: 'bg-muted',
  PRINTING: 'bg-info/10',
  PRINTED: 'bg-ok/10',
  FAILED: 'bg-warn/10',
}

const STATUS_DOT: Record<string, string> = {
  PENDING: 'bg-muted-foreground',
  PRINTING: 'bg-info',
  PRINTED: 'bg-ok',
  FAILED: 'bg-warn',
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
  const [day, setDay] = useState(() => accraDayBounds().day)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!db) return
      try {
        const range = accraDayBounds()
        const sales = await listSalesBetween(db, identity.terminalId, range.from, range.to)
        const withTenders = await Promise.all(
          sales.map(async (sale) => ({
            sale,
            tender: (await listSaleTenders(db, sale.id))[0] ?? null,
          })),
        )
        if (cancelled) return
        setDay(range.day)
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
  const totalMinor = rows.reduce((sum, row) => sum + row.sale.totalMinor, 0)

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
              {day} · {rows.length} sale{rows.length === 1 ? '' : 's'} on {identity.terminalCode}
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
          <StatusNote tone="danger" role="alert" className="mb-3">
            {error}
          </StatusNote>
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
              <caption className="border-b border-border px-3 py-2 text-left text-xs text-muted-foreground">
                Today on {identity.terminalCode} · {rows.length} sale
                {rows.length === 1 ? '' : 's'} ·{' '}
                <span className="font-mono text-foreground tabular-nums">
                  {formatGhs(totalMinor)}
                </span>{' '}
                taken
              </caption>
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Receipt
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tender
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Print
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ sale, tender }) => {
                  const time = formatTime(sale.occurredAt)
                  const how = tender?.method ?? 'NONE'
                  return (
                    <tr
                      key={sale.id}
                      className="border-t border-border hover:bg-muted/30"
                      data-testid="sale-row"
                    >
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-mono text-xs font-normal tabular-nums"
                      >
                        {sale.receiptNumber}
                      </th>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">{time}</td>
                      <td className="px-3 py-2 text-xs">{how}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {formatGhs(sale.totalMinor)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          className={`gap-1.5 border-transparent text-[11px] text-foreground ${
                            STATUS_TINT[sale.printStatus] ?? ''
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full ${
                              STATUS_DOT[sale.printStatus] ?? 'bg-muted-foreground'
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
                          aria-label={`Open receipt ${sale.receiptNumber}, ${time}, paid by ${how.toLowerCase()}`}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Opening a receipt lets you reprint it or open the cash drawer. Any receipt that still
          needs printing is listed here too, even from an earlier day, so a printer problem never
          hides a sale.
        </p>
      </main>
    </div>
  )
}
