import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"
import type { PickedSupplier } from "#/components/common/supplier-combobox"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { createReceipt } from "../api/inventory"
import { inventoryKeys } from "../api/keys"
import type { ReceiptCreateInput } from "../types"
import { SupplierPicker } from "./supplier-picker"

interface ReceiveRow {
	key: string
	product: PickedProduct | null
	quantity: string
	unitCost: string
}

function blankRow(): ReceiveRow {
	return { key: crypto.randomUUID(), product: null, quantity: "", unitCost: "" }
}

export function ReceiveDialog({
	open,
	onOpenChange,
	branchId,
	branchName,
	canPickSupplier,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string | null
	branchName: string | null
	/** `supplier.read` holders can search the supplier directory. */
	canPickSupplier: boolean
}) {
	const queryClient = useQueryClient()
	const [rows, setRows] = useState<ReceiveRow[]>([blankRow()])
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [supplierName, setSupplierName] = useState("")
	const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setRows([blankRow()])
		setSupplier(null)
		setSupplierName("")
		setSupplierInvoiceNumber("")
		setNote("")
		setFormError(null)
	}, [open])

	const totalMinor = useMemo(
		() =>
			rows.reduce((sum, row) => {
				const quantity = Number.parseInt(row.quantity, 10)
				const cost = parseGhsToMinor(row.unitCost)
				if (!Number.isSafeInteger(quantity) || quantity <= 0 || cost === null) return sum
				return sum + quantity * cost
			}, 0),
		[rows],
	)

	const createMutation = useMutation({
		mutationFn: (input: ReceiptCreateInput) => createReceipt(input),
		onSuccess: async (data) => {
			toast.success(`Received stock as ${data.receipt.number}`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.receipts }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		if (!branchId) {
			setFormError("Select a branch before receiving stock.")
			return
		}

		const lines: ReceiptCreateInput["lines"] = []
		for (const row of rows) {
			const hasInput = row.product || row.quantity.trim() || row.unitCost.trim()
			if (!hasInput) continue
			if (!row.product) {
				setFormError("Choose a product for every line.")
				return
			}
			const quantity = Number.parseInt(row.quantity, 10)
			if (!Number.isSafeInteger(quantity) || quantity <= 0) {
				setFormError(`Enter a whole quantity for ${row.product.name}.`)
				return
			}
			const unitCostMinor = parseGhsToMinor(row.unitCost)
			if (unitCostMinor === null) {
				setFormError(`Enter a valid unit cost for ${row.product.name}.`)
				return
			}
			lines.push({ productId: row.product.id, quantity, unitCostMinor })
		}

		if (lines.length === 0) {
			setFormError("Add at least one product line.")
			return
		}
		if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
			setFormError("Each product may appear only once in a receipt.")
			return
		}

		createMutation.mutate({
			branchId,
			...(supplier
				? { supplierId: supplier.id }
				: supplierName.trim()
					? { supplierName: supplierName.trim() }
					: {}),
			...(supplierInvoiceNumber.trim()
				? { supplierInvoiceNumber: supplierInvoiceNumber.trim() }
				: {}),
			...(note.trim() ? { note: note.trim() } : {}),
			lines,
		})
	}

	function updateRow(key: string, patch: Partial<ReceiveRow>) {
		setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Receive stock</DialogTitle>
					<DialogDescription>
						Record goods received{branchName ? ` at ${branchName}` : ""}. This creates an immutable
						goods receipt and updates average cost.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid items-start gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="receipt-supplier">Supplier (optional)</Label>
							<SupplierPicker
								supplier={supplier}
								freeText={supplierName}
								onSupplierChange={setSupplier}
								onFreeTextChange={setSupplierName}
								canSearch={canPickSupplier}
								disabled={createMutation.isPending}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="receipt-invoice">Supplier invoice number (optional)</Label>
							<Input
								id="receipt-invoice"
								value={supplierInvoiceNumber}
								onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
								maxLength={60}
							/>
						</div>
					</div>

					<div className="grid gap-2">
						{rows.map((row, index) => (
							<div
								key={row.key}
								className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[1fr_90px_120px_auto]"
							>
								<ProductPicker
									value={row.product}
									onSelect={(product) =>
										updateRow(row.key, {
											product,
											unitCost: product ? formatMinorPlain(product.costPriceMinor) : "",
										})
									}
									disabled={createMutation.isPending}
								/>
								<div className="grid gap-1">
									<Label className="text-xs" htmlFor={`receipt-qty-${row.key}`}>
										Quantity
									</Label>
									<Input
										id={`receipt-qty-${row.key}`}
										inputMode="numeric"
										value={row.quantity}
										onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
										aria-label={`Quantity for line ${index + 1}`}
									/>
								</div>
								<div className="grid gap-1">
									<Label className="text-xs" htmlFor={`receipt-cost-${row.key}`}>
										Unit cost (GHS)
									</Label>
									<Input
										id={`receipt-cost-${row.key}`}
										inputMode="decimal"
										value={row.unitCost}
										onChange={(event) => updateRow(row.key, { unitCost: event.target.value })}
										aria-label={`Unit cost for line ${index + 1}`}
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="mt-5"
									aria-label={`Remove line ${index + 1}`}
									disabled={rows.length === 1 || createMutation.isPending}
									onClick={() =>
										setRows((current) => current.filter((item) => item.key !== row.key))
									}
								>
									<Trash2Icon className="size-4" aria-hidden="true" />
								</Button>
							</div>
						))}

						<div className="flex items-center justify-between">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={createMutation.isPending}
								onClick={() => setRows((current) => [...current, blankRow()])}
							>
								<PlusIcon className="size-4" aria-hidden="true" />
								Add line
							</Button>
							<p className="text-sm text-muted-foreground">
								Total cost: <span className="font-medium">{formatGhs(totalMinor)}</span>
							</p>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="receipt-note">Note (optional)</Label>
						<Textarea
							id="receipt-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={300}
							rows={2}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending || !branchId}>
							{createMutation.isPending ? "Receiving…" : "Receive stock"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
