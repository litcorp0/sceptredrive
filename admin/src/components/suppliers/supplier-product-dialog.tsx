import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { type PickedProduct, ProductPicker } from "#/components/inventory/product-picker"
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
import { Switch } from "#/components/ui/switch"
import { ApiError, api } from "#/lib/api"
import type { SupplierProductMapping } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function SupplierProductDialog({
	open,
	onOpenChange,
	supplierId,
	mapping = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	supplierId: string
	/** When set, edits this mapping instead of adding one. */
	mapping?: SupplierProductMapping | null
}) {
	const queryClient = useQueryClient()
	const isEdit = mapping !== null

	const [product, setProduct] = useState<PickedProduct | null>(null)
	const [supplierSku, setSupplierSku] = useState("")
	const [leadTimeDays, setLeadTimeDays] = useState("")
	const [isPreferred, setIsPreferred] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setProduct(
			mapping
				? {
						id: mapping.productId,
						sku: mapping.productSku,
						name: mapping.productName,
						costPriceMinor: mapping.lastCostMinor,
					}
				: null,
		)
		setSupplierSku(mapping?.supplierSku ?? "")
		setLeadTimeDays(
			mapping?.leadTimeDays === null || mapping?.leadTimeDays === undefined
				? ""
				: String(mapping.leadTimeDays),
		)
		setIsPreferred(mapping?.isPreferred ?? false)
		setFormError(null)
	}, [open, mapping])

	const saveMutation = useMutation({
		mutationFn: () => {
			const lead = leadTimeDays.trim() === "" ? null : Number.parseInt(leadTimeDays, 10)
			if (isEdit && mapping) {
				return api.suppliers.updateProduct(supplierId, mapping.id, {
					supplierSku: supplierSku.trim() || null,
					leadTimeDays: lead,
					isPreferred,
				})
			}
			if (!product) throw new Error("Choose a product first")
			return api.suppliers.addProduct(supplierId, {
				productId: product.id,
				supplierSku: supplierSku.trim() || undefined,
				leadTimeDays: lead === null ? undefined : lead,
				isPreferred: isPreferred || undefined,
			})
		},
		onSuccess: async () => {
			toast.success(isEdit ? "Supplied product updated" : "Supplied product added")
			await queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] })
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!isEdit && !product) {
			setFormError("Choose the product this supplier provides.")
			return
		}
		const lead = leadTimeDays.trim() === "" ? null : Number.parseInt(leadTimeDays, 10)
		if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) {
			setFormError("Lead time must be a whole number of days between 0 and 365.")
			return
		}
		saveMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit supplied product" : "Add supplied product"}</DialogTitle>
					<DialogDescription>
						Supplier SKUs and lead times drive purchase invoices and reorder hints. Last cost is
						recorded automatically from invoices.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{isEdit && product ? (
						<div className="rounded-md border bg-muted/40 px-3 py-2">
							<p className="text-sm font-medium">{product.name}</p>
							<p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
						</div>
					) : (
						<div className="grid gap-1.5">
							<Label>Product</Label>
							<ProductPicker value={product} onSelect={setProduct} />
							<p className="text-xs text-muted-foreground">
								Search the catalog for the product this supplier provides.
							</p>
						</div>
					)}

					<div className="grid gap-1.5">
						<Label htmlFor="supplier-product-sku">
							Supplier SKU <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="supplier-product-sku"
							maxLength={60}
							className="font-mono"
							value={supplierSku}
							onChange={(event) => setSupplierSku(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="supplier-product-lead">
							Lead time (days) <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="supplier-product-lead"
							type="number"
							min={0}
							max={365}
							step={1}
							value={leadTimeDays}
							onChange={(event) => setLeadTimeDays(event.target.value)}
						/>
					</div>

					<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
						<div>
							<p className="text-sm font-medium">Preferred supplier</p>
							<p className="text-xs text-muted-foreground">
								Highlight this mapping when ordering the product.
							</p>
						</div>
						<Switch
							aria-label="Preferred supplier"
							checked={isPreferred}
							onCheckedChange={setIsPreferred}
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
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add product"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
