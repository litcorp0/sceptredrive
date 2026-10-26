import { PlusIcon, XIcon } from "lucide-react"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import type { InvoiceLineInput } from "../types"

export interface InvoiceLineDraft {
	key: string
	kind: "product" | "text"
	product: PickedProduct | null
	description: string
	quantity: string
	unitCost: string
}

export function createInvoiceLineDraft(kind: "product" | "text" = "product"): InvoiceLineDraft {
	return {
		key: crypto.randomUUID(),
		kind,
		product: null,
		description: "",
		quantity: "1",
		unitCost: "",
	}
}

/** Whole-pesewa line total, or 0 while the row is incomplete. */
export function invoiceLineDraftTotal(line: InvoiceLineDraft): number {
	const quantity = Number.parseInt(line.quantity, 10)
	const unitCost = parseGhsToMinor(line.unitCost)
	if (!Number.isInteger(quantity) || quantity < 1 || unitCost === null) return 0
	return quantity * unitCost
}

export function invoiceLineDraftsSum(lines: InvoiceLineDraft[]): number {
	return lines.reduce((sum, line) => sum + invoiceLineDraftTotal(line), 0)
}

/** The API accepts exactly one of productId or description per line. */
export function validateInvoiceLineDraft(line: InvoiceLineDraft): string | null {
	if (line.kind === "product" && !line.product) {
		return "Choose a product, or switch the line to free text."
	}
	if (line.kind === "text" && line.description.trim().length === 0) {
		return "Describe the free-text line."
	}
	const quantity = Number.parseInt(line.quantity, 10)
	if (!Number.isInteger(quantity) || quantity < 1) {
		return "Quantity must be a whole number of at least 1."
	}
	if (parseGhsToMinor(line.unitCost) === null) {
		return "Enter a unit cost like 12.50."
	}
	return null
}

export function toInvoiceLineInputs(lines: InvoiceLineDraft[]): InvoiceLineInput[] {
	return lines.map((line) => ({
		...(line.kind === "product" && line.product
			? { productId: line.product.id }
			: { description: line.description.trim() }),
		quantity: Number.parseInt(line.quantity, 10),
		unitCostMinor: parseGhsToMinor(line.unitCost) ?? 0,
	}))
}

export function InvoiceLinesEditor({
	lines,
	onChange,
	orderedCostHint,
}: {
	lines: InvoiceLineDraft[]
	onChange: (lines: InvoiceLineDraft[]) => void
	/**
	 * The selected purchase order's line for a product, when there is one.
	 *
	 * It is rendered as a hint beside the unit-cost input, never as its value: a prefilled price
	 * would hide the variance this screen exists to surface. When a hint exists the product picker
	 * also stops prefilling the catalogue cost, so the clerk types what the invoice says.
	 */
	orderedCostHint?: (productId: string) => { unitCostMinor: number; quantity: number } | null
}) {
	function updateLine(key: string, patch: Partial<InvoiceLineDraft>) {
		onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
	}

	function setKind(line: InvoiceLineDraft, kind: "product" | "text") {
		onChange(
			lines.map((row) =>
				row.key === line.key
					? { ...row, kind, product: kind === "text" ? null : row.product }
					: row,
			),
		)
	}

	function handleProduct(line: InvoiceLineDraft, product: PickedProduct | null) {
		const hint = product ? (orderedCostHint?.(product.id) ?? null) : null
		const shouldPrefill = product !== null && line.unitCost.trim() === "" && hint === null
		updateLine(line.key, {
			product,
			...(shouldPrefill ? { unitCost: formatMinorPlain(product.costPriceMinor) } : {}),
		})
	}

	return (
		<div className="grid gap-3">
			<div className="overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-32">Type</TableHead>
							<TableHead>Product / description</TableHead>
							<TableHead className="w-24">Qty</TableHead>
							<TableHead className="w-32">Unit cost</TableHead>
							<TableHead className="w-32 text-right">Line total</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{lines.map((line) => {
							const hint =
								line.kind === "product" && line.product
									? (orderedCostHint?.(line.product.id) ?? null)
									: null
							return (
								<TableRow key={line.key} className="align-top">
									<TableCell>
										<Select
											value={line.kind}
											onValueChange={(value) => setKind(line, value as "product" | "text")}
										>
											<SelectTrigger aria-label="Line type" className="h-8">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="product">Product</SelectItem>
												<SelectItem value="text">Free text</SelectItem>
											</SelectContent>
										</Select>
									</TableCell>
									<TableCell>
										{line.kind === "product" ? (
											<ProductPicker
												value={line.product}
												onSelect={(product) => handleProduct(line, product)}
												placeholder="Search products by name or SKU…"
											/>
										) : (
											<Input
												placeholder="e.g. Transport, installation"
												maxLength={200}
												value={line.description}
												onChange={(event) =>
													updateLine(line.key, { description: event.target.value })
												}
												aria-label="Line description"
											/>
										)}
									</TableCell>
									<TableCell>
										<Input
											type="number"
											min={1}
											max={1_000_000}
											step={1}
											className="h-8"
											value={line.quantity}
											onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
											aria-label="Quantity"
										/>
									</TableCell>
									<TableCell>
										<Input
											inputMode="decimal"
											placeholder="0.00"
											className="h-8"
											value={line.unitCost}
											onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
											aria-label="Unit cost in GHS"
										/>
										{hint ? (
											<p className="mt-1 text-xs text-muted-foreground">
												Ordered at {formatGhs(hint.unitCostMinor)} × {hint.quantity}
											</p>
										) : null}
									</TableCell>
									<TableCell className="pt-3 text-right tabular-nums">
										{formatGhs(invoiceLineDraftTotal(line))}
									</TableCell>
									<TableCell className="pt-2">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											aria-label="Remove line"
											disabled={lines.length === 1}
											onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
										>
											<XIcon className="size-4" aria-hidden="true" />
										</Button>
									</TableCell>
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</div>

			<div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onChange([...lines, createInvoiceLineDraft("text")])}
				>
					<PlusIcon className="size-4" aria-hidden="true" />
					Add line
				</Button>
			</div>
		</div>
	)
}
