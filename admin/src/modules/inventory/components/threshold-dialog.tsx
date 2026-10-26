import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
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
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { removeThreshold, setThreshold as setStockThreshold } from "../api/inventory"
import { inventoryKeys } from "../api/keys"

/**
 * The one stock-level dialog, reached from a product's stock page and from a replenishment row.
 *
 * The minimum is the reorder point, the maximum is the level to top up to, and the minimum order
 * quantity is the supplier's floor. The suggestion reads all three; saving here changes what the
 * API computes next, and the caller may invalidate its own read through `onSaved`.
 */
export function ThresholdDialog({
	open,
	onOpenChange,
	branchId,
	productId,
	productName,
	currentThreshold,
	currentMaxQuantity,
	currentMinOrderQuantity,
	onSaved,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string | null
	productId: string
	productName: string
	currentThreshold: number | null
	currentMaxQuantity: number | null
	currentMinOrderQuantity: number
	/** Called after a successful save or removal, before the dialog closes. */
	onSaved?: () => void
}) {
	const queryClient = useQueryClient()
	const [threshold, setThreshold] = useState("0")
	const [maxQuantity, setMaxQuantity] = useState("")
	const [minOrderQuantity, setMinOrderQuantity] = useState("0")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setThreshold(currentThreshold === null ? "0" : String(currentThreshold))
		setMaxQuantity(currentMaxQuantity === null ? "" : String(currentMaxQuantity))
		setMinOrderQuantity(String(currentMinOrderQuantity))
		setFormError(null)
	}, [open, currentThreshold, currentMaxQuantity, currentMinOrderQuantity])

	async function invalidate() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
			queryClient.invalidateQueries({ queryKey: inventoryKeys.thresholds }),
		])
	}

	const saveMutation = useMutation({
		mutationFn: (input: {
			threshold: number
			maxQuantity: number | null
			minOrderQuantity: number
		}) =>
			setStockThreshold({
				branchId: branchId as string,
				productId,
				threshold: input.threshold,
				maxQuantity: input.maxQuantity,
				minOrderQuantity: input.minOrderQuantity,
			}),
		onSuccess: async () => {
			toast.success("Stock levels saved")
			await invalidate()
			onSaved?.()
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

	const removeMutation = useMutation({
		mutationFn: () =>
			removeThreshold(productId, {
				...(branchId ? { branchId } : {}),
			}),
		onSuccess: async () => {
			toast.success("Threshold removed")
			await invalidate()
			onSaved?.()
			onOpenChange(false)
		},
		onError: (error) => toastApiError(error),
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!branchId) {
			setFormError("Select a branch first.")
			return
		}

		const parsedThreshold = Number.parseInt(threshold, 10)
		if (!Number.isSafeInteger(parsedThreshold) || parsedThreshold < 0) {
			setFormError("Enter a whole minimum of zero or more.")
			return
		}

		const parsedMax = maxQuantity.trim() === "" ? null : Number.parseInt(maxQuantity, 10)
		if (parsedMax !== null && (!Number.isSafeInteger(parsedMax) || parsedMax < 0)) {
			setFormError("Enter a whole maximum of zero or more, or leave it blank.")
			return
		}

		const parsedMinOrder = Number.parseInt(minOrderQuantity, 10)
		if (!Number.isSafeInteger(parsedMinOrder) || parsedMinOrder < 0) {
			setFormError("Enter a whole minimum order quantity of zero or more.")
			return
		}

		saveMutation.mutate({
			threshold: parsedThreshold,
			maxQuantity: parsedMax,
			minOrderQuantity: parsedMinOrder,
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Stock levels</DialogTitle>
					<DialogDescription>
						Set the reorder point, top-up level and supplier minimum for {productName} at this
						branch.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="threshold-value">Minimum (reorder point, units)</Label>
						<Input
							id="threshold-value"
							inputMode="numeric"
							value={threshold}
							onChange={(event) => setThreshold(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="threshold-max">Maximum (top-up level, units)</Label>
						<Input
							id="threshold-max"
							inputMode="numeric"
							value={maxQuantity}
							onChange={(event) => setMaxQuantity(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							Leave blank for no stored maximum. A new row defaults to twice the reorder point.
						</p>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="threshold-min-order">Minimum order quantity (units)</Label>
						<Input
							id="threshold-min-order"
							inputMode="numeric"
							value={minOrderQuantity}
							onChange={(event) => setMinOrderQuantity(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							The supplier's minimum. A suggestion never goes below this quantity.
						</p>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter className="sm:justify-between">
						{currentThreshold !== null ? (
							<Button
								type="button"
								variant="ghost"
								className="text-destructive"
								disabled={removeMutation.isPending}
								onClick={() => removeMutation.mutate()}
							>
								Remove levels
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={saveMutation.isPending || !branchId}>
								{saveMutation.isPending ? "Saving…" : "Save levels"}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
