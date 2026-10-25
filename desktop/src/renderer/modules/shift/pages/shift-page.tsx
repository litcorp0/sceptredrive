import { formatDateTime, formatTime } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { ScreenHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { endStaffSession, useStaffSession } from '@/lib/auth/staff-session'
import { formatGhs } from '@/lib/format'
import { usePos } from '@/lib/powersync/provider'
import {
  type CloseShiftResult,
  closeShift,
  loadShiftState,
  openShift,
  recordCashMovement,
  type ShiftState,
} from '@/lib/shift/shift-service'
import { CashMovementDialog, CloseShiftDialog, OpenShiftDialog } from '../components/shift-dialogs'

type Dialog = 'open' | 'cash-in' | 'cash-out' | 'close' | null

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/**
 * Shift screen: open with a float, record cash in/out, close with counted cash.
 * Everything works offline; the outbox row ships with Plan 08's uploader.
 */
export function ShiftRoute() {
  const { db, session } = usePos()
  const staff = useStaffSession()
  const [state, setState] = useState<ShiftState | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [lastClose, setLastClose] = useState<CloseShiftResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!db) return
    const next = await loadShiftState(db)
    setState(next)
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

  async function handleOpen(openingFloatMinor: number) {
    if (!db) return
    await openShift(db, { openingFloatMinor })
    setDialog(null)
    setLastClose(null)
    await refresh()
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

  async function handleClose(input: { countedCashMinor: number; note?: string }) {
    if (!db) return
    const result = await closeShift(db, input)
    setDialog(null)
    setLastClose(result)
    await refresh()
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sceptre Drive POS
          </p>
          <p className="text-sm font-semibold">
            {session?.branch.code ?? '—'} · {session?.terminal.code ?? '—'}
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
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              lastClose.varianceMinor === 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            Shift closed. Expected {formatGhs(lastClose.expectedCashMinor)}, counted{' '}
            {formatGhs(lastClose.shift.countedCashMinor ?? 0)} — variance{' '}
            <strong>{formatGhs(lastClose.varianceMinor)}</strong>.
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
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
              description={`Opened ${formatDateTime(shift.openedAt)} by ${staff.name}`}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      window.location.hash = '#pos'
                    }}
                    className="h-11"
                  >
                    Start selling
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
              <Stat label="Cash movements" value={String(state?.movements.length ?? 0)} />
            </div>

            <section className="mt-6 overflow-hidden rounded-lg border border-border">
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
                        <td className="px-4 py-2 text-muted-foreground">
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
          onClose={() => setDialog(null)}
          onConfirm={handleClose}
        />
      ) : null}
    </main>
  )
}
