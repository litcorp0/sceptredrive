import { formatBranchLabel, formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { ActiveBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
// The catalogue cost follows the latest goods receipt (P11-D13); the receipt read is inventory's.
import { latestReceiptCostOptions } from "#/modules/inventory"
import { brandListOptions, categoryListOptions, unitListOptions } from "../api/catalog"
import { catalogKeys } from "../api/keys"
import {
	addProductBarcode,
	archiveProduct,
	productDetailOptions,
	reactivateProduct,
	removeProductBarcode,
} from "../api/products"
import { BarcodeEditor } from "../components/barcode-editor"
import { PriceOverrides } from "../components/price-overrides"
import { ProductForm } from "../components/product-form"

const authenticatedRoute = getRouteApi("/_authenticated")
const productRoute = getRouteApi("/_authenticated/catalog/products/$id")

export function ProductDetailPage() {
	const { id } = productRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const queryClient = useQueryClient()
	const canUpdate = hasPermission(session.user.role, "catalog.update")
	// A manager may describe a product but not redefine it (17-02).
	const canDescribe = hasPermission(session.user.role, "catalog.describe")
	const canArchive = hasPermission(session.user.role, "catalog.archive")
	const canOverride = hasPermission(session.user.role, "price.override")
	const isAdmin = session.user.role === "ADMIN"
	const visibleBranches = isAdmin
		? branches
		: branches.filter((branch) => branch.id === session.user.branchId)

	const productQuery = useQuery(productDetailOptions(id))
	const latestReceiptQuery = useQuery(latestReceiptCostOptions(id))
	const categoriesQuery = useQuery(categoryListOptions({ includeArchived: true }))
	const brandsQuery = useQuery(brandListOptions({ includeArchived: true }))
	const unitsQuery = useQuery(unitListOptions({ includeArchived: true }))

	const toggleMutation = useMutation({
		mutationFn: (active: boolean) => (active ? reactivateProduct(id) : archiveProduct(id)),
		onSuccess: async (_data, active) => {
			toast.success(active ? "Product reactivated" : "Product archived")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.productDetail(id) })
			await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
		},
		onError: (error) => toastApiError(error),
	})

	const addBarcodeMutation = useMutation({
		mutationFn: (code: string) => addProductBarcode(id, code),
		onSuccess: async () => {
			toast.success("Barcode added")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.productDetail(id) })
			await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
		},
		onError: (error) => toastApiError(error),
	})

	const removeBarcodeMutation = useMutation({
		mutationFn: (barcodeId: string) => removeProductBarcode(id, barcodeId),
		onSuccess: async () => {
			toast.success("Barcode removed")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.productDetail(id) })
			await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
		},
		onError: (error) => toastApiError(error),
	})

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
	const latestReceipt = latestReceiptQuery.data?.movements[0]
	const latestReceiptBranch = latestReceipt
		? (() => {
				const branch = branches.find((entry) => entry.id === latestReceipt.branchId)
				return branch
					? formatBranchLabel(branch)
					: formatBranchLabel({ name: "", code: latestReceipt.branchCode })
			})()
		: null

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

			<div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
				{latestReceiptQuery.isLoading ? (
					<span className="text-muted-foreground">Loading the latest receipt cost…</span>
				) : latestReceiptQuery.isError ? (
					<span role="alert" className="text-destructive">
						Couldn't load the latest receipt cost.
					</span>
				) : latestReceipt && latestReceiptBranch ? (
					<>
						Latest receipt cost:{" "}
						<span className="font-medium tabular-nums">
							{formatGhs(latestReceipt.unitCostMinor)}
						</span>{" "}
						<span className="text-muted-foreground">
							— {latestReceiptBranch}, {formatDay(latestReceipt.createdAt)}
						</span>
					</>
				) : (
					<span className="text-muted-foreground">
						No purchase yet. Sales cost at this branch's average, which a goods receipt or an
						opening-stock adjustment sets; until then they report no margin.
					</span>
				)}
			</div>

			<ProductForm
				mode="edit"
				initialProduct={product}
				categories={categoriesQuery.data?.categories ?? []}
				brands={brandsQuery.data?.brands ?? []}
				units={unitsQuery.data?.uoms ?? []}
				readOnly={readOnly}
				descriptionEditable={!canUpdate && canDescribe && product.isActive}
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
					branches={visibleBranches}
					canOverride={canOverride}
					isAdmin={isAdmin}
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
