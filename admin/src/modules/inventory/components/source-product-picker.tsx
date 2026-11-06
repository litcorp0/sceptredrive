import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Input } from "#/components/ui/input"
import { useDebouncedValue } from "#/lib/hooks"
import { sourceStockOptions } from "../api/transfers"
import type { SourceStockProduct } from "../types"

export interface PickedSourceProduct {
	id: string
	sku: string
	name: string
	/**
	 * What the source branch holds right now (P20-D18).
	 *
	 * Optional because an existing draft's line was picked before this screen existed, and
	 * inventing a number for it would either block a valid edit or invite a bad one.
	 */
	available?: number
}

/**
 * Picks a product **from what one branch can give** (P20-D18).
 *
 * Not the shared catalogue picker: a transfer line is a different question from "which
 * product is this". The source's shelf decides the answer, so the search runs against that
 * branch's stock and each result says how much is there. Products with none are hidden by
 * default — the Acumatica "Show Available Items Only" pattern — with a switch to see them,
 * because "we don't have it" is still information.
 *
 * The number travels with the picked product so the line can refuse a quantity the shelf
 * cannot cover, before the API has to.
 */
export function SourceProductPicker({
	branchId,
	value,
	onSelect,
	disabled,
}: {
	branchId: string | undefined
	value: PickedSourceProduct | null
	onSelect: (product: PickedSourceProduct | null) => void
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const [showEmpty, setShowEmpty] = useState(false)
	const debounced = useDebouncedValue(search, 250)
	const query = debounced.trim()

	const resultsQuery = useQuery({
		...sourceStockOptions(branchId, query, showEmpty),
		enabled: Boolean(branchId) && open && query.length > 0,
	})

	const results = useMemo(() => resultsQuery.data?.products ?? [], [resultsQuery.data])

	function choose(product: SourceStockProduct) {
		onSelect({
			id: product.productId,
			sku: product.sku,
			name: product.name,
			available: product.quantityOnHand,
		})
		setOpen(false)
		setSearch("")
	}

	if (value && !open) {
		return (
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2">
					<p className="truncate text-sm font-medium">{value.name}</p>
					<p className="truncate font-mono text-xs text-muted-foreground">
						{value.sku} · {value.available} at the source
					</p>
				</div>
				{disabled ? null : (
					<button
						type="button"
						className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
						onClick={() => setOpen(true)}
					>
						Change
					</button>
				)}
			</div>
		)
	}

	return (
		<div className="relative">
			<div className="relative">
				<Input
					aria-label="Search the source branch's stock"
					placeholder={
						branchId ? "Search the source branch's stock…" : "Choose a source branch first"
					}
					disabled={disabled || !branchId}
					value={search}
					onFocus={() => setOpen(true)}
					onChange={(event) => {
						setSearch(event.target.value)
						setOpen(true)
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false)
					}}
				/>
				<ChevronsUpDownIcon
					className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
			</div>

			{open && branchId ? (
				<label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
					<input
						type="checkbox"
						className="size-3.5"
						checked={showEmpty}
						onChange={(event) => setShowEmpty(event.target.checked)}
					/>
					Show products with none in stock
				</label>
			) : null}

			{open && branchId ? (
				<div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
					{query.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">
							Type to search what this branch holds.
						</p>
					) : resultsQuery.isFetching && results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
					) : results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">
							{showEmpty
								? "No active products found."
								: "Nothing matching is in stock at that branch."}
						</p>
					) : (
						<ul aria-label="Source stock results">
							{results.map((product) => (
								<li key={product.productId}>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
										onClick={() => choose(product)}
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{product.name}</span>
											<span className="block truncate font-mono text-xs text-muted-foreground">
												{product.sku}
											</span>
										</span>
										<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
											{product.quantityOnHand} on hand
										</span>
										{product.productId === value?.id ? (
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
