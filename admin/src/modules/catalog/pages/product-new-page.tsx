import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import { hasPermission } from "#/lib/role"
import { brandListOptions, categoryListOptions, unitListOptions } from "../api/catalog"
import { BarcodeEditor, type BarcodeItem } from "../components/barcode-editor"
import { ProductForm } from "../components/product-form"

const authenticatedRoute = getRouteApi("/_authenticated")

export function ProductNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const navigate = useNavigate()
	const canCreate = hasPermission(session.user.role, "catalog.create")
	const canEditCost = hasPermission(session.user.role, "price.update")

	const [barcodes, setBarcodes] = useState<BarcodeItem[]>([])

	const categoriesQuery = useQuery(categoryListOptions({ includeArchived: true }))
	const brandsQuery = useQuery(brandListOptions())
	const unitsQuery = useQuery(unitListOptions())

	if (!canCreate) {
		return (
			<div>
				<BackLink />
				<p className="text-sm text-muted-foreground">
					You don't have permission to create products.
				</p>
			</div>
		)
	}

	const catalogLoading = categoriesQuery.isLoading || brandsQuery.isLoading || unitsQuery.isLoading

	return (
		<div>
			<BackLink />

			<div className="mb-4">
				<h2 className="text-lg font-semibold tracking-tight">New product</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					The SKU is suggested from the catalog sequence; adjust it before saving.
				</p>
			</div>

			{catalogLoading ? (
				<p className="text-sm text-muted-foreground">Loading catalog…</p>
			) : (
				<ProductForm
					mode="create"
					categories={categoriesQuery.data?.categories ?? []}
					brands={brandsQuery.data?.brands ?? []}
					units={unitsQuery.data?.uoms ?? []}
					canEditCost={canEditCost}
					createBarcodes={barcodes.map((item) => item.code)}
					onSaved={(product) => {
						void navigate({ to: "/catalog/products/$id", params: { id: product.id } })
					}}
					barcodeEditor={
						<BarcodeEditor
							items={barcodes}
							onAdd={(code) => setBarcodes((current) => [...current, { id: null, code }])}
							onRemove={(item) =>
								setBarcodes((current) =>
									current.filter((candidate) => candidate.code !== item.code),
								)
							}
						/>
					}
				/>
			)}
		</div>
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
