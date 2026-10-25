import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { StaffSession } from '@/lib/auth/staff-session'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { createSaleStore, openDrawerNow, printSale } from '@/lib/printing/print-sale'
import { desktopPrinterTransport } from '@/lib/printing/printer-service'
import { loadPrinterSettings, type PrinterSettings } from '@/lib/printing/settings'
import { buildReceiptModel, type ReceiptModel } from '@/lib/receipt/render'
import { navigate } from '@/lib/router'
import type { PrintStatus } from '@/lib/sale/sale-repository'
import { ReceiptView } from '../components/receipt-view'

/**
 * Receipt screen and print orchestration (Plan 07 Task 4).
 *
 * Reached immediately after a sale commits. Auto-prints a PENDING sale once,
 * shows every printer failure non-blockingly with Retry, and offers the drawer
 * by hand when the receipt could not be printed. Nothing here can affect the
 * committed sale.
 */

/* The tint and the dot carry the print state; the label stays `text-foreground`. */
const STATUS_TINT: Record<PrintStatus, string> = {
  PENDING: 'bg-muted',
  PRINTING: 'bg-sky-50',
  PRINTED: 'bg-emerald-50',
  FAILED: 'bg-amber-50',
}

const STATUS_DOT: Record<PrintStatus, string> = {
  PENDING: 'bg-topbar-muted',
  PRINTING: 'bg-info',
  PRINTED: 'bg-ok',
  FAILED: 'bg-warn',
}

export function ReceiptScreen({
  identity,
  shift,
  staff,
  saleId,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
  saleId: string
}) {
  const { db } = usePos()
  const [model, setModel] = useState<ReceiptModel | null>(null)
  const [printStatus, setPrintStatus] = useState<PrintStatus>('PENDING')
  const [settings, setSettings] = useState<PrinterSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isCash, setIsCash] = useState(false)
  const autoPrintStarted = useRef(false)

  async function refresh(reprint = false): Promise<PrintStatus | null> {
    if (!db) return null
    const store = createSaleStore(db)
    const sale = await store.getSale(saleId)
    if (!sale) {
      setLoadError('This sale is not on this terminal')
      return null
    }
    const [lines, tenders, context, cashierName, customer] = await Promise.all([
      store.getLines(saleId),
      store.getTenders(saleId),
      store.getContext(),
      store.getCashierName(sale.cashierStaffId),
      sale.customerId ? store.getCustomer(sale.customerId) : Promise.resolve(null),
    ])
    setModel(
      buildReceiptModel({
        sale,
        lines,
        tenders,
        context,
        cashierName,
        customer,
        reprint,
      }),
    )
    setPrintStatus(sale.printStatus)
    setIsCash(tenders.some((tender) => tender.method === 'CASH'))
    setLoadError(null)
    return sale.printStatus
  }

  async function runPrint(reprint: boolean): Promise<void> {
    if (!db || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const active = settings ?? (await loadPrinterSettings(db))
      if (!settings) setSettings(active)
      const result = await printSale(
        {
          store: createSaleStore(db),
          transport: desktopPrinterTransport,
          settings: active,
        },
        saleId,
        { reprint },
      )
      if (result.outcome.ok) {
        setMessage(reprint ? 'Reprinted' : 'Printed')
      } else {
        setMessage(
          result.outcome.code === 'PRINTER_NOT_CONFIGURED'
            ? 'No printer is configured for this terminal. Set one in Settings.'
            : result.outcome.message,
        )
      }
      await refresh(reprint)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The printer could not be reached')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!db) return
      const [currentSettings, status] = await Promise.all([loadPrinterSettings(db), refresh(false)])
      if (cancelled) return
      setSettings(currentSettings)

      // A committed sale whose print never started (PENDING) gets one automatic
      // attempt. FAILED and a stale PRINTING wait for the button: a crash during
      // printing may already have produced paper, so retrying is a human choice.
      if (status === 'PENDING' && !autoPrintStarted.current) {
        autoPrintStarted.current = true
        await runPrint(false)
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        setLoadError(error instanceof Error ? error.message : 'The receipt could not be loaded')
      }
    })
    return () => {
      cancelled = true
    }
    // `refresh`/`runPrint` are stable enough for this one-shot load; the effect
    // intentionally runs on saleId and database only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, saleId])

  async function openDrawer(): Promise<void> {
    if (!db) return
    setBusy(true)
    const active = settings ?? (await loadPrinterSettings(db))
    const outcome = await openDrawerNow({
      transport: desktopPrinterTransport,
      settings: active,
    })
    setMessage(outcome.ok ? 'Cash drawer opened' : outcome.message)
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate('pos/sales')}
        lockNote="Back to today's sales"
      />

      <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {loadError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
          ) : model ? (
            <ReceiptView model={model} />
          ) : (
            <div className="grid gap-2">
              <span className="sr-only">Loading receipt…</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </div>

        <aside className="grid content-start gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <ScreenHeader
              className="mb-0"
              title="Receipt"
              badge={
                <Badge
                  className={`gap-1.5 border-transparent text-[11px] ${STATUS_TINT[printStatus]}`}
                  data-testid="print-status"
                  data-status={printStatus}
                >
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[printStatus]}`}
                  />
                  {printStatus === 'PRINTING' ? 'Printing…' : printStatus.toLowerCase()}
                </Badge>
              }
              description={
                <span
                  className="mt-1 block font-mono text-xs text-foreground tabular-nums"
                  data-testid="receipt-number"
                >
                  {model?.header.receiptNumber ?? saleId}
                </span>
              }
            >
              <p className="mt-1 text-xs text-muted-foreground">
                The sale is recorded on this terminal. Printing never blocks the next sale.
              </p>
            </ScreenHeader>
          </div>

          {message ? (
            <output
              className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs"
              data-testid="print-message"
            >
              {message}
            </output>
          ) : null}

          {printStatus === 'FAILED' ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The receipt did not print. The sale is safe — retry when the printer is ready.
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={() => void runPrint(true)}
            disabled={busy}
            className="h-11"
            data-testid="print-again"
          >
            {busy ? 'Working…' : 'Print again'}
          </Button>

          {isCash ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void openDrawer()}
              disabled={busy}
              className="h-11"
              data-testid="open-drawer"
            >
              Open drawer
            </Button>
          ) : null}

          <Button
            type="button"
            onClick={() => navigate('pos')}
            className="h-14 text-sm"
            data-testid="new-sale"
          >
            New sale
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('pos/sales')}
            className="h-11"
            data-testid="todays-sales"
          >
            Today's sales
          </Button>

          {settings?.driver === 'fake' ? (
            <p className="text-[11px] text-muted-foreground">
              This terminal uses the file-output printer. A manager can choose a real printer in
              Settings.
            </p>
          ) : null}
        </aside>
      </main>
    </div>
  )
}
