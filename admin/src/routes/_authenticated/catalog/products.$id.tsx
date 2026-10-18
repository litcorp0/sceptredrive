import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { BarcodeEditor } from "#/components/catalog/barcode-editor"
import { PriceOverrides } from "#/components/catalog/price-overrides"
import { ProductForm } from "#/components/catalog/product-form"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { ActiveBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { ApiError, api } from "#/lib/api"
import type { TaxMode } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/catalog/products/$id")({
	component: EditProductPage,
})

function EditProductPage() {
	const { id } = Route.useParams()
	const { session } = Route.useRouteContext()
	const { branches } = useBranch()
	const queryClient = useQueryClient()
	const canUpdate = hasPermission(session.user.role, "catalog.update")
	const canEditCost = hasPermission(session.user.role, "price.update")
	const canArchive = hasPermission(session.user.role, "catalog.archive")
	const canOverride = hasPermission(session.user.role, "price.override")

	const productQuery = useQuery({
		queryKey: ["product", id],
		queryFn: () => api.products.get(id),
		retry: false,
	})
	const categoriesQuery = useQuery({
		queryKey: ["categories", { includeArchived: true }],
		queryFn: () => api.catalog.categories.list({ includeArchived: true }),
	})
	const brandsQuery = useQuery({
		queryKey: ["brands", { includeArchived: true }],
		queryFn: () => api.catalog.brands.list({ includeArchived: true }),
	})
	const unitsQuery = useQuery({
		queryKey: ["uoms", { includeArchived: true }],
		queryFn: () => api.catalog.units.list({ includeArchived: true }),
	})
	const settingsQuery = useQuery({
		queryKey: ["settings", {}],
		queryFn: () => api.settings.list(),
	})

	const toggleMutation = useMutation({
		mutationFn: (active: boolean) =>
			active ? api.products.reactivate(id) : api.products.archive(id),
		onSuccess: async (_data, active) => {
			toast.success(active ? "Product reactivated" : "Product archived")
			await queryClient.invalidateQueries({ queryKey: ["product", id] })
			await queryClient.invalidateQueries({ queryKey: ["products"] })
		},
		onError: (error) => toastApiError(error),
	})

	const addBarcodeMutation = useMutation({
		mutationFn: (code: string) => api.products.addBarcode(id, code),
		onSuccess: async () => {
			toast.success("Barcode added")
			await queryClient.invalidateQueries({ queryKey: ["product", id] })
			await queryClient.invalidateQueries({ queryKey: ["products"] })
		},
		onError: (error) => toastApiError(error),
	})

	const removeBarcodeMutation = useMutation({
		mutationFn: (barcodeId: string) => api.products.removeBarcode(id, barcodeId),
		onSuccess: async () => {
			toast.success("Barcode removed")
			await queryClient.invalidateQueries({ queryKey: ["product", id] })
			await queryClient.invalidateQueries({ queryKey: ["products"] })
		},
		onError: (error) => toastApiError(error),
	})

	const taxMode =
		(settingsQuery.data?.settings.find((setting) => setting.key === "pricing.taxMode")?.value as
			| TaxMode
			| undefined) ?? "INCLUSIVE"

	if (productQuery.isPending) {
		return <p className="text-sm text-muted-foreground">Loading product…</p>
	}

	if (productQuery.isError) {
		const notFound = productQuery.error instanceof ApiError && productQuery.error.status === 404
		return (
			<div>
				<BackLink />
				<p className="text-sm text-muted-foreground">
					{notFound ? "Product not found." : "Couldn't load this product."}
				</p>
			</div>
		)
	}

	const product = productQuery.data.product
	const readOnly = !canUpdate || !product.isActive

	return (
		<div>
			<BackLink />

			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-lg font-semibold tracking-tight">{product.name}</h2>
						<ActiveBadge active={product.isActive} />
					</div>
					<p className="mt-1 font-mono text-xs text-muted-foreground">{product.sku}</p>
				</div>
				{canArchive && product.isActive ? (
					<ArchiveButton
						label="Archive product"
						pending={toggleMutation.isPending}
						onConfirm={() => toggleMutation.mutate(false)}
					/>
				) : null}
				{canArchive && !product.isActive ? (
					<Button
						size="sm"
						variant="outline"
						disabled={toggleMutation.isPending}
						onClick={() => toggleMutation.mutate(true)}
					>
						{toggleMutation.isPending ? "Reactivating…" : "Reactivate product"}
					</Button>
				) : null}
			</div>

			<ProductForm
				mode="edit"
				initialProduct={product}
				categories={categoriesQuery.data?.categories ?? []}
				brands={brandsQuery.data?.brands ?? []}
				units={unitsQuery.data?.uoms ?? []}
				taxMode={taxMode}
				canEditCost={canEditCost}
				readOnly={readOnly}
				barcodeEditor={
					<BarcodeEditor
						items={product.barcodes.map((barcode) => ({ id: barcode.id, code: barcode.code }))}
						pending={addBarcodeMutation.isPending || removeBarcodeMutation.isPending}
						disabled={readOnly}
						onAdd={(code) => addBarcodeMutation.mutate(code)}
						onRemove={(item) => {
							if (item.id) removeBarcodeMutation.mutate(item.id)
						}}
					/>
				}
			/>

			<div className="mt-6">
				<PriceOverrides
					productId={id}
					basePriceMinor={product.basePriceMinor}
					branches={branches}
					canOverride={canOverride}
					disabled={!product.isActive}
				/>
			</div>
		</div>
	)
}

function ArchiveButton({
	label,
	pending,
	onConfirm,
}: {
	label: string
	pending: boolean
	onConfirm: () => void
}) {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
				{label}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title="Archive product?"
				description="Archived products disappear from pickers and search by default."
				confirmLabel="Archive"
				destructive
				pending={pending}
				onConfirm={onConfirm}
			/>
		</>
	)
}

function BackLink() {
	return (
		<Link
			to="/catalog/products"
			className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeftIcon className="size-4" />
			Back to products
		</Link>
	)
}
