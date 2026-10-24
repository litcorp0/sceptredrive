import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { useDebouncedValue } from "#/lib/hooks"
import { getProduct, type Product, productSearchOptions } from "#/modules/catalog"

export interface PickedProduct {
	id: string
	sku: string
	name: string
	costPriceMinor: number
}

/**
 * Debounced product search with a small results list. Cost is loaded from the
 * product detail so receive screens can prefill the unit cost.
 *
 * Lives in `components/common` because three domains use it — inventory, suppliers (supplied
 * products) and payables (invoice lines). Keeping it in `inventory/` would make
 * `suppliers -> inventory` and `payables -> inventory` barrel imports that point back at them,
 * i.e. a cycle. Do not move it back into a module.
 */
export function ProductPicker({
	value,
	onSelect,
	placeholder = "Search products by name or SKU…",
	disabled,
}: {
	value: PickedProduct | null
	onSelect: (product: PickedProduct | null) => void
	placeholder?: string
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const [pendingId, setPendingId] = useState<string | null>(null)
	const debounced = useDebouncedValue(search, 250)
	const query = debounced.trim()

	const resultsQuery = useQuery({
		...productSearchOptions(query),
		enabled: open && query.length > 0,
	})

	const results = useMemo(() => resultsQuery.data?.products ?? [], [resultsQuery.data])

	async function choose(product: Product) {
		setPendingId(product.id)
		try {
			const detail = await getProduct(product.id)
			onSelect({
				id: detail.product.id,
				sku: detail.product.sku,
				name: detail.product.name,
				costPriceMinor: detail.product.costPriceMinor,
			})
		} catch {
			onSelect({
				id: product.id,
				sku: product.sku,
				name: product.name,
				costPriceMinor: 0,
			})
		} finally {
			setPendingId(null)
			setOpen(false)
			setSearch("")
		}
	}

	if (value && !open) {
		return (
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2">
					<p className="truncate text-sm font-medium">{value.name}</p>
					<p className="truncate font-mono text-xs text-muted-foreground">{value.sku}</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => setOpen(true)}
				>
					Change
				</Button>
			</div>
		)
	}

	return (
		<div className="relative">
			<div className="relative">
				<SearchIcon
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					className="pl-8"
					placeholder={placeholder}
					value={search}
					disabled={disabled}
					autoFocus={open}
					onFocus={() => setOpen(true)}
					onChange={(event) => setSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false)
					}}
					aria-label="Search products"
				/>
				<ChevronsUpDownIcon
					className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
			</div>

			{open ? (
				<div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
					{query.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">Type to search products.</p>
					) : resultsQuery.isFetching && results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
					) : results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">No active products found.</p>
					) : (
						<ul aria-label="Product results">
							{results.map((product) => (
								<li key={product.id}>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
										onClick={() => void choose(product)}
										disabled={pendingId !== null}
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{product.name}</span>
											<span className="block truncate font-mono text-xs text-muted-foreground">
												{product.sku}
											</span>
										</span>
										{product.id === value?.id ? (
											<CheckIcon className="size-4" aria-hidden="true" />
										) : null}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
		</div>
	)
}
