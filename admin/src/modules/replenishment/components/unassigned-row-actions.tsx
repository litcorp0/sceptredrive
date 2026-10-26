import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Label } from "#/components/ui/label"
import { ApiError } from "#/lib/api"
import { setPreferredSupplier, supplierKeys } from "#/modules/suppliers"
import { replenishmentKeys } from "../api/keys"
import type { ReplenishmentRow } from "../types"

/**
 * "Choose supplier" for a part with no preferred link.
 *
 * The supplier-product link is the unit the API marks preferred; marking one clears any other
 * preferred link for the same product server-side. A supplier that does not list the product yet
 * is refused by name rather than silently adding a mapping.
 */
export function UnassignedRowActions({ row }: { row: ReplenishmentRow }) {
	const queryClient = useQueryClient()
	const [open, setOpen] = useState(false)
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [formError, setFormError] = useState<string | null>(null)

	const chooseMutation = useMutation({
		mutationFn: (chosen: PickedSupplier) => setPreferredSupplier(chosen.id, row.productId),
		onSuccess: async (_mapping, chosen) => {
			toast.success(`Preferred supplier set for ${row.sku}`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: replenishmentKeys.all }),
				queryClient.invalidateQueries({ queryKey: supplierKeys.byId(chosen.id) }),
			])
			setOpen(false)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				setFormError(error.message)
				return
			}
			setFormError(
				error instanceof Error
					? error.message
					: "The preferred supplier could not be set. Please try again.",
			)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!supplier) {
			setFormError("Choose the supplier this part should come from.")
			return
		}
		chooseMutation.mutate(supplier)
	}

	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				aria-label={`Choose a supplier for ${row.sku} ${row.name}`}
				onClick={() => {
					setSupplier(null)
					setFormError(null)
					setOpen(true)
				}}
			>
				Choose supplier
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Choose a supplier</DialogTitle>
						<DialogDescription>
							Pick the supplier this part should be ordered from. Its existing product link becomes
							the preferred one; any other preferred supplier for the same product is cleared.
						</DialogDescription>
					</DialogHeader>

					<form onSubmit={handleSubmit} className="grid gap-4">
						<div className="rounded-md border bg-muted/40 px-3 py-2">
							<p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
							<p className="text-sm font-medium">{row.name}</p>
						</div>

						<div className="grid gap-1.5">
							<Label>Supplier</Label>
							<SupplierCombobox
								value={supplier}
								onSelect={setSupplier}
								disabled={chooseMutation.isPending}
							/>
						</div>

						{formError ? (
							<p role="alert" className="text-sm text-destructive">
								{formError}
							</p>
						) : null}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
								disabled={chooseMutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={chooseMutation.isPending || !supplier}>
								{chooseMutation.isPending ? "Saving…" : "Set as preferred"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	)
}
