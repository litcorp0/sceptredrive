import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { Pagination } from "#/components/common/pagination"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Switch } from "#/components/ui/switch"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
// A manager's product proposal is decided in the procurement approval queue; the catalogue shows
// the queue here because this is where the product will appear.
import { PendingProductSubmissions } from "#/modules/procurement"
import { brandListOptions, categoryListOptions } from "../api/catalog"
import { catalogKeys } from "../api/keys"
import { archiveProduct, productListOptions, reactivateProduct } from "../api/products"
import { StockedBranches } from "../components/stocked-branches"
import type { Product } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const ALL = "all"
const PAGE_SIZE = 25

export function ProductsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId } = useBranch()
	const queryClient = useQueryClient()
	const role = session.user.role
	const canCreate = hasPermission(role, "catalog.create")
	// Managers do not hold `catalog.create`; their route is a proposal the admin decides.
	const canSubmit = !canCreate && hasPermission(role, "procurement.create")
	const canApprove = hasPermission(role, "approval.decide")
	const canArchive = hasPermission(role, "catalog.archive")

	const [search, setSearch] = useState("")
	const [categoryId, setCategoryId] = useState<string>(ALL)
	const [brandId, setBrandId] = useState<string>(ALL)
	const [includeArchived, setIncludeArchived] = useState(false)
	// On by default, like the stock page: with a branch selected, the catalogue question is
	// "what does this branch carry", and the company-wide list is one switch away
	// (P20-D22).
	const [carriedOnly, setCarriedOnly] = useState(true)
	const [offset, setOffset] = useState(0)
	const [confirmTarget, setConfirmTarget] = useState<Product | null>(null)

	const debouncedSearch = useDebouncedValue(search, 300)

	const categoriesQuery = useQuery(categoryListOptions({ includeArchived: true }))
	const brandsQuery = useQuery(brandListOptions())

	const filters = {
		q: debouncedSearch.trim() || undefined,
		categoryId: categoryId === ALL ? undefined : categoryId,
		brandId: brandId === ALL ? undefined : brandId,
		includeArchived,
		branchId: activeBranchId ?? undefined,
		carried: carriedOnly && activeBranchId ? true : undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const productsQuery = useQuery(productListOptions(filters))

	const products = productsQuery.data?.products ?? []
	const total = productsQuery.data?.total ?? 0
	const showEffectivePrice = activeBranchId !== null
	const columnCount = showEffectivePrice ? 10 : 9

	const toggleMutation = useMutation({
		mutationFn: (product: Product) =>
			product.isActive ? archiveProduct(product.id) : reactivateProduct(product.id),
		onSuccess: async (_data, product) => {
			toast.success(product.isActive ? "Product archived" : "Product reactivated")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
			setConfirmTarget(null)
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmTarget(null)
		},
	})

	const parentCategories = categoriesQuery.data?.categories ?? []

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<div className="relative min-w-56 flex-1">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						className="pl-8"
						placeholder="Search by name, SKU, or barcode…"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value)
							setOffset(0)
						}}
						aria-label="Search products"
					/>
				</div>

				<Select
					value={categoryId}
					onValueChange={(value) => {
						setCategoryId(value)
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-52" aria-label="Filter by category">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All categories</SelectItem>
						{parentCategories.map((parent) => (
							<SelectItem key={parent.id} value={parent.id}>
								{parent.name}
							</SelectItem>
						))}
						{parentCategories.flatMap((parent) =>
							parent.children.map((child) => (
								<SelectItem key={child.id} value={child.id}>
									{`${parent.name} / ${child.name}`}
								</SelectItem>
							)),
						)}
					</SelectContent>
				</Select>

				<Select
					value={brandId}
					onValueChange={(value) => {
						setBrandId(value)
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-44" aria-label="Filter by brand">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All brands</SelectItem>
						{(brandsQuery.data?.brands ?? []).map((brand) => (
							<SelectItem key={brand.id} value={brand.id}>
								{brand.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<div className="flex items-center gap-2 pb-2">
					<Switch
						id="show-archived"
						checked={includeArchived}
						onCheckedChange={(checked) => {
							setIncludeArchived(checked)
							setOffset(0)
						}}
					/>
					<Label htmlFor="show-archived" className="text-sm text-muted-foreground">
						Show archived
					</Label>
				</div>

				{/* Meaningless with every branch in view, so it appears only when one is chosen. */}
				{activeBranchId ? (
					<div className="flex items-center gap-2 pb-2">
						<Switch
							id="catalog-carried-only"
							checked={carriedOnly}
							onCheckedChange={(checked) => {
								setCarriedOnly(checked)
								setOffset(0)
							}}
						/>
						<Label htmlFor="catalog-carried-only" className="text-sm text-muted-foreground">
							Stocked at this branch
						</Label>
					</div>
				) : null}

				{canCreate ? (
					<Button size="sm" asChild className="ml-auto">
						<Link to="/catalog/products/new">
							<PlusIcon className="size-4" aria-hidden="true" />
							New product
						</Link>
					</Button>
				) : canSubmit ? (
					<Button size="sm" asChild className="ml-auto">
						<Link to="/catalog/products/submit">
							<PlusIcon className="size-4" aria-hidden="true" />
							Submit a product
						</Link>
					</Button>
				) : null}
			</div>

			{canApprove ? (
				<PendingProductSubmissions
					onDecided={() => {
						void queryClient.invalidateQueries({ queryKey: catalogKeys.products })
					}}
				/>
			) : null}

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-32">SKU</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-40">Category</TableHead>
							<TableHead className="w-28">Brand</TableHead>
							<TableHead className="w-16">Unit</TableHead>
							<TableHead className="w-44">Branches</TableHead>
							<TableHead className="w-28 text-right">Base price</TableHead>
							{showEffectivePrice ? (
								<TableHead className="w-28 text-right">Effective</TableHead>
							) : null}
							<TableHead className="w-24">Status</TableHead>
							<TableHead className="w-40" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{productsQuery.isLoading ? (
							<TableMessage colSpan={columnCount}>Loading products…</TableMessage>
						) : productsQuery.isError ? (
							<TableMessage colSpan={columnCount} tone="error">
								Couldn't load products.
							</TableMessage>
						) : products.length === 0 ? (
							<TableMessage colSpan={columnCount}>
								{debouncedSearch || categoryId !== ALL || brandId !== ALL
									? "No products match these filters."
									: carriedOnly && activeBranchId
										? "No products are stocked at this branch yet. Receive stock, or switch off “Stocked at this branch” to see the whole catalogue."
										: "No products yet. Create the first one."}
							</TableMessage>
						) : (
							products.map((product) => (
								<TableRow key={product.id}>
									<TableCell className="font-mono text-xs">{product.sku}</TableCell>
									<TableCell>
										<Link
											to="/catalog/products/$id"
											params={{ id: product.id }}
											className="font-medium hover:underline"
										>
											{product.name}
										</Link>
										{product.barcodeCount > 0 ? (
											<span className="ml-2 text-xs text-muted-foreground">
												{product.barcodeCount} barcode{product.barcodeCount === 1 ? "" : "s"}
											</span>
										) : null}
									</TableCell>
									<TableCell className="text-muted-foreground">{product.categoryName}</TableCell>
									<TableCell className="text-muted-foreground">
										{product.brandName ?? "—"}
									</TableCell>
									<TableCell>
										<StatusBadge tone="zinc">{product.uomCode}</StatusBadge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										<StockedBranches branches={product.stockedAt} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(product.basePriceMinor)}
									</TableCell>
									{showEffectivePrice ? (
										<TableCell className="text-right tabular-nums">
											{product.effectivePriceMinor === null ? (
												"—"
											) : product.effectivePriceMinor !== product.basePriceMinor ? (
												<span className="font-medium text-blue-700">
													{formatGhs(product.effectivePriceMinor)}
												</span>
											) : (
												formatGhs(product.effectivePriceMinor)
											)}
										</TableCell>
									) : null}
									<TableCell>
										<ActiveBadge active={product.isActive} />
									</TableCell>
									<TableCell className="text-right">
										<Button variant="ghost" size="sm" asChild>
											<Link to="/catalog/products/$id" params={{ id: product.id }}>
												View
											</Link>
										</Button>
										{canArchive ? (
											<Button variant="ghost" size="sm" onClick={() => setConfirmTarget(product)}>
												{product.isActive ? "Archive" : "Reactivate"}
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />

			<ConfirmDialog
				open={confirmTarget !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmTarget(null)
				}}
				title={confirmTarget?.isActive ? "Archive product?" : "Reactivate product?"}
				description={
					confirmTarget?.isActive
						? "Archived products disappear from pickers and search by default."
						: "The product becomes selectable again everywhere."
				}
				confirmLabel={confirmTarget?.isActive ? "Archive" : "Reactivate"}
				destructive={confirmTarget?.isActive}
				pending={toggleMutation.isPending}
				onConfirm={() => {
					if (confirmTarget) toggleMutation.mutate(confirmTarget)
				}}
			/>
		</section>
	)
}
