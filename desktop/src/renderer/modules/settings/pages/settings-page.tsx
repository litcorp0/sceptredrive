import { useEffect, useState } from 'react'
import { ScreenHeader } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PosConfigSnapshot } from '@/lib/api/types'
import { endStaffSession, type StaffSession } from '@/lib/auth/staff-session'
import { posRuntimeConfig } from '@/lib/config'
import { desktopApi, isDesktopAvailable } from '@/lib/desktop-api'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { desktopPrinterTransport } from '@/lib/printing/printer-service'
import {
  CURRENCY_SYMBOLS,
  loadPrinterSettings,
  type PrinterSettings,
  printerSettingsProblem,
  savePrinterSettings,
  toPrinterTarget,
} from '@/lib/printing/settings'
import { navigate } from '@/lib/router'
import { PRINT_ENCODINGS, type PrinterInfo } from '../../../../shared/printing'

/**
 * Terminal settings (Plan 06 Task 1; printer setup in Plan 07).
 *
 * Manager-only. Server policy is read-only here (the server owns it); the
 * printer target, drawer pin, charset, and copies are local hardware facts and
 * are editable on the terminal.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsScreen({
  identity,
  config,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  config: PosConfigSnapshot
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  const { db } = usePos()
  const [printer, setPrinter] = useState<PrinterSettings | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [platform, setPlatform] = useState<string | null>(null)
  const [printerMessage, setPrinterMessage] = useState<string | null>(null)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [printerBusy, setPrinterBusy] = useState(false)

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void loadPrinterSettings(db).then((loaded) => {
      if (!cancelled) setPrinter(loaded)
    })
    if (isDesktopAvailable()) {
      void desktopApi
        .getAppInfo()
        .then((info) => {
          if (!cancelled) setPlatform(info.platform)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [db])

  function updatePrinter(patch: Partial<PrinterSettings>): void {
    setPrinter((current) => (current ? { ...current, ...patch } : current))
    setPrinterMessage(null)
    setPrinterError(null)
  }

  async function savePrinter(): Promise<void> {
    if (!db || !printer) return
    setPrinterBusy(true)
    setPrinterError(null)
    setPrinterMessage(null)
    try {
      await savePrinterSettings(db, printer)
      setPrinterMessage('Printer settings saved on this terminal')
    } catch (error) {
      setPrinterError(error instanceof Error ? error.message : 'Could not save the settings')
    } finally {
      setPrinterBusy(false)
    }
  }

  async function testPrint(): Promise<void> {
    if (!printer) return
    const problem = printerSettingsProblem(printer)
    if (problem) {
      setPrinterError(problem)
      return
    }
    setPrinterBusy(true)
    setPrinterError(null)
    setPrinterMessage(null)
    const outcome = await desktopPrinterTransport.test(toPrinterTarget(printer), printer.encoding)
    setPrinterMessage(
      outcome.ok
        ? 'Test print sent. Check the printer (or this terminal’s receipts folder for the file adapter).'
        : outcome.message,
    )
    setPrinterBusy(false)
  }

  async function refreshPrinters(): Promise<void> {
    setPrinterBusy(true)
    setPrinters(await desktopPrinterTransport.list())
    setPrinterBusy(false)
  }

  const printerProblem = printer ? printerSettingsProblem(printer) : null

  function lock() {
    if (shift) return
    endStaffSession()
    navigate('login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={lock}
        lockNote={shift ? 'Close the shift before locking' : 'Sign out of this terminal'}
      />

      <main className="mx-auto max-w-4xl p-6">
        <ScreenHeader
          title="Terminal settings"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('pos/sales')}
                className="h-11"
                data-testid="open-sales"
              >
                Today's sales
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('pos/sync')}
                className="h-11"
                data-testid="open-sync"
              >
                Sync status
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('pos')}
                className="h-11"
                data-testid="back-to-selling"
              >
                Back to selling
              </Button>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Terminal">
            <Row label="Branch" value={`${identity.branchName} (${identity.branchCode})`} />
            <Row label="Terminal" value={identity.terminalCode} />
            <Row label="Device" value={identity.deviceId.slice(0, 8)} />
            <Row label="Tax mode" value={config.taxMode} />
            <Row label="Server time zone" value={config.serverTimeZone} />
            <Row label="App version" value={posRuntimeConfig.appVersion} />
          </Section>

          <Section title="Selling policy">
            <Row
              label="Cashier discount cap"
              value={`${config.pos.maxCashierDiscountPercent}% of gross`}
            />
            <Row
              label="Manager discount cap"
              value={`${config.pos.maxManagerDiscountPercent}% of gross`}
            />
            <Row
              label="Open shift required"
              value={config.pos.salesRequireOpenShift ? 'yes' : 'no'}
            />
            <Row
              label="Clock skew tolerance"
              value={`${config.pos.clockSkewToleranceMinutes} min`}
            />
          </Section>

          <Section title="Loyalty">
            <Row
              label="Points earned"
              value={`${config.loyalty.earnPointsPerCedi} per GHS 1 base`}
            />
            <Row label="Points per GHS 1" value={String(config.loyalty.pointsPerCedi)} />
            <Row
              label="Minimum redemption"
              value={`${config.loyalty.minimumRedeemPoints} points`}
            />
            <Row label="Lot expiry" value={`${config.loyalty.expiryMonths} months`} />
          </Section>

          <Section title="PIN and receipt">
            <Row label="PIN attempts" value={String(config.pos.pinMaxAttempts)} />
            <Row label="Lockout" value={`${config.pos.pinLockMinutes} min`} />
            <Row label="Receipt header" value={config.receiptHeader || '—'} />
            <Row label="Receipt footer" value={config.pos.receiptFooter || '—'} />
          </Section>

          <Section title="Receipt printer (this terminal)">
            {!printer ? (
              <div className="grid gap-2">
                <span className="sr-only">Loading printer settings…</span>
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : (
              <div className="grid gap-3 text-sm">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Driver</span>
                  <select
                    className="h-11 rounded-md border border-border bg-background px-2"
                    value={printer.driver}
                    onChange={(event) =>
                      updatePrinter({ driver: event.target.value as PrinterSettings['driver'] })
                    }
                    data-testid="printer-driver"
                  >
                    <option value="fake">File output (fake, for testing)</option>
                    <option value="winspool" disabled={platform !== null && platform !== 'win32'}>
                      Windows printer queue
                    </option>
                    <option value="network">Network printer (TCP 9100)</option>
                  </select>
                </label>

                {printer.driver === 'winspool' ? (
                  <label className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Printer name</span>
                    <input
                      className="h-11 rounded-md border border-border bg-background px-2 font-mono text-xs"
                      value={printer.printerName}
                      onChange={(event) => updatePrinter({ printerName: event.target.value })}
                      list="printer-names"
                      placeholder="e.g. EPSON TM-T20III"
                      data-testid="printer-name"
                    />
                    <datalist id="printer-names">
                      {printers.map((item) => (
                        <option key={item.name} value={item.name} />
                      ))}
                    </datalist>
                  </label>
                ) : null}

                {printer.driver === 'network' ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
                    <label className="grid gap-1">
                      <span className="text-xs text-muted-foreground">Host</span>
                      <input
                        className="h-11 rounded-md border border-border bg-background px-2 font-mono text-xs"
                        value={printer.printerHost}
                        onChange={(event) => updatePrinter({ printerHost: event.target.value })}
                        placeholder="192.168.1.50"
                        data-testid="printer-host"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs text-muted-foreground">Port</span>
                      <input
                        className="h-11 rounded-md border border-border bg-background px-2 font-mono text-xs"
                        type="number"
                        min={1}
                        max={65535}
                        value={printer.printerPort}
                        onChange={(event) =>
                          updatePrinter({ printerPort: Number(event.target.value) })
                        }
                        data-testid="printer-port"
                      />
                    </label>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Drawer pin</span>
                    <select
                      className="h-11 rounded-md border border-border bg-background px-2"
                      value={printer.drawerPin}
                      onChange={(event) =>
                        updatePrinter({
                          drawerPin: Number(event.target.value) === 5 ? 5 : 2,
                        })
                      }
                      data-testid="drawer-pin"
                    >
                      <option value={2}>Pin 2 (most common)</option>
                      <option value={5}>Pin 5</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Copies</span>
                    <input
                      className="h-11 rounded-md border border-border bg-background px-2"
                      type="number"
                      min={1}
                      max={3}
                      value={printer.copies}
                      onChange={(event) => updatePrinter({ copies: Number(event.target.value) })}
                      data-testid="printer-copies"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Character set</span>
                    <select
                      className="h-11 rounded-md border border-border bg-background px-2 font-mono text-xs"
                      value={printer.encoding}
                      onChange={(event) =>
                        updatePrinter({
                          encoding: event.target.value as PrinterSettings['encoding'],
                        })
                      }
                      data-testid="printer-encoding"
                    >
                      {PRINT_ENCODINGS.map((encoding) => (
                        <option key={encoding} value={encoding}>
                          {encoding}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Cedi symbol</span>
                    <select
                      className="h-11 rounded-md border border-border bg-background px-2"
                      value={printer.currencySymbol}
                      onChange={(event) =>
                        updatePrinter({
                          currencySymbol: event.target.value as PrinterSettings['currencySymbol'],
                        })
                      }
                      data-testid="currency-symbol"
                    >
                      {CURRENCY_SYMBOLS.map((symbol) => (
                        <option key={symbol} value={symbol}>
                          {symbol}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {printerProblem ? <p className="text-xs text-amber-800">{printerProblem}</p> : null}
                {printerError ? <p className="text-xs text-destructive">{printerError}</p> : null}
                {printerMessage ? (
                  <output className="text-xs text-emerald-800" data-testid="printer-message">
                    {printerMessage}
                  </output>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => void savePrinter()}
                    disabled={printerBusy || Boolean(printerProblem)}
                    className="h-11 text-xs"
                    data-testid="save-printer"
                  >
                    Save printer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void testPrint()}
                    disabled={printerBusy || Boolean(printerProblem)}
                    className="h-11 text-xs"
                    data-testid="test-print"
                  >
                    Test print
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refreshPrinters()}
                  disabled={printerBusy}
                  className="h-11 text-xs"
                  data-testid="list-printers"
                >
                  Find printers
                </Button>

                <p className="text-[11px] text-muted-foreground">
                  Cash sales append a drawer kick to the receipt. A failed print never voids the
                  sale; retry from the receipt screen. Hardware names are stored only on this
                  device.
                </p>
              </div>
            )}
          </Section>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          These values come from the last device session and update on the next sync. Change them in
          the back office.
        </p>
      </main>
    </div>
  )
}
