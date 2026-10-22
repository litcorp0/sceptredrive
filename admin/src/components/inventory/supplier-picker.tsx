import { useState } from "react"
import { type PickedSupplier, SupplierCombobox } from "#/components/suppliers/supplier-combobox"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"

/**
 * Supplier choice for goods receipts: pick an active supplier from the master
 * list, or fall back to a free-text name when the supplier is not registered
 * yet. Linking the master record lets the receipt carry a payable invoice.
 */
export function SupplierPicker({
	supplier,
	freeText,
	onSupplierChange,
	onFreeTextChange,
	canSearch,
	disabled,
}: {
	supplier: PickedSupplier | null
	freeText: string
	onSupplierChange: (supplier: PickedSupplier | null) => void
	onFreeTextChange: (text: string) => void
	/** `supplier.read` holders can search the directory. */
	canSearch: boolean
	disabled?: boolean
}) {
	const [freeMode, setFreeMode] = useState(() => freeText.trim() !== "" && supplier === null)
	const useFreeText = !canSearch || freeMode

	if (useFreeText) {
		return (
			<div className="grid gap-1.5">
				<Input
					value={freeText}
					maxLength={120}
					placeholder="Type the supplier's name"
					disabled={disabled}
					onChange={(event) => onFreeTextChange(event.target.value)}
					aria-label="Supplier name"
				/>
				{canSearch ? (
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto justify-start px-0 text-muted-foreground"
						onClick={() => {
							setFreeMode(false)
							onFreeTextChange("")
						}}
					>
						Search the supplier list instead
					</Button>
				) : (
					<p className="text-xs text-muted-foreground">
						Free-text name; a payable invoice needs a registered supplier.
					</p>
				)}
			</div>
		)
	}

	return (
		<div className="grid gap-1.5">
			<SupplierCombobox
				value={supplier}
				onSelect={onSupplierChange}
				disabled={disabled}
				placeholder="Search active suppliers…"
			/>
			<Button
				type="button"
				variant="link"
				size="sm"
				className="h-auto justify-start px-0 text-muted-foreground"
				onClick={() => {
					setFreeMode(true)
					onSupplierChange(null)
				}}
			>
				Not listed — type a name
			</Button>
		</div>
	)
}
