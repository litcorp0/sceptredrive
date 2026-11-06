import type { PricedLine } from '@sceptre/shared'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CartLine as CartLineModel } from '@/lib/cart/types'
import { canIncreaseQuantity } from '@/lib/catalog/pricing'
import { formatGhs } from '@/lib/format'

/**
 * One cart line.
 *
 * Money comes from the priced line (the shared engine), never from the raw
 * cart row. Quantity is committed on blur/Enter so typing "12" does not
 * dispatch "1" and then "12".
 *
 * Every action is a 44 × 44 target (D8). The row stays dense by keeping the
 * buttons visually the same size and padding the hit area, so a touch till and
 * a keyboard can both drive it without the line growing past a thumb.
 */
export function CartLineRow({
  line,
  priced,
  selected,
  available,
  onSelect,
  onQuantity,
  onRemove,
  onDiscount,
}: {
  line: CartLineModel
  priced: PricedLine
  selected: boolean
  /**
   * What this branch can sell of this product (on hand + unacked deltas), or
   * `null` when it is not known. The `+` control stops here; it never lowers a
   * quantity the cashier already set (P20-D9).
   */
  available: number | null
  onSelect: () => void
  onQuantity: (quantity: number) => void
  onRemove: () => void
  onDiscount: () => void
}) {
  const [draft, setDraft] = useState(String(line.quantity))
  const canIncrease = canIncreaseQuantity(line.quantity, available)
  const atStockLimit = !canIncrease

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
        selected
          ? 'border-foreground/60 bg-muted ring-1 ring-foreground/10'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" data-testid="cart-line-name">
            {line.name || line.sku}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{line.sku}</span>
            <Badge variant="secondary" className="px-1.5 text-[10px]">
              {line.taxCategory === 'STANDARD'
                ? 'VAT'
                : line.taxCategory === 'ZERO_RATED'
                  ? 'Zero-rated'
                  : 'Exempt'}
            </Badge>
            <span className="font-mono tabular-nums">{formatGhs(line.unitPriceMinor)} ea</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold tabular-nums" data-testid="cart-line-total">
            {formatGhs(priced.totalMinor)}
          </p>
          {line.lineDiscountMinor > 0 ? (
            <p className="font-mono text-[11px] text-ok tabular-nums">
              −{formatGhs(line.lineDiscountMinor)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            aria-label="Decrease quantity"
            title="Decrease quantity (keyboard −)"
            onClick={() => onQuantity(line.quantity - 1)}
            className="h-11 min-w-11 text-lg leading-none"
          >
            −
          </Button>
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
            className="h-11 w-12 rounded-md border border-border bg-background text-center font-mono text-sm tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            aria-label="Increase quantity"
            title={
              atStockLimit && available !== null
                ? `Only ${available} in stock`
                : 'Increase quantity (keyboard +)'
            }
            onClick={() => onQuantity(line.quantity + 1)}
            disabled={atStockLimit}
            data-testid="cart-line-inc"
            className="h-11 min-w-11 text-lg leading-none"
          >
            +
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDiscount}
            title="Discount this line"
            className="h-11 min-w-11 px-3 text-xs"
          >
            Discount
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            className="h-11 min-w-11 px-3 text-xs text-destructive"
            aria-label={`Remove ${line.name}`}
          >
            Remove
          </Button>
        </div>
      </div>

      {atStockLimit && available !== null ? (
        <output className="mt-1 block text-[11px] text-warn" data-testid="cart-line-at-stock-limit">
          All {available} in stock are in the cart. Type a higher quantity to oversell.
        </output>
      ) : null}

      {line.discountReasonCode ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Line discount: {line.discountReasonCode}
          {line.discountNote ? ` — ${line.discountNote}` : ''}
        </p>
      ) : null}
    </li>
  )
}
