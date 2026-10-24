import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { api } from "#/lib/api"
import type { PriceOverride } from "#/lib/api-types"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import type { Branch } from "#/modules/branches"

export function PriceOverrides({
	productId,
	basePriceMinor,
	branches,
	canOverride,
	disabled = false,
}: {
	productId: string
	basePriceMinor: number
	branches: Array<Pick<Branch, "id" | "code" | "name">>
	canOverride: boolean
	disabled?: boolean
}) {
	const pricesQuery = useQuery({
		queryKey: ["product-prices", productId],
		queryFn: () => api.products.prices.list(productId),
	})

	const overrides = pricesQuery.data?.overrides ?? []

	return (
		<div className="rounded-lg border bg-card">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
				<div>
					<h3 className="text-sm font-medium">Branch price overrides</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						An override replaces the base price for one branch. Base: {formatGhs(basePriceMinor)}.
					</p>
				</div>
				<StatusBadge tone={overrides.length > 0 ? "blue" : "zinc"}>
					{overrides.length} override{overrides.length === 1 ? "" : "s"}
				</StatusBadge>
			</div>

			{pricesQuery.isLoading ? (
				<p className="px-4 py-6 text-sm text-muted-foreground">Loading overrides…</p>
			) : pricesQuery.isError ? (
				<p className="px-4 py-6 text-sm text-destructive">Couldn't load price overrides.</p>
			) : branches.length === 0 ? (
				<p className="px-4 py-6 text-sm text-muted-foreground">No active branches.</p>
			) : (
				<div className="divide-y">
					{branches.map((branch) => (
						<OverrideRow
							key={branch.id}
							productId={productId}
							branch={branch}
							basePriceMinor={basePriceMinor}
							override={overrides.find((item) => item.branchId === branch.id) ?? null}
							canOverride={canOverride}
							disabled={disabled}
						/>
					))}
				</div>
			)}
		</div>
	)
}

function OverrideRow({
	productId,
	branch,
	basePriceMinor,
	override,
	canOverride,
	disabled,
}: {
	productId: string
	branch: Pick<Branch, "id" | "code" | "name">
	basePriceMinor: number
	override: PriceOverride | null
	canOverride: boolean
	disabled: boolean
}) {
	const queryClient = useQueryClient()
	const [value, setValue] = useState("")
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		setValue(override ? formatMinorPlain(override.priceMinor) : "")
		setError(null)
	}, [override])

	const effectiveMinor = override ? override.priceMinor : basePriceMinor

	async function invalidate() {
		await queryClient.invalidateQueries({ queryKey: ["product-prices", productId] })
		await queryClient.invalidateQueries({ queryKey: ["products"] })
		await queryClient.invalidateQueries({ queryKey: ["product", productId] })
	}

	const saveMutation = useMutation({
		mutationFn: () => {
			const priceMinor = parseGhsToMinor(value)
			if (priceMinor === null) throw new Error("Enter a valid amount, e.g. 95.00")
			return api.products.prices.set(productId, { branchId: branch.id, priceMinor })
		},
		onSuccess: async () => {
			toast.success(`Override saved for ${branch.code}`)
			await invalidate()
		},
		onError: (error) => {
			if (error instanceof Error && !("status" in error)) {
				setError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const removeMutation = useMutation({
		mutationFn: () => api.products.prices.remove(productId, branch.id),
		onSuccess: async () => {
			toast.success(`Override removed for ${branch.code}`)
			await invalidate()
		},
		onError: (error) => toastApiError(error),
	})

	const pending = saveMutation.isPending || removeMutation.isPending

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		saveMutation.mutate()
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-36 flex-1">
				<p className="text-sm font-medium">{branch.name}</p>
				<p className="font-mono text-xs text-muted-foreground">{branch.code}</p>
			</div>

			<p className="text-xs text-muted-foreground">
				Effective: <span className="tabular-nums">{formatGhs(effectiveMinor)}</span>
				{override ? "" : " (base)"}
			</p>

			<div className="flex items-center gap-2">
				<div className="relative">
					<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
						GHS
					</span>
					<Input
						className="h-8 w-32 pl-10 tabular-nums"
						placeholder={formatMinorPlain(basePriceMinor)}
						value={value}
						disabled={!canOverride || disabled || pending}
						onChange={(event) => {
							setValue(event.target.value)
							setError(null)
						}}
						aria-label={`Override price for ${branch.name}`}
					/>
				</div>
				<Button
					type="submit"
					size="sm"
					disabled={!canOverride || disabled || pending || value.trim().length === 0}
				>
					{pending ? "Saving…" : "Save"}
				</Button>
				{override && canOverride ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled || pending}
						onClick={() => removeMutation.mutate()}
					>
						Remove
					</Button>
				) : null}
			</div>

			{error ? (
				<p role="alert" className="w-full text-xs text-destructive">
					{error}
				</p>
			) : null}
			{!canOverride ? (
				<p className="w-full text-xs text-amber-600">
					You don't have permission to change prices for this branch.
				</p>
			) : null}
		</form>
	)
}
