import type { CartTotals } from '../../lib/cart/totals'
import { formatGhs } from '../../lib/format'

/**
 * The totals panel. Every number is a field of the priced cart — this component
 * only formats. If a value looks wrong, the bug is in `priceCart` or in how the
 * cart was built, never here (D14).
 */
function Row({
  label,
  value,
  muted = false,
  negative = false,
  testId,
}: {
  label: string
  value: number
  muted?: boolean
  negative?: boolean
  testId?: string
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 text-sm ${muted ? 'text-muted-foreground' : ''}`}
    >
      <span>{label}</span>
      <span className="font-mono" data-testid={testId}>
        {negative && value > 0 ? '−' : ''}
        {formatGhs(value)}
      </span>
    </div>
  )
}

export function CartTotalsPanel({ totals }: { totals: CartTotals }) {
  const { priced } = totals

  return (
    <section aria-label="Sale totals" className="grid gap-1.5" data-testid="cart-totals">
      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>Items</span>
        <span className="font-mono" data-testid="totals-item-count">
          {totals.itemCount}
        </span>
      </div>

      <div className="mt-2 border-t border-border pt-2" />
      <Row label="Gross" value={priced.subtotalMinor} testId="totals-gross" />
      <Row
        label="Line discounts"
        value={priced.lineDiscountMinor}
        negative
        muted={priced.lineDiscountMinor === 0}
        testId="totals-line-discount"
      />
      <Row
        label="Sale discount"
        value={priced.saleDiscountMinor}
        negative
        muted={priced.saleDiscountMinor === 0}
        testId="totals-sale-discount"
      />
      <Row
        label="Loyalty redemption (pre-tax)"
        value={priced.loyaltyDiscountMinor}
        negative
        muted={priced.loyaltyDiscountMinor === 0}
        testId="totals-loyalty"
      />
      <Row label="Taxable base" value={priced.baseMinor} muted testId="totals-base" />
      <Row label="VAT" value={priced.vatMinor} muted testId="totals-vat" />
      <Row label="NHIL" value={priced.nhilMinor} muted testId="totals-nhil" />
      <Row label="GETFund" value={priced.getfundMinor} muted testId="totals-getfund" />

      <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm font-semibold">Total</span>
        <span className="font-display text-xl font-bold tabular-nums" data-testid="totals-total">
          {formatGhs(priced.totalMinor)}
        </span>
      </div>
    </section>
  )
}
