import { formatAccraDateTime } from '@sceptre/shared'
import { formatMinorWithSymbol } from '../../lib/format'
import type { ReceiptModel } from '../../lib/receipt/render'

/**
 * The on-screen receipt (Plan 07 Task 2).
 *
 * Rendered from the **same model** as the ESC/POS text, so what a cashier sees
 * in a reprint preview is what the paper says. 80 mm wide, monospace, with the
 * tax components broken out exactly as the server stores them.
 */

const money = (minor: number) => formatMinorWithSymbol(minor, 'GH₵')

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        bold ? 'text-sm font-semibold' : 'text-xs'
      }`}
    >
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )
}

export function ReceiptView({ model }: { model: ReceiptModel }) {
  const { header, totals, tender, loyalty } = model

  return (
    <article
      className="mx-auto w-[80mm] max-w-full rounded border border-border bg-white px-4 py-4 font-mono text-[12px] leading-relaxed text-black shadow-sm"
      data-testid="receipt-view"
      aria-label={`Receipt ${header.receiptNumber}`}
    >
      {header.reprint ? (
        <p
          className="mb-2 border border-black py-0.5 text-center text-[11px] font-bold tracking-widest"
          data-testid="receipt-reprint"
        >
          *** REPRINT ***
        </p>
      ) : null}

      <header className="text-center">
        <p className="text-sm font-bold uppercase">{header.seller}</p>
        <p>{header.branch}</p>
        <p className="text-[11px] text-muted-foreground">
          {header.branchCode} · {header.terminal}
        </p>
        <p className="mt-2 border-y border-dashed border-neutral-400 py-1 text-[11px] font-semibold">
          RECEIPT {header.receiptNumber}
        </p>
      </header>

      <div className="mt-1 grid gap-0.5 text-[11px]">
        <Row label="Date" value={formatAccraDateTime(header.occurredAt)} />
        <Row label="Cashier" value={header.cashier} />
        {header.customer?.name ? <Row label="Customer" value={header.customer.name} /> : null}
        {header.customer?.phone ? <Row label="Phone" value={header.customer.phone} /> : null}
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div className="grid gap-1">
        {model.lines.map((line) => (
          <div key={line.lineNumber}>
            <p className="text-[12px]">{line.name}</p>
            <Row
              label={`  ${line.quantity} × ${money(line.unitPriceMinor)}`}
              value={money(line.unitPriceMinor * line.quantity)}
            />
            {line.lineDiscountMinor > 0 ? (
              <Row label="  Line discount" value={`-${money(line.lineDiscountMinor)}`} />
            ) : null}
            {line.saleDiscountMinor > 0 ? (
              <Row label="  Sale discount" value={`-${money(line.saleDiscountMinor)}`} />
            ) : null}
            {line.loyaltyDiscountMinor > 0 ? (
              <Row label="  Loyalty" value={`-${money(line.loyaltyDiscountMinor)}`} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div className="grid gap-0.5">
        <Row label="Subtotal" value={money(totals.subtotalMinor)} />
        {totals.lineDiscountMinor > 0 ? (
          <Row label="Line discounts" value={`-${money(totals.lineDiscountMinor)}`} />
        ) : null}
        {totals.saleDiscountMinor > 0 ? (
          <Row label="Sale discount" value={`-${money(totals.saleDiscountMinor)}`} />
        ) : null}
        {totals.loyaltyDiscountMinor > 0 ? (
          <Row
            label={loyalty ? `Loyalty (${loyalty.redeemedPoints} pts)` : 'Loyalty'}
            value={`-${money(totals.loyaltyDiscountMinor)}`}
          />
        ) : null}
        <Row label="Taxable base" value={money(totals.taxableMinor)} />
        {totals.vatMinor !== 0 ? <Row label="VAT 15%" value={money(totals.vatMinor)} /> : null}
        {totals.nhilMinor !== 0 ? <Row label="NHIL 2.5%" value={money(totals.nhilMinor)} /> : null}
        {totals.getfundMinor !== 0 ? (
          <Row label="GETFund 2.5%" value={money(totals.getfundMinor)} />
        ) : null}
        <div className="my-1 border-t border-neutral-400" />
        <Row label="TOTAL" value={money(totals.totalMinor)} bold />
      </div>

      <div className="my-2 border-t border-dashed border-neutral-400" />

      <div className="grid gap-0.5">
        {tender.method === 'NONE' ? (
          <Row label="Payment" value="No payment due" />
        ) : tender.method === 'CASH' ? (
          <>
            <Row label="Cash" value={money(tender.amountMinor)} />
            <Row label="Change" value={money(tender.changeMinor)} />
          </>
        ) : (
          <Row label="Credit" value={money(tender.amountMinor)} />
        )}

        {loyalty && loyalty.earnedPoints > 0 ? (
          <Row label="Points earned" value={String(loyalty.earnedPoints)} />
        ) : null}
        {loyalty && loyalty.redeemedPoints > 0 ? (
          <Row label="Points redeemed" value={String(loyalty.redeemedPoints)} />
        ) : null}
      </div>

      {model.footer.trim() ? (
        <>
          <div className="my-2 border-t border-dashed border-neutral-400" />
          <p className="text-center text-[11px] whitespace-pre-wrap">{model.footer}</p>
        </>
      ) : null}
    </article>
  )
}
