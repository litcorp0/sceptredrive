import { useEffect, useState } from 'react'
import type { PrintOutcome } from '../../../shared/printing'
import { desktopApi } from '../../lib/desktop-api'
import { formatGhs } from '../../lib/format'
import { desktopPrinterTransport } from '../../lib/printing/printer-service'
import { type ReceiptModel, toEscPosLines } from '../../lib/receipt/render'

/**
 * Printer diagnostics (Plan 07 Task 5).
 *
 * The hardware-neutral verification hook: renders a complete sample receipt
 * through the same model and ESC/POS renderer a real sale uses, then sends it
 * to the file-output adapter. CI asserts the files; a human can compare them
 * against the Windows checklist in the phase evidence.
 */

const NOW = '2026-10-23T10:15:00.000Z'

function sampleModel(reprint: boolean): ReceiptModel {
  return {
    header: {
      seller: 'GikAutos',
      branch: 'Accra - Spintex',
      branchCode: 'ACC-SPX',
      terminal: 'ACC-SPX-T01',
      receiptNumber: 'DEV-20261023-0001',
      occurredAt: NOW,
      cashier: 'Ama Mensah',
      customer: { name: 'Kwame Boateng', phone: '+233 20 123 4567' },
      reprint,
    },
    lines: [
      {
        lineNumber: 1,
        name: 'Brake Pad Set — Front Axle, Ceramic Compound (Long Name Wrap Check)',
        quantity: 1,
        unitPriceMinor: 12_000,
        lineDiscountMinor: 0,
        saleDiscountMinor: 0,
        loyaltyDiscountMinor: 0,
        baseMinor: 10_000,
        taxMinor: 2_000,
        totalMinor: 12_000,
        taxCategory: 'STANDARD',
      },
      {
        lineNumber: 2,
        name: 'Oil Filter',
        quantity: 1,
        unitPriceMinor: 2_500,
        lineDiscountMinor: 0,
        saleDiscountMinor: 0,
        loyaltyDiscountMinor: 0,
        baseMinor: 2_500,
        taxMinor: 0,
        totalMinor: 2_500,
        taxCategory: 'ZERO_RATED',
      },
    ],
    totals: {
      subtotalMinor: 14_500,
      lineDiscountMinor: 0,
      saleDiscountMinor: 0,
      loyaltyDiscountMinor: 0,
      taxableMinor: 12_500,
      vatMinor: 1_500,
      nhilMinor: 250,
      getfundMinor: 250,
      taxTotalMinor: 2_000,
      totalMinor: 14_500,
    },
    tender: { method: 'CASH', amountMinor: 20_000, changeMinor: 5_500 },
    loyalty: { earnedPoints: 125, redeemedPoints: 0 },
    footer: 'Thank you for choosing GikAutos. Goods sold are not returnable after 7 days.',
    evatSerial: null,
    qrPayload: null,
    signature: null,
  }
}

export function DevPrintRoute() {
  const [reprint, setReprint] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<string[]>(() =>
    toEscPosLines(sampleModel(false)).map((line) => line.text),
  )

  useEffect(() => {
    let cancelled = false
    void desktopApi
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setEnabled(info.diagnosticsEnabled)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function print(openDrawer: boolean): Promise<void> {
    setBusy(true)
    const model = sampleModel(reprint)
    const lines = toEscPosLines(model, { columns: 42, currencySymbol: 'GHS' })
    setPreview(lines.map((line) => line.text))
    const result = await desktopPrinterTransport.print(
      { driver: 'fake' },
      {
        receiptNumber: model.header.receiptNumber,
        lines,
        encoding: 'windows-1252',
        copies: 1,
        openDrawer,
        drawerPin: 2,
      },
    )
    setOutcome(result)
    setBusy(false)
  }

  if (enabled === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">Checking diagnostics access…</p>
      </main>
    )
  }

  if (!enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="max-w-md rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Printer diagnostics are disabled on this terminal. Start the app with
          <code className="mx-1 font-mono">POS_DIAGNOSTICS=1</code> to enable the sample print.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-lg font-semibold">Printer diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prints the sample receipt through the fake ESC/POS adapter. Used by the phase verification
          script; never blocks a sale.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reprint}
              onChange={(event) => setReprint(event.target.checked)}
              data-testid="dev-print-reprint-toggle"
            />
            Reprint marker
          </label>
          <button
            type="button"
            onClick={() => void print(true)}
            disabled={busy}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            data-testid="dev-print"
          >
            {busy ? 'Printing…' : 'Print sample + drawer'}
          </button>
          <button
            type="button"
            onClick={() => void print(false)}
            disabled={busy}
            className="h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
            data-testid="dev-print-plain"
          >
            Print sample only
          </button>
          <button
            type="button"
            onClick={() => void desktopPrinterTransport.openDrawer({ driver: 'fake' }, 2)}
            disabled={busy}
            className="h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
            data-testid="dev-drawer"
          >
            Open drawer
          </button>
        </div>

        {outcome ? (
          <output
            className="mt-3 block rounded-md border border-border bg-card px-3 py-2 text-sm"
            data-testid="dev-print-status"
            data-ok={outcome.ok ? 'true' : 'false'}
          >
            {outcome.ok ? `Sent ${outcome.bytes} bytes` : `${outcome.code}: ${outcome.message}`}
          </output>
        ) : null}

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold">ESC/POS text (42 columns)</h2>
            <pre
              className="overflow-x-auto rounded border border-border bg-white p-3 font-mono text-[11px] text-black"
              data-testid="dev-print-preview"
            >
              {preview.join('\n')}
            </pre>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Totals (screen formatting)</h2>
            <ul className="grid gap-1 text-sm">
              <li>Total: {formatGhs(sampleModel(reprint).totals.totalMinor)}</li>
              <li>VAT: {formatGhs(sampleModel(reprint).totals.vatMinor)}</li>
              <li>NHIL: {formatGhs(sampleModel(reprint).totals.nhilMinor)}</li>
              <li>GETFund: {formatGhs(sampleModel(reprint).totals.getfundMinor)}</li>
              <li>Change: {formatGhs(sampleModel(reprint).tender.changeMinor)}</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  )
}
