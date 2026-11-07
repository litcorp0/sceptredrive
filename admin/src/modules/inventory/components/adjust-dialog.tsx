import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { createAdjustment } from "../api/inventory"
import { inventoryKeys } from "../api/keys"
import type { AdjustmentReason } from "../types"

const REASONS: { value: AdjustmentReason; label: string }[] = [
	{ value: "DAMAGE", label: "Damage" },
	{ value: "LOSS", label: "Loss / shrinkage" },
	{ value: "FOUND", label: "Found stock" },
	{ value: "CORRECTION", label: "Correction" },
	{ value: "EXPIRED", label: "Expired" },
	{ value: "OTHER", label: "Other" },
]

export function AdjustDialog({
	open,
	onOpenChange,
	branchId,
	branchName,
	initialProduct = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string | null
	branchName: string | null
	/** 18-05/19: open from an approved product with the item already chosen. */
	initialProduct?: PickedProduct | null
}) {
	const queryClient = useQueryClient()
	const [product, setProduct] = useState<PickedProduct | null>(initialProduct)
	const [direction, setDirection] = useState<"in" | "out">(initialProduct ? "in" : "out")
	const [quantity, setQuantity] = useState("")
	const [reasonCode, setReasonCode] = useState<AdjustmentReason>(
		initialProduct ? "FOUND" : "CORRECTION",
	)
	const [unitCost, setUnitCost] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setProduct(initialProduct)
		setDirection(initialProduct ? "in" : "out")
		setQuantity("")
		setReasonCode(initialProduct ? "FOUND" : "CORRECTION")
		setUnitCost("")
		setNote("")
		setFormError(null)
	}, [open, initialProduct])

	// Opening stock: stock the shop already owns, which a receipt cannot describe.
	const openingStock = direction === "in" && (reasonCode === "FOUND" || reasonCode === "CORRECTION")
	const parsedCost = openingStock ? parseGhsToMinor(unitCost) : null

	/**
	 * Prefill the unit cost from the product itself (P20-D23).
	 *
	 * It is the number the catalogue already holds, so a FOUND batch is valued at what the
	 * product costs unless the operator says this batch was different. Leaving it blank used
	 * to value the goods at zero; the API now falls back to the same cost, and this makes the
	 * fallback visible instead of silent.
	 */
	useEffect(() => {
		if (!open) return
		setUnitCost(
			product && product.costPriceMinor > 0 ? formatMinorPlain(product.costPriceMinor) : "",
		)
	}, [open, product])

	const createMutation = useMutation({
		mutationFn: (delta: number) =>
			createAdjustment({
				branchId: branchId as string,
				productId: product?.id as string,
				quantityDelta: delta,
				reasonCode,
				...(note.trim() ? { note: note.trim() } : {}),
				// Only a positive opening batch carries a cost; the field is not
				// even shown for an issue (17-05).
				...(openingStock && parsedCost !== null ? { unitCostMinor: parsedCost } : {}),
			}),
		onSuccess: async () => {
			toast.success("Stock adjusted")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
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
			setFormError("Select a branch before adjusting stock.")
			return
		}
		if (!product) {
			setFormError("Choose a product.")
			return
		}
		const parsed = Number.parseInt(quantity, 10)
		if (!Number.isSafeInteger(parsed) || parsed <= 0) {
			setFormError("Enter a whole quantity greater than zero.")
			return
		}

		createMutation.mutate(direction === "in" ? parsed : -parsed)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Adjust stock</DialogTitle>
					<DialogDescription>
						Post a reason-coded correction{branchName ? ` at ${branchName}` : ""}. An increase with
						a unit cost seeds the branch average like a receipt; a decrease never changes it.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label>Product</Label>
						<ProductPicker
							value={product}
							onSelect={setProduct}
							disabled={createMutation.isPending}
						/>
					</div>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="adjust-direction">Direction</Label>
							<Select
								value={direction}
								onValueChange={(value) => setDirection(value as "in" | "out")}
							>
								<SelectTrigger id="adjust-direction">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="out">Decrease stock</SelectItem>
									<SelectItem value="in">Increase stock</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="adjust-quantity">Quantity</Label>
							<Input
								id="adjust-quantity"
								inputMode="numeric"
								value={quantity}
								onChange={(event) => setQuantity(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="adjust-reason">Reason</Label>
						<Select
							value={reasonCode}
							onValueChange={(value) => setReasonCode(value as AdjustmentReason)}
						>
							<SelectTrigger id="adjust-reason">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{REASONS.map((reason) => (
									<SelectItem key={reason.value} value={reason.value}>
										{reason.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="adjust-note">Note (optional)</Label>
						<Textarea
							id="adjust-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={300}
							rows={2}
						/>
					</div>

					{openingStock ? (
						<div className="grid gap-1.5">
							<Label htmlFor="adjust-unit-cost">Unit cost (optional, GH₵)</Label>
							<Input
								id="adjust-unit-cost"
								inputMode="decimal"
								placeholder="12.50"
								value={unitCost}
								onChange={(event) => setUnitCost(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								What these units cost you. Prefilled from the product&apos;s cost price; change it
								if this batch cost something else. Left empty, the product&apos;s cost price is used
								when the branch has no average yet.
							</p>
						</div>
					) : null}

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
							{createMutation.isPending ? "Posting…" : "Post adjustment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
