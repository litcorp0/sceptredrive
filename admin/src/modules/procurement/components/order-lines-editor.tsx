import { PlusIcon, Trash2Icon } from "lucide-react"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import type { OrderLineInput } from "../types"

export interface OrderLineDraft {
	key: string
	product: PickedProduct | null
	quantity: string
	unitCost: string
}

export function newOrderLine(): OrderLineDraft {
	return { key: crypto.randomUUID(), product: null, quantity: "1", unitCost: "" }
}

/** Whole-pesewa line total, or 0 while the row is incomplete. */
export function orderLineDraftTotal(line: OrderLineDraft): number {
	const quantity = Number.parseInt(line.quantity, 10)
	const unitCost = parseGhsToMinor(line.unitCost)
	if (!Number.isInteger(quantity) || quantity < 1 || unitCost === null) return 0
	return quantity * unitCost
}

/** A draft figure for the screen only; the API recomputes the goods value on save. */
export function orderDraftGoodsValueMinor(lines: OrderLineDraft[]): number {
	return lines.reduce((sum, line) => sum + orderLineDraftTotal(line), 0)
}

export function validateOrderLineDraft(line: OrderLineDraft): string | null {
	if (!line.product) return "Choose a product."
	const quantity = Number.parseInt(line.quantity, 10)
	if (!Number.isInteger(quantity) || quantity < 1) {
		return "Quantity must be a whole number of at least 1."
	}
	if (parseGhsToMinor(line.unitCost) === null) return "Enter a unit cost like 12.50."
	return null
}

export function toOrderLineInputs(lines: OrderLineDraft[]): OrderLineInput[] {
	return lines.map((line) => ({
		productId: line.product?.id ?? "",
		quantity: Number.parseInt(line.quantity, 10),
		unitCostMinor: parseGhsToMinor(line.unitCost) ?? 0,
	}))
}

/**
 * Product, quantity and the agreed unit cost, one row per order line.
 *
 * Selecting a product prefills the catalogue cost (which follows the latest goods receipt,
 * P11-D13) only while the cost is empty, so a figure the manager typed is never overwritten.
 */
export function OrderLinesEditor({
	rows,
	onChange,
	disabled,
}: {
	rows: OrderLineDraft[]
	onChange: (rows: OrderLineDraft[]) => void
	disabled?: boolean
}) {
	function update(key: string, patch: Partial<OrderLineDraft>) {
		onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
	}

	return (
		<div className="grid gap-2">
			{rows.map((row, index) => (
				<div
					key={row.key}
					className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_90px_130px_110px_auto]"
				>
					<ProductPicker
						value={row.product}
						onSelect={(product) =>
							update(row.key, {
								product,
								...(product && row.unitCost.trim() === ""
									? { unitCost: formatMinorPlain(product.costPriceMinor) }
									: {}),
							})
						}
						disabled={disabled}
					/>
					<div className="grid gap-1">
						<Label className="text-xs" htmlFor={`order-qty-${row.key}`}>
							Quantity
						</Label>
						<Input
							id={`order-qty-${row.key}`}
							inputMode="numeric"
							value={row.quantity}
							disabled={disabled}
							onChange={(event) => update(row.key, { quantity: event.target.value })}
							aria-label={`Quantity for line ${index + 1}`}
						/>
					</div>
					<div className="grid gap-1">
						<Label className="text-xs" htmlFor={`order-cost-${row.key}`}>
							Unit cost (GHS)
						</Label>
						<Input
							id={`order-cost-${row.key}`}
							inputMode="decimal"
							value={row.unitCost}
							disabled={disabled}
							onChange={(event) => update(row.key, { unitCost: event.target.value })}
							aria-label={`Unit cost for line ${index + 1}`}
						/>
					</div>
					<div className="grid gap-1">
						<span className="text-xs text-muted-foreground">Line total</span>
						<span className="py-2 text-sm tabular-nums">
							{formatGhs(orderLineDraftTotal(row))}
						</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="mt-5"
						aria-label={`Remove line ${index + 1}`}
						disabled={rows.length === 1 || disabled}
						onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
					>
						<Trash2Icon className="size-4" aria-hidden="true" />
					</Button>
				</div>
			))}

			<div className="flex flex-wrap items-center justify-between gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => onChange([...rows, newOrderLine()])}
				>
					<PlusIcon className="size-4" aria-hidden="true" />
					Add line
				</Button>
				<p className="text-sm text-muted-foreground">
					Draft goods value (ex-tax):{" "}
					<span className="font-medium text-foreground">
						{formatGhs(orderDraftGoodsValueMinor(rows))}
					</span>
				</p>
			</div>
		</div>
	)
}
