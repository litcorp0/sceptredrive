import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeftIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { StatusBadge } from "#/components/common/status-badge"
import { CountStatusBadge } from "#/components/inventory/count-status-badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError, api } from "#/lib/api"
import type { StockCountLine } from "#/lib/api-types"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/inventory/counts/$countId")({
	component: CountDetailPage,
})

function parseCounted(raw: string | undefined): number | null | "invalid" {
	if (raw === undefined || raw.trim() === "") return null
	const value = Number.parseInt(raw, 10)
	if (!Number.isSafeInteger(value) || value < 0) return "invalid"
	return value
}

function CountDetailPage() {
	const { countId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const queryClient = useQueryClient()
	const canCount = hasPermission(session.user.role, "inventory.count")

	const [values, setValues] = useState<Record<string, string>>({})
	const [search, setSearch] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [postOpen, setPostOpen] = useState(false)
	const [cancelOpen, setCancelOpen] = useState(false)

	const countQuery = useQuery({
		queryKey: ["count", countId],
		queryFn: () => api.counts.get(countId),
	})

	const count = countQuery.data?.count
	const isOpen = count?.status === "OPEN"
	const lines = useMemo(() => count?.lines ?? [], [count])

	useEffect(() => {
		if (!count || count.status !== "OPEN") return
		setValues(
			Object.fromEntries(
				(count.lines ?? []).map((line) => [
					line.productId,
					line.countedQty === null ? "" : String(line.countedQty),
				]),
			),
		)
	}, [count])

	const filteredLines = useMemo(() => {
		const term = search.trim().toLowerCase()
		if (!term) return lines
		return lines.filter(
			(line) =>
				line.productName.toLowerCase().includes(term) || line.sku.toLowerCase().includes(term),
		)
	}, [lines, search])

	const summary = useMemo(() => {
		let counted = 0
		let shortageUnits = 0
		let overageUnits = 0
		let invalid = false
		for (const line of lines) {
			const parsed = parseCounted(values[line.productId])
			if (parsed === "invalid") invalid = true
			if (parsed === null || parsed === "invalid") continue
			counted += 1
			const variance = parsed - line.snapshotQty
			if (variance < 0) shortageUnits += Math.abs(variance)
			if (variance > 0) overageUnits += variance
		}
		return { counted, shortageUnits, overageUnits, invalid }
	}, [lines, values])

	function buildLines(): { productId: string; countedQty: number | null }[] | null {
		const payload: { productId: string; countedQty: number | null }[] = []
		for (const line of lines) {
			const parsed = parseCounted(values[line.productId])
			if (parsed === "invalid") {
				setFormError(`Enter a whole counted quantity for ${line.productName}.`)
				return null
			}
			payload.push({ productId: line.productId, countedQty: parsed })
		}
		return payload
	}

	async function invalidate() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["count", countId] }),
			queryClient.invalidateQueries({ queryKey: ["counts"] }),
		])
	}

	const saveMutation = useMutation({
		mutationFn: async () => {
			const payload = buildLines()
			if (!payload) throw new Error("invalid")
			return api.counts.updateLines(countId, payload)
		},
		onSuccess: async () => {
			toast.success("Count progress saved")
			setFormError(null)
			await invalidate()
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				setFormError(error.message)
				return
			}
			if (error.message !== "invalid") toastApiError(error)
		},
	})

	const postMutation = useMutation({
		mutationFn: async () => {
			const payload = buildLines()
			if (!payload) throw new Error("invalid")
			await api.counts.updateLines(countId, payload)
			return api.counts.post(countId)
		},
		onSuccess: async () => {
			toast.success("Stock count posted")
			setPostOpen(false)
			setFormError(null)
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({ queryKey: ["inventory-stock"] }),
				queryClient.invalidateQueries({ queryKey: ["inventory-movements"] }),
			])
		},
		onError: (error) => {
			setPostOpen(false)
			if (error instanceof ApiError) {
				setFormError(error.message)
				return
			}
			if (error.message !== "invalid") toastApiError(error)
		},
	})

	const cancelMutation = useMutation({
		mutationFn: () => api.counts.cancel(countId),
		onSuccess: async () => {
			toast.success("Count cancelled")
			setCancelOpen(false)
			await invalidate()
		},
		onError: (error) => {
			toastApiError(error)
			setCancelOpen(false)
		},
	})

	if (countQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading count…</p>
	}
	if (countQuery.isError || !count) {
		return <p className="text-sm text-destructive">Could not load this stock count.</p>
	}

	function varianceCell(line: StockCountLine, open: boolean) {
		if (!open) {
			if (line.variance === null) return <span className="text-muted-foreground">—</span>
			if (line.variance === 0) return <StatusBadge tone="zinc">OK</StatusBadge>
			return (
				<StatusBadge tone={line.variance < 0 ? "red" : "green"}>
					{line.variance > 0 ? "+" : ""}
					{line.variance}
				</StatusBadge>
			)
		}

		const parsed = parseCounted(values[line.productId])
		if (parsed === null) return <span className="text-muted-foreground">—</span>
		if (parsed === "invalid") return <StatusBadge tone="red">Invalid</StatusBadge>
		const variance = parsed - line.snapshotQty
		if (variance === 0) return <StatusBadge tone="zinc">OK</StatusBadge>
		return (
			<StatusBadge tone={variance < 0 ? "red" : "green"}>
				{variance > 0 ? "+" : ""}
				{variance}
			</StatusBadge>
		)
	}

	return (
		<section>
			<PageHeader
				title={`Count ${count.number}`}
				description={`${count.branchCode} · ${count.branchName}${
					count.note ? ` · ${count.note}` : ""
				}`}
				actions={
					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline" size="sm">
							<Link to="/inventory/counts">
								<ChevronLeftIcon className="size-4" aria-hidden="true" />
								Back
							</Link>
						</Button>
						{isOpen && canCount ? (
							<>
								<Button
									size="sm"
									variant="outline"
									disabled={saveMutation.isPending || postMutation.isPending}
									onClick={() => saveMutation.mutate()}
								>
									{saveMutation.isPending ? "Saving…" : "Save progress"}
								</Button>
								<Button size="sm" onClick={() => setPostOpen(true)}>
									Post count
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="text-destructive"
									onClick={() => setCancelOpen(true)}
								>
									Cancel count
								</Button>
							</>
						) : null}
					</div>
				}
			/>

			<div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
				<CountStatusBadge status={count.status} />
				<span>Opened {new Date(count.createdAt).toLocaleString("en-GH")}</span>
				{count.postedAt ? (
					<span>Posted {new Date(count.postedAt).toLocaleString("en-GH")}</span>
				) : null}
				<span>
					{count.lineCount} lines · {isOpen ? summary.counted : count.countedCount} counted
				</span>
				{isOpen ? (
					<span>
						Shortage {summary.shortageUnits} · Overage {summary.overageUnits}
					</span>
				) : (
					<span>
						Variance {count.varianceUnits > 0 ? "+" : ""}
						{count.varianceUnits} units
					</span>
				)}
			</div>

			{formError ? (
				<p
					role="alert"
					className="mb-3 rounded-md border border-destructive/40 bg-red-50 p-3 text-sm text-destructive"
				>
					{formError}
				</p>
			) : null}

			<div className="relative mb-3 max-w-sm">
				<SearchIcon
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					className="pl-8"
					placeholder="Filter count lines…"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					aria-label="Filter count lines"
				/>
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>SKU</TableHead>
							<TableHead>Product</TableHead>
							<TableHead className="text-right">Snapshot</TableHead>
							<TableHead className="w-40 text-right">Counted</TableHead>
							<TableHead className="text-right">Variance</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filteredLines.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground">
									No lines match this filter.
								</TableCell>
							</TableRow>
						) : (
							filteredLines.map((line) => (
								<TableRow key={line.id}>
									<TableCell className="font-mono text-xs">{line.sku}</TableCell>
									<TableCell className="font-medium">{line.productName}</TableCell>
									<TableCell className="text-right tabular-nums">{line.snapshotQty}</TableCell>
									<TableCell className="text-right">
										{isOpen && canCount ? (
											<Input
												inputMode="numeric"
												className="ml-auto w-28 text-right"
												value={values[line.productId] ?? ""}
												onChange={(event) =>
													setValues((current) => ({
														...current,
														[line.productId]: event.target.value,
													}))
												}
												aria-label={`Counted quantity for ${line.productName}`}
												placeholder="—"
											/>
										) : (
											<span className="tabular-nums">{line.countedQty ?? "—"}</span>
										)}
									</TableCell>
									<TableCell className="text-right">{varianceCell(line, isOpen)}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<ConfirmDialog
				open={postOpen}
				onOpenChange={setPostOpen}
				title="Post this stock count?"
				description={
					<>
						{summary.counted} counted line{summary.counted === 1 ? "" : "s"} will post as
						compensating movements: {summary.shortageUnits} shortage and {summary.overageUnits}{" "}
						overage unit{summary.overageUnits === 1 ? "" : "s"}. Posting cannot be undone;
						corrections become new adjustments.
					</>
				}
				confirmLabel="Post count"
				pending={postMutation.isPending}
				onConfirm={() => postMutation.mutate()}
			/>

			<ConfirmDialog
				open={cancelOpen}
				onOpenChange={setCancelOpen}
				title="Cancel this count?"
				description="The count is kept for history and can no longer be edited or posted."
				confirmLabel="Cancel count"
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => cancelMutation.mutate()}
			/>
		</section>
	)
}
