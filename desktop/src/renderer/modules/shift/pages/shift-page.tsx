import { formatBranchLabel, formatDateTime, formatTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { ScreenHeader, StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { endStaffSession, useStaffSession } from '@/lib/auth/staff-session'
import { formatGhs } from '@/lib/format'
import { type HeldCartSummary, listHeldCarts } from '@/lib/hold/hold-service'
import { usePos } from '@/lib/powersync/provider'
import { navigate } from '@/lib/router'
import { readCashierName } from '@/lib/sale/sale-repository'
import {
  closeAuthority,
  isOwnDrawer,
  loadShiftState,
  openShift,
  recordCashMovement,
  type ShiftState,
} from '@/lib/shift/shift-service'
import { useUnsyncedSales } from '@/lib/sync/outbox-summary'
import type { ReportDocument } from '../../../../shared/printing'
import { ReportPreview } from '../components/report-preview'
import { CashMovementDialog, CloseShiftDialog, OpenShiftDialog } from '../components/shift-dialogs'
import { type CloseShiftWithReportResult, closeShiftWithReport } from '../utils/close-shift'
import {
  closedShiftDocument,
  printReportDocument,
  reportPrintLabel,
  reportReprintDocument,
} from '../utils/print-report'
import { varianceWords } from '../utils/variance'

type Dialog = 'open' | 'cash-in' | 'cash-out' | 'close' | null

function Stat({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  /** One line of context. A figure that means nothing on its own gets one. */
  caption?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</p>
      {caption ? <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p> : null}
    </div>
  )
}

function TenderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * Shift screen: open with a float, record cash in/out, close with counted cash.
 * Everything works offline; the outbox row ships with the uploader.
 *
 * Three figures answer the three questions a cashier asks: what did I start
 * with, what should be in the drawer now, and how far off am I. The variance
 * cannot exist until the drawer is counted, so while the shift is open it says
 * so rather than showing a zero — a zero would read as a balanced drawer.
 *
 * Phase 13 Plan 11 adds the two halves of a close that a drawer needs: the holds
 * question before the count, and a Z document written from the till's own rows
 * and printed from the local snapshot (so it prints with the cable out). A
 * printer failure never un-closes a shift; **Print again** is the retry.
 */
export function ShiftRoute() {
  const { db, session } = usePos()
  const staff = useStaffSession()
  const unsyncedSales = useUnsyncedSales()
  const [state, setState] = useState<ShiftState | null>(null)
  const [holds, setHolds] = useState<HeldCartSummary[]>([])
  /** The open drawer's cashier, from the device's own binding rows. */
  const [drawerCashierName, setDrawerCashierName] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [lastClose, setLastClose] = useState<CloseShiftWithReportResult | null>(null)
  const [reportDocument, setReportDocument] = useState<ReportDocument | null>(null)
  const [printNote, setPrintNote] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!db) return
    const next = await loadShiftState(db)
    setState(next)
    setHolds(await listHeldCarts(db))
    // The drawer knows who opened it, and a manager closing it has to name
    // them: the binding table is the till's only local name for that staff
    // member, so a missing row falls back to their staff number — and a failed
    // lookup costs the name, not the drawer screen.
    setDrawerCashierName(
      next.shift ? await readCashierName(db, next.shift.cashierStaffId).catch(() => null) : null,
    )
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Sign in with a PIN to open a shift.</p>
          <Button
            type="button"
            onClick={() => {
              window.location.hash = '#login'
            }}
            className="mt-4 h-11 px-6"
          >
            Go to sign-in
          </Button>
        </div>
      </main>
    )
  }

  const shift = state?.shift ?? null
  const expected = state?.expectedCashMinor ?? 0
  // A manager or admin takes a drawer over at shift end; the close dialog says
  // whose drawer it is and who the review will name (P14-D12).
  const drawerCashier = drawerCashierName ?? shift?.cashierStaffId ?? null
  const closingForOther =
    shift !== null &&
    closeAuthority(shift, staff, session?.branch.id ?? shift.branchId) === 'MANAGER'

  async function handleOpen(openingFloatMinor: number) {
    if (!db) return
    await openShift(db, { openingFloatMinor })
    setDialog(null)
    setLastClose(null)
    setReportDocument(null)
    await refresh()
    // A shift is open, so the till owes the cashier the day's picture rather than a second
    // confirmation screen: the roadmap's promise is that the terminal opens on the shift home.
    // `#home` renders it, and selling is one action from there (P10-D6).
    window.location.hash = '#home'
  }

  async function handleCashMovement(input: {
    type: 'CASH_IN' | 'CASH_OUT'
    amountMinor: number
    reason: string
  }) {
    if (!db) return
    await recordCashMovement(db, input)
    setDialog(null)
    await refresh()
  }

  async function runPrint(document: ReportDocument, reprint: boolean) {
    if (!db) return
    setPrinting(true)
    try {
      const outcome = await printReportDocument(
        db,
        reprint ? reportReprintDocument(document) : document,
      )
      setPrintNote(reportPrintLabel(outcome))
    } finally {
      setPrinting(false)
    }
  }

  async function handleClose(input: {
    countedCashMinor: number
    note?: string
    holdsDecision: 'KEEP' | 'VOID_ALL'
  }) {
    // A hoisted function declaration does not inherit the render's signed-in
    // narrowing, so the screen's guard is restated where the name is used.
    if (!db || !staff) return
    const result = await closeShiftWithReport(db, input)
    setDialog(null)
    setLastClose(result)
    setError(null)
    await refresh()

    if (session) {
      // The drawer belongs to its cashier and the count belongs to the closer.
      // Sameness is decided on staff identity, not on two display names —
      // re-read from the close's own shift row rather than trusting state that
      // has just been refreshed.
      const drawerOwner =
        (await readCashierName(db, result.shift.cashierStaffId).catch(() => null)) ??
        result.shift.cashierStaffId
      const document = closedShiftDocument({
        report: result.report,
        identity: {
          branchCode: session.branch.code,
          branchName: session.branch.name,
          terminalCode: session.terminal.code,
        },
        cashierName: drawerOwner,
        closedByName: isOwnDrawer(result.shift, staff) ? null : staff.name,
        seller: session.config.receiptHeader,
      })
      setReportDocument(document)
      await runPrint(document, false)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sceptre Drive POS
          </p>
          <p className="text-sm font-semibold">
            {session ? formatBranchLabel(session.branch) : '—'} · {session?.terminal.code ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="font-medium">{staff.name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {staff.staffId} · {staff.role}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (shift) {
                setError('Close the shift before signing out')
                return
              }
              endStaffSession()
              window.location.hash = '#login'
            }}
            className="h-11 px-3 text-xs"
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl p-6">
        {lastClose ? (
          <Card className="mb-4 gap-0 py-4" data-testid="close-summary">
            <div className="px-5">
              <h2 className="font-display text-lg font-semibold">
                Shift {lastClose.shift.number} closed
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Counted at {formatTime(lastClose.shift.closedAt ?? new Date().toISOString())}. The
                server recomputes these figures when the shift syncs.
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Expected</dt>
                  <dd className="font-mono text-lg tabular-nums">
                    {formatGhs(lastClose.expectedCashMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Counted</dt>
                  <dd className="font-mono text-lg tabular-nums">
                    {formatGhs(lastClose.shift.countedCashMinor ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Variance</dt>
                  <dd
                    className="flex items-center gap-1.5 font-mono text-lg font-semibold text-foreground tabular-nums"
                    data-testid="close-summary-variance"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${
                        lastClose.varianceMinor === 0
                          ? 'bg-ok'
                          : lastClose.varianceMinor > 0
                            ? 'bg-warn'
                            : 'bg-danger'
                      }`}
                    />
                    {varianceWords(lastClose.varianceMinor)}
                  </dd>
                </div>
              </dl>

              <dl className="mt-4 grid gap-1 border-t border-border pt-3 sm:grid-cols-2 sm:gap-x-8">
                <TenderRow label="Cash" value={formatGhs(lastClose.report.cashMinor)} />
                <TenderRow label="Credit" value={formatGhs(lastClose.report.creditMinor)} />
                <TenderRow label="MoMo" value={formatGhs(lastClose.report.momoMinor)} />
                <TenderRow label="Card" value={formatGhs(lastClose.report.cardMinor)} />
                <TenderRow
                  label="Bank transfer"
                  value={formatGhs(lastClose.report.bankTransferMinor)}
                />
                <TenderRow label="Change given" value={formatGhs(lastClose.report.changeMinor)} />
                <TenderRow
                  label={`Refunds (${lastClose.report.refundCount})`}
                  value={formatGhs(lastClose.report.refundMinor)}
                />
                <TenderRow
                  label={`Voided carts (${lastClose.report.voidCount})`}
                  value={String(lastClose.report.voidCount)}
                />
              </dl>

              {lastClose.voidedHolds > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {lastClose.voidedHolds} held cart
                  {lastClose.voidedHolds === 1 ? '' : 's'} voided as customer-left.
                </p>
              ) : null}

              {printNote ? (
                <p className="mt-3 text-xs text-muted-foreground" data-testid="report-print-note">
                  {printNote}
                </p>
              ) : null}

              {reportDocument ? (
                <details className="mt-3 rounded-md border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                    Printed report
                  </summary>
                  <div className="border-t border-border p-3">
                    <ReportPreview document={reportDocument} />
                  </div>
                </details>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={printing || !reportDocument}
                  onClick={() => {
                    if (reportDocument) void runPrint(reportDocument, true)
                  }}
                  className="h-11 px-6"
                  data-testid="print-report-again"
                >
                  {printing ? 'Printing…' : 'Print again'}
                </Button>
                <Button type="button" onClick={() => setLastClose(null)} className="h-11 px-6">
                  Done
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {error ? (
          <StatusNote tone="danger" role="alert" className="mb-4">
            {error}
          </StatusNote>
        ) : null}

        {!shift ? (
          <Empty className="rounded-xl border border-border bg-card">
            <EmptyHeader>
              <EmptyTitle>
                <h1 className="text-xl font-semibold">No open shift</h1>
              </EmptyTitle>
              <EmptyDescription>
                Count the float in the drawer and open the shift. Cash sales, change, and cash
                movements are tracked against it until you close.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                onClick={() => {
                  setError(null)
                  setDialog('open')
                }}
                className="h-14 px-8 text-sm"
              >
                Open shift
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <ScreenHeader
              title={`Shift ${shift.number}`}
              description={`Opened ${formatDateTime(shift.openedAt)} by ${drawerCashier ?? staff.name}`}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      window.location.hash = '#home'
                    }}
                    className="h-11"
                    data-testid="shift-to-home"
                  >
                    Go to today
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('pos/shift/report')}
                    className="h-11"
                    data-testid="shift-x-report"
                  >
                    X report
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialog('cash-in')}
                    className="h-11"
                  >
                    Cash in
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialog('cash-out')}
                    className="h-11"
                  >
                    Cash out
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setDialog('close')}
                    className="h-14 px-6 text-sm"
                  >
                    Close shift
                  </Button>
                </>
              }
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Opening float" value={formatGhs(shift.openingFloatMinor)} />
              <Stat label="Expected cash" value={formatGhs(expected)} />
              <Stat label="Variance" value="—" caption="Known when you count the drawer" />
            </div>

            {holds.length > 0 ? (
              <StatusNote tone="notice" role="status" className="mt-4">
                {holds.length} cart{holds.length === 1 ? '' : 's'} held on this till, worth{' '}
                {formatGhs(holds.reduce((total, hold) => total + hold.totalMinor, 0))}. Closing asks
                what to do with them; they are not deleted by the shift.
              </StatusNote>
            ) : null}

            <section className="mt-6 overflow-hidden rounded-lg border border-border">
              <h2 className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Cash movements · {state?.movements.length ?? 0}
              </h2>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(state?.movements.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        No cash movements yet.
                      </td>
                    </tr>
                  ) : (
                    state?.movements.map((movement) => (
                      <tr key={movement.id}>
                        <td className="px-4 py-2 font-mono text-muted-foreground tabular-nums">
                          {formatTime(movement.occurredAt)}
                        </td>
                        <td className="px-4 py-2">
                          {movement.type === 'CASH_IN' ? 'Cash in' : 'Cash out'}
                        </td>
                        <td className="px-4 py-2">{movement.reason}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {movement.type === 'CASH_IN' ? '+' : '−'}
                          {formatGhs(movement.amountMinor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>

      {dialog === 'open' ? (
        <OpenShiftDialog onClose={() => setDialog(null)} onConfirm={handleOpen} />
      ) : null}

      {dialog === 'cash-in' || dialog === 'cash-out' ? (
        <CashMovementDialog
          type={dialog === 'cash-in' ? 'CASH_IN' : 'CASH_OUT'}
          expectedCashMinor={expected}
          onClose={() => setDialog(null)}
          onConfirm={handleCashMovement}
        />
      ) : null}

      {dialog === 'close' ? (
        <CloseShiftDialog
          expectedCashMinor={expected}
          holds={holds}
          otherCashierName={closingForOther ? drawerCashier : null}
          unsynced={unsyncedSales}
          onClose={() => setDialog(null)}
          onConfirm={handleClose}
        />
      ) : null}
    </main>
  )
}
