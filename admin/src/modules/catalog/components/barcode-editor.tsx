import { XIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"

const BARCODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/

export interface BarcodeItem {
	id: string | null
	code: string
}

export function BarcodeEditor({
	items,
	onAdd,
	onRemove,
	disabled = false,
	pending = false,
}: {
	items: BarcodeItem[]
	onAdd: (code: string) => void
	onRemove: (item: BarcodeItem) => void
	disabled?: boolean
	pending?: boolean
}) {
	const [input, setInput] = useState("")
	const [error, setError] = useState<string | null>(null)

	function handleAdd() {
		const code = input.trim()
		if (!BARCODE_PATTERN.test(code)) {
			setError("Use 6–64 letters, digits, or dashes (e.g. an EAN or supplier code).")
			return
		}
		if (items.some((item) => item.code === code)) {
			setError("That barcode is already on this product.")
			return
		}
		setError(null)
		setInput("")
		onAdd(code)
	}

	return (
		<div className="grid gap-2">
			<Label htmlFor="barcode-input">Barcodes</Label>
			{items.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{items.map((item) => (
						<span
							key={item.id ?? item.code}
							className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs"
						>
							{item.code}
							{!disabled ? (
								<button
									type="button"
									aria-label={`Remove barcode ${item.code}`}
									className="rounded-sm text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
									onClick={() => onRemove(item)}
								>
									<XIcon className="size-3.5" />
								</button>
							) : null}
						</span>
					))}
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					No barcodes yet. Scanners accept any unique code, EAN or supplier style. A new product
					saved without one is given an internal SD-code automatically.
				</p>
			)}

			{!disabled ? (
				<div className="flex items-start gap-2">
					<Input
						id="barcode-input"
						className="font-mono"
						placeholder="5901234123457"
						value={input}
						disabled={pending}
						onChange={(event) => {
							setInput(event.target.value)
							setError(null)
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault()
								handleAdd()
							}
						}}
					/>
					<Button
						type="button"
						variant="outline"
						disabled={pending || input.trim().length === 0}
						onClick={handleAdd}
					>
						{pending ? "Adding…" : "Add"}
					</Button>
				</div>
			) : null}

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	)
}
