import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"

export interface TransferLineDraft {
	key: string
	product: PickedProduct | null
	quantity: string
}

export function newTransferLine(): TransferLineDraft {
	return { key: crypto.randomUUID(), product: null, quantity: "" }
}

export function TransferLinesEditor({
	rows,
	onChange,
	disabled,
}: {
	rows: TransferLineDraft[]
	onChange: (rows: TransferLineDraft[]) => void
	disabled?: boolean
}) {
	function update(key: string, patch: Partial<TransferLineDraft>) {
		onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
	}

	return (
		<div className="grid gap-2">
			{rows.map((row, index) => (
				<div
					key={row.key}
					className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[1fr_110px_auto]"
				>
					<ProductPicker
						value={row.product}
						onSelect={(product) => update(row.key, { product })}
						disabled={disabled}
					/>
					<div className="grid gap-1">
						<Label className="text-xs" htmlFor={`requested-${row.key}`}>
							Quantity
						</Label>
						<Input
							id={`requested-${row.key}`}
							inputMode="numeric"
							value={row.quantity}
							onChange={(event) => update(row.key, { quantity: event.target.value })}
							aria-label={`Requested quantity for line ${index + 1}`}
						/>
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

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={disabled}
				onClick={() => onChange([...rows, newTransferLine()])}
			>
				<PlusIcon className="size-4" aria-hidden="true" />
				Add line
			</Button>
		</div>
	)
}
