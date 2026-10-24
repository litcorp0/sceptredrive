import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { api } from "#/lib/api"
import type { SupplierListRow } from "#/lib/api-types"
import { useDebouncedValue } from "#/lib/hooks"

export interface PickedSupplier {
	id: string
	code: string
	name: string
	paymentTermDays: number
}

/**
 * Debounced supplier search used by payables filters and forms. Only active
 * suppliers can take new documents, so the list defaults to active rows.
 *
 * Lives in `components/common` because three domains use it — suppliers, inventory (receiving)
 * and payables (invoices and payments). Keeping it in `suppliers/` would make
 * `inventory -> suppliers` and `payables -> suppliers` module-barrel imports that point back at
 * them, i.e. a cycle. Do not move it back into a module.
 */
export function SupplierCombobox({
	value,
	onSelect,
	placeholder = "Search suppliers by name or code…",
	disabled,
}: {
	value: PickedSupplier | null
	onSelect: (supplier: PickedSupplier | null) => void
	placeholder?: string
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const debounced = useDebouncedValue(search, 250)
	const query = debounced.trim()

	const resultsQuery = useQuery({
		queryKey: ["supplier-combobox", query],
		queryFn: () => api.suppliers.list({ q: query, pageSize: 8 }),
		enabled: open && query.length >= 2,
	})

	const results = resultsQuery.data?.suppliers ?? []

	function choose(supplier: SupplierListRow) {
		onSelect({
			id: supplier.id,
			code: supplier.code,
			name: supplier.name,
			paymentTermDays: supplier.paymentTermDays,
		})
		setOpen(false)
		setSearch("")
	}

	if (value && !open) {
		return (
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2">
					<p className="truncate text-sm font-medium">{value.name}</p>
					<p className="truncate font-mono text-xs text-muted-foreground">{value.code}</p>
				</div>
				{disabled ? null : (
					<Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
						Change
					</Button>
				)}
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
					aria-label="Search suppliers"
				/>
				<ChevronsUpDownIcon
					className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
			</div>

			{open ? (
				<div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
					{query.length < 2 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">
							Type at least two characters to search.
						</p>
					) : resultsQuery.isFetching && results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
					) : results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">No active suppliers found.</p>
					) : (
						<ul aria-label="Supplier results">
							{results.map((supplier) => (
								<li key={supplier.id}>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
										onClick={() => choose(supplier)}
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{supplier.name}</span>
											<span className="block truncate font-mono text-xs text-muted-foreground">
												{supplier.code}
											</span>
										</span>
										{supplier.id === value?.id ? (
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
