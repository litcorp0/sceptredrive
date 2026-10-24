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
import { ApiError, api } from "#/lib/api"
import type { AdjustmentReason } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

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
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string | null
	branchName: string | null
}) {
	const queryClient = useQueryClient()
	const [product, setProduct] = useState<PickedProduct | null>(null)
	const [direction, setDirection] = useState<"in" | "out">("out")
	const [quantity, setQuantity] = useState("")
	const [reasonCode, setReasonCode] = useState<AdjustmentReason>("CORRECTION")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setProduct(null)
		setDirection("out")
		setQuantity("")
		setReasonCode("CORRECTION")
		setNote("")
		setFormError(null)
	}, [open])

	const createMutation = useMutation({
		mutationFn: (delta: number) =>
			api.inventory.adjustments.create({
				branchId: branchId as string,
				productId: product?.id as string,
				quantityDelta: delta,
				reasonCode,
				...(note.trim() ? { note: note.trim() } : {}),
			}),
		onSuccess: async () => {
			toast.success("Stock adjusted")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["inventory-stock"] }),
				queryClient.invalidateQueries({ queryKey: ["inventory-movements"] }),
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
						Post a reason-coded correction{branchName ? ` at ${branchName}` : ""}. Adjustments are
						audited and never change the average cost.
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
