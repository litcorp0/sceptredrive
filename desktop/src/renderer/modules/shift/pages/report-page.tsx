import { formatAccraDateTime, formatDateTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { ScreenHeader, StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { PosConfigSnapshot } from '@/lib/api/types'
import type { StaffSession } from '@/lib/auth/staff-session'
import { formatGhs } from '@/lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosDatabase } from '@/lib/powersync/provider'
import { buildReportDocument } from '@/lib/receipt/report-render'
import { navigate, useHashRoute, useRedirect } from '@/lib/router'
import { type LocalShiftReport, localShiftReport, readShiftFigures } from '@/lib/shift/shift-report'
import { findShiftById } from '@/lib/shift/shift-repository'
import { computeExpectedCash } from '@/lib/shift/shift-service'
import { ReportPreview } from '../components/report-preview'
import { printReportDocument, reportPrintLabel, shiftReportContext } from '../print-report'
import { varianceWords } from '../utils/variance'

/**
 * The X-report (`#pos/shift/report`; P13-D33).
 *
 * The same document as the Z, asked live: what the shift looks like at this
 * moment, stored nowhere and closing nothing. It reads the till's own rows with
 * the same `readShiftFigures` the close uses, so an X taken a minute before the
 * close cannot disagree with the Z that follows it.
 *
 * Printing is available here and prints the same paper with `X-REPORT` and the
 * generation time, because a manager who wants a mid-shift conversation with a
 * cashier wants it on paper.
 */
export function ShiftReportScreen({
  identity,
  shift,
  staff,
  config,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
  config: PosConfigSnapshot
}) {
  const db = usePosDatabase()
  const route = useHashRoute()
  const [report, setReport] = useState<LocalShiftReport | null>(null)
  const [printNote, setPrintNote] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `#pos/shift` alone means nothing: the shift screen lives at `#shift`.
  useRedirect(route.segments[2] !== 'report', 'pos')

  useEffect(() => {
    let cancelled = false
    if (!shift) {
      setReport(null)
      return
    }
    void (async () => {
      try {
        const row = await findShiftById(db, shift.id)
        if (!row || cancelled) return
        const figures = await readShiftFigures(db, row.id)
        const expectedCashMinor = computeExpectedCash({
          openingFloatMinor: row.openingFloatMinor,
          cashTendersMinor: figures.cashMinor,
          changeMinor: figures.changeMinor,
          cashInMinor: figures.cashInMinor,
          cashOutMinor: figures.cashOutMinor,
        })
        setReport(localShiftReport(row, figures, expectedCashMinor, new Date().toISOString()))
        setError(null)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'The report could not be read')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, shift])

  if (route.segments[2] !== 'report') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">Opening the shift screen…</p>
      </main>
    )
  }

  const document =
    report === null
      ? null
      : buildReportDocument(
          report,
          shiftReportContext({
            kind: 'X',
            report,
            identity,
            cashierName: staff.name,
            seller: config.receiptHeader,
          }),
        )

  async function print() {
    if (!document) return
    setPrinting(true)
    try {
      setPrintNote(reportPrintLabel(await printReportDocument(db, document)))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sceptre Drive POS
          </p>
          <p className="text-sm font-semibold">
            {identity.branchCode} · {identity.terminalCode}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{staff.name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {staff.staffId} · {staff.role}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl p-6">
        <ScreenHeader
          title="X report"
          description={
            shift
              ? `${shift.number} · live figures, not stored, not a close`
              : 'No open shift — an X report is for a shift that is open'
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('shift')}
                className="h-11"
                data-testid="x-report-back"
              >
                Back to shift
              </Button>
              <Button
                type="button"
                disabled={!document || printing}
                onClick={() => void print()}
                className="h-11"
                data-testid="x-report-print"
              >
                {printing ? 'Printing…' : 'Print X'}
              </Button>
            </>
          }
        />

        {error ? (
          <StatusNote tone="danger" role="alert" className="mb-4">
            {error}
          </StatusNote>
        ) : null}

        {printNote ? (
          <StatusNote tone="info" role="status" className="mb-4">
            {printNote}
          </StatusNote>
        ) : null}

        {!shift || !report || !document ? (
          <Empty className="rounded-xl border border-border bg-card">
            <EmptyHeader>
              <EmptyTitle>
                <h2 className="text-base font-semibold">Nothing to report yet</h2>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">Sales</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {report.saleCount} · {formatGhs(report.grossMinor)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">
                  Expected cash
                </p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {formatGhs(report.expectedCashMinor)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">Variance</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {varianceWords(report.varianceMinor ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The drawer is counted at the close.
                </p>
              </div>
            </div>

            <p className="mb-2 text-xs text-muted-foreground">
              Generated {formatAccraDateTime(report.generatedAt)} · opened{' '}
              {formatDateTime(report.openedAt)} · this document is not stored and closes nothing.
            </p>

            <ReportPreview document={document} />
          </>
        )}
      </main>
    </div>
  )
}
