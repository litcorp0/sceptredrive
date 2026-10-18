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
import { ApiError, api } from "#/lib/api"
import type { Transfer } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function TransferQuantityDialog({
	open,
	onOpenChange,
	transfer,
	mode,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	transfer: Transfer
	mode: "dispatch" | "receive"
}) {
	const queryClient = useQueryClient()
	const [quantities, setQuantities] = useState<Record<string, string>>({})
	const [formError, setFormError] = useState<string | null>(null)

	const lines = transfer.lines ?? []
	const isDispatch = mode === "dispatch"

	useEffect(() => {
		if (!open) return
		const next: Record<string, string> = {}
		for (const line of lines) {
			const max = isDispatch ? line.quantityRequested : line.pending
			next[line.productId] = String(max)
		}
		setQuantities(next)
		setFormError(null)
	}, [open, isDispatch, lines])

	const mutation = useMutation({
		mutationFn: (entries: { productId: string; quantity: number }[]) =>
			isDispatch
				? api.transfers.dispatch(
						transfer.id,
						entries.map((entry) => ({
							productId: entry.productId,
							quantityDispatched: entry.quantity,
						})),
					)
				: api.transfers.receive(
						transfer.id,
						entries.map((entry) => ({
							productId: entry.productId,
							quantityReceived: entry.quantity,
						})),
					),
		onSuccess: async () => {
			toast.success(isDispatch ? "Transfer dispatched" : "Goods received")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["transfers"] }),
				queryClient.invalidateQueries({ queryKey: ["transfer", transfer.id] }),
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

		const entries: { productId: string; quantity: number }[] = []
		for (const line of lines) {
			const raw = quantities[line.productId] ?? ""
			const quantity = Number.parseInt(raw, 10)
			const max = isDispatch ? line.quantityRequested : line.pending
			if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > max) {
				setFormError(`Enter a whole quantity between 0 and ${max} for ${line.productName}.`)
				return
			}
			entries.push({ productId: line.productId, quantity })
		}
		if (entries.every((entry) => entry.quantity === 0)) {
			setFormError(`Enter at least one quantity to ${isDispatch ? "dispatch" : "receive"}.`)
			return
		}
		mutation.mutate(entries)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{isDispatch ? "Dispatch transfer" : "Receive transfer"}</DialogTitle>
					<DialogDescription>
						{isDispatch
							? `Stock leaves ${transfer.fromBranchName} immediately. Reduce a line to dispatch partially.`
							: `Stock enters ${transfer.toBranchName}. Receive less than pending to keep the balance open.`}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-2">
						{lines.map((line) => {
							const max = isDispatch ? line.quantityRequested : line.pending
							const onHand = isDispatch ? line.fromOnHand : line.toOnHand
							return (
								<div
									key={line.productId}
									className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_100px_110px]"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">{line.productName}</p>
										<p className="truncate font-mono text-xs text-muted-foreground">
											{line.sku} · {isDispatch ? "source" : "destination"} on hand {onHand}
										</p>
									</div>
									<div className="text-xs text-muted-foreground">
										{isDispatch ? "Requested" : "Pending"}:{" "}
										<span className="font-medium">{max}</span>
									</div>
									<Input
										inputMode="numeric"
										value={quantities[line.productId] ?? ""}
										onChange={(event) =>
											setQuantities((current) => ({
												...current,
												[line.productId]: event.target.value,
											}))
										}
										aria-label={`Quantity for ${line.productName}`}
									/>
								</div>
							)
						})}
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
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending
								? isDispatch
									? "Dispatching…"
									: "Receiving…"
								: isDispatch
									? "Dispatch"
									: "Receive"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
