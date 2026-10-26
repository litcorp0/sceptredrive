import { priceBandBounds, withinPriceBand } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { StatusBadge } from "#/components/common/status-badge"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { type ApprovalListRow, approvalKeys, approvalListOptions } from "#/modules/approvals"
import type { Branch } from "#/modules/branches"
import { catalogKeys } from "../api/keys"
import { productPricesOptions, removeProductPrice, setProductPrice } from "../api/products"
import type { PriceWriteResult, ProductPriceBandRow } from "../types"

/**
 * Branch price overrides, with the manager band the API publishes.
 *
 * The band percentage and each row's bounds arrive on `GET /api/products/:id/prices`. Inside the
 * band the change applies; outside it becomes a `PRICE_CHANGE` request. An admin is exempt from
 * the band and sees no band copy. A response of `PENDING_APPROVAL` is linked to its approval, and
 * the row says it is waiting.
 */
export function PriceOverrides({
	productId,
	basePriceMinor,
	branches,
	canOverride,
	isAdmin,
	disabled = false,
}: {
	productId: string
	basePriceMinor: number
	branches: Array<Pick<Branch, "id" | "code" | "name">>
	canOverride: boolean
	isAdmin: boolean
	disabled?: boolean
}) {
	const pricesQuery = useQuery(productPricesOptions(productId))

	const pendingQuery = useQuery({
		...approvalListOptions({
			type: "PRICE_CHANGE",
			status: "PENDING",
			entityId: productId,
			limit: 10,
			offset: 0,
		}),
		enabled: !isAdmin,
	})

	const overrides = pricesQuery.data?.overrides ?? []
	const managerBandPercent = pricesQuery.data?.managerBandPercent ?? 0
	const pendingByBranch = new Map<string, ApprovalListRow>()
	if (!isAdmin) {
		for (const approval of pendingQuery.data?.approvals ?? []) {
			pendingByBranch.set(approval.branchId, approval)
		}
	}

	return (
		<div className="rounded-lg border bg-card">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
				<div>
					<h3 className="text-sm font-medium">Branch price overrides</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						An override replaces the base price for one branch. Base: {formatGhs(basePriceMinor)}.
					</p>
				</div>
				<StatusBadge variant={overrides.length > 0 ? "info" : "muted"}>
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
							managerBandPercent={managerBandPercent}
							override={overrides.find((item) => item.branchId === branch.id) ?? null}
							pending={pendingByBranch.get(branch.id) ?? null}
							canOverride={canOverride}
							isAdmin={isAdmin}
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
	managerBandPercent,
	override,
	pending,
	canOverride,
	isAdmin,
	disabled,
}: {
	productId: string
	branch: Pick<Branch, "id" | "code" | "name">
	basePriceMinor: number
	managerBandPercent: number
	override: ProductPriceBandRow | null
	pending: ApprovalListRow | null
	canOverride: boolean
	isAdmin: boolean
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
	const bounds = override?.bounds ?? priceBandBounds(basePriceMinor, managerBandPercent)
	const proposedMinor = parseGhsToMinor(value)
	const outsideBand =
		!isAdmin &&
		proposedMinor !== null &&
		!withinPriceBand(effectiveMinor, proposedMinor, managerBandPercent)
	const removalOutsideBand =
		!isAdmin && !withinPriceBand(effectiveMinor, basePriceMinor, managerBandPercent)
	const waiting = !isAdmin && pending !== null

	async function invalidate() {
		await queryClient.invalidateQueries({ queryKey: catalogKeys.productPrices(productId) })
		await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
		await queryClient.invalidateQueries({ queryKey: catalogKeys.productDetail(productId) })
		await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
	}

	function announce(result: PriceWriteResult) {
		if (result.status === "PENDING_APPROVAL") {
			toast.success("Price change requested", {
				description: (
					<Link
						to="/approvals/$approvalId"
						params={{ approvalId: result.approvalId }}
						className="font-medium text-primary hover:underline"
					>
						Review the request
					</Link>
				),
			})
			return
		}
		toast.success(`Price saved for ${branch.code}`)
	}

	const saveMutation = useMutation({
		mutationFn: () => {
			const priceMinor = parseGhsToMinor(value)
			if (priceMinor === null) throw new Error("Enter a valid amount, e.g. 95.00")
			return setProductPrice(productId, { branchId: branch.id, priceMinor })
		},
		onSuccess: async (result) => {
			announce(result)
			await invalidate()
		},
		onError: (mutationError) => {
			if (mutationError instanceof Error && !("status" in mutationError)) {
				setError(mutationError.message)
				return
			}
			toastApiError(mutationError)
		},
	})

	const removeMutation = useMutation({
		mutationFn: () => removeProductPrice(productId, branch.id),
		onSuccess: async (result) => {
			announce(result)
			await invalidate()
		},
		onError: (mutationError) => toastApiError(mutationError),
	})

	const busy = saveMutation.isPending || removeMutation.isPending
	const lockRow = busy || waiting

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		saveMutation.mutate()
	}

	return (
		<form onSubmit={handleSubmit} className="grid gap-3 px-4 py-3">
			<div className="flex flex-wrap items-center gap-3">
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
							disabled={!canOverride || disabled || lockRow}
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
						disabled={
							!canOverride ||
							disabled ||
							lockRow ||
							value.trim().length === 0 ||
							proposedMinor === null
						}
					>
						{busy ? "Saving…" : outsideBand ? "Request price change" : "Save price"}
					</Button>
					{override && canOverride ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={disabled || lockRow}
							onClick={() => removeMutation.mutate()}
						>
							{busy ? "Saving…" : removalOutsideBand ? "Request removal" : "Remove"}
						</Button>
					) : null}
				</div>
			</div>

			{!isAdmin ? (
				<p className="text-xs text-muted-foreground">
					Between {formatGhs(bounds.minMinor)} and {formatGhs(bounds.maxMinor)}.
				</p>
			) : null}

			{outsideBand ? (
				<StatusNote tone="warn" className="w-full">
					This is outside the {managerBandPercent}% manager band, so it becomes a price-change
					request an admin decides. Between {formatGhs(bounds.minMinor)} and{" "}
					{formatGhs(bounds.maxMinor)}.
				</StatusNote>
			) : null}

			{waiting && pending ? (
				<StatusNote tone="info" className="w-full">
					Waiting for approval.{" "}
					<Link
						to="/approvals/$approvalId"
						params={{ approvalId: pending.id }}
						className="font-medium text-primary hover:underline"
					>
						Review the request
					</Link>
				</StatusNote>
			) : null}

			{error ? (
				<p role="alert" className="w-full text-xs text-destructive">
					{error}
				</p>
			) : null}
			{!canOverride ? (
				<p className="w-full text-xs text-muted-foreground">
					You don't have permission to change prices for this branch.
				</p>
			) : null}
		</form>
	)
}
