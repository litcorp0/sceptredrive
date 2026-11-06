import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { type PickedSourceProduct, SourceProductPicker } from "./source-product-picker"

export interface TransferLineDraft {
	key: string
	product: PickedSourceProduct | null
	quantity: string
}

export function newTransferLine(): TransferLineDraft {
	return { key: crypto.randomUUID(), product: null, quantity: "" }
}

export function TransferLinesEditor({
	rows,
	onChange,
	disabled,
	sourceBranchId,
}: {
	rows: TransferLineDraft[]
	onChange: (rows: TransferLineDraft[]) => void
	disabled?: boolean
	/**
	 * The branch the stock is coming from. When set, each picker asks that branch what it
	 * holds and each quantity says how far it may go (P20-D18).
	 */
	sourceBranchId?: string
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
					<SourceProductPicker
						value={row.product}
						onSelect={(product) => update(row.key, { product, quantity: "" })}
						disabled={disabled}
						branchId={sourceBranchId}
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
							aria-describedby={row.product?.available != null ? `available-${row.key}` : undefined}
							aria-invalid={
								row.product?.available != null &&
								Number.parseInt(row.quantity, 10) > row.product.available
									? true
									: undefined
							}
						/>
						{row.product?.available != null ? (
							<p
								id={`available-${row.key}`}
								className={
									Number.parseInt(row.quantity, 10) > (row.product.available ?? 0)
										? "text-[11px] text-destructive"
										: "text-[11px] text-muted-foreground"
								}
							>
								{row.product.available} at the source
							</p>
						) : null}
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
