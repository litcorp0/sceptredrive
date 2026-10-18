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
import { ApiError, api } from "#/lib/api"
import { toastApiError } from "#/lib/toast"

export function ThresholdDialog({
	open,
	onOpenChange,
	branchId,
	productId,
	productName,
	currentThreshold,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string | null
	productId: string
	productName: string
	currentThreshold: number | null
}) {
	const queryClient = useQueryClient()
	const [threshold, setThreshold] = useState("0")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setThreshold(currentThreshold === null ? "0" : String(currentThreshold))
		setFormError(null)
	}, [open, currentThreshold])

	async function invalidate() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["inventory-stock"] }),
			queryClient.invalidateQueries({ queryKey: ["inventory-thresholds"] }),
		])
	}

	const saveMutation = useMutation({
		mutationFn: (value: number) =>
			api.inventory.thresholds.set({
				branchId: branchId as string,
				productId,
				threshold: value,
			}),
		onSuccess: async () => {
			toast.success("Low-stock threshold saved")
			await invalidate()
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
			api.inventory.thresholds.remove(productId, {
				...(branchId ? { branchId } : {}),
			}),
		onSuccess: async () => {
			toast.success("Threshold removed")
			await invalidate()
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
		const parsed = Number.parseInt(threshold, 10)
		if (!Number.isSafeInteger(parsed) || parsed < 0) {
			setFormError("Enter a whole threshold of zero or more.")
			return
		}
		saveMutation.mutate(parsed)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Low-stock threshold</DialogTitle>
					<DialogDescription>
						Flag {productName} when on-hand is at or below this quantity at this branch.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="threshold-value">Threshold (units)</Label>
						<Input
							id="threshold-value"
							inputMode="numeric"
							value={threshold}
							onChange={(event) => setThreshold(event.target.value)}
						/>
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
								Remove threshold
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={saveMutation.isPending || !branchId}>
								{saveMutation.isPending ? "Saving…" : "Save threshold"}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
