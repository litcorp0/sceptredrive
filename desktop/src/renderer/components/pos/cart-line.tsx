import type { PricedLine } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import type { CartLine as CartLineModel } from '../../lib/cart/types'
import { formatGhs } from '../../lib/format'

/**
 * One cart line.
 *
 * Money comes from the priced line (the shared engine), never from the raw
 * cart row. Quantity is committed on blur/Enter so typing "12" does not
 * dispatch "1" and then "12".
 */
export function CartLineRow({
  line,
  priced,
  selected,
  onSelect,
  onQuantity,
  onRemove,
  onDiscount,
}: {
  line: CartLineModel
  priced: PricedLine
  selected: boolean
  onSelect: () => void
  onQuantity: (quantity: number) => void
  onRemove: () => void
  onDiscount: () => void
}) {
  const [draft, setDraft] = useState(String(line.quantity))

  useEffect(() => {
    setDraft(String(line.quantity))
  }, [line.quantity])

  function commit(value: string) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      setDraft(String(line.quantity))
      return
    }
    onQuantity(parsed)
  }

  return (
    <li
      data-testid="cart-line"
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      onPointerDown={onSelect}
      className={`group rounded-lg border px-3 py-2.5 transition-colors ${
        selected ? 'border-foreground/40 bg-muted/60' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" data-testid="cart-line-name">
            {line.name || line.sku}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{line.sku}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {line.taxCategory === 'STANDARD'
                ? 'VAT'
                : line.taxCategory === 'ZERO_RATED'
                  ? 'Zero-rated'
                  : 'Exempt'}
            </span>
            <span className="font-mono">{formatGhs(line.unitPriceMinor)} ea</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold" data-testid="cart-line-total">
            {formatGhs(priced.totalMinor)}
          </p>
          {line.lineDiscountMinor > 0 ? (
            <p className="font-mono text-[11px] text-emerald-700">
              −{formatGhs(line.lineDiscountMinor)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => onQuantity(line.quantity - 1)}
            className="h-9 w-9 rounded-md border border-border text-lg leading-none hover:bg-muted"
          >
            −
          </button>
          <input
            aria-label={`Quantity for ${line.name}`}
            data-testid="cart-line-qty"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit((event.target as HTMLInputElement).value)
                event.currentTarget.blur()
              }
            }}
            className="h-9 w-12 rounded-md border border-border bg-background text-center font-mono text-sm"
          />
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => onQuantity(line.quantity + 1)}
            className="h-9 w-9 rounded-md border border-border text-lg leading-none hover:bg-muted"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDiscount}
            className="h-9 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
          >
            Discount
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="h-9 rounded-md border border-border px-2.5 text-xs font-medium text-destructive hover:bg-destructive/5"
            aria-label={`Remove ${line.name}`}
          >
            Remove
          </button>
        </div>
      </div>

      {line.discountReasonCode ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Line discount: {line.discountReasonCode}
          {line.discountNote ? ` — ${line.discountNote}` : ''}
        </p>
      ) : null}
    </li>
  )
}
