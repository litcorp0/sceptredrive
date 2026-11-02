import { formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ChevronLeftIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { StatusBadge } from "#/components/common/status-badge"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { useBranch } from "#/lib/branch-context"
import { branchLabelFor } from "#/lib/branch-label"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { inventoryKeys, openingKeys } from "../api/keys"
import { deleteOpening, openingDetailOptions, postOpening } from "../api/openings"

const authenticatedRoute = getRouteApi("/_authenticated")
const detailRoute = getRouteApi("/_authenticated/inventory/openings/$openingId")

export function OpeningDetailPage() {
	const { openingId } = detailRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [confirmPost, setConfirmPost] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [acknowledgeUncosted, setAcknowledgeUncosted] = useState(false)

	const detailQuery = useQuery(openingDetailOptions(openingId))
	const detail = detailQuery.data

	const postMutation = useMutation({
		mutationFn: () => postOpening(openingId, acknowledgeUncosted),
		onSuccess: async () => {
			toast.success("Opening stock posted")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: openingKeys.all }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
			])
			setConfirmPost(false)
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmPost(false)
		},
	})

	const deleteMutation = useMutation({
		mutationFn: () => deleteOpening(openingId),
		onSuccess: async () => {
			toast.success("Draft deleted")
			await queryClient.invalidateQueries({ queryKey: openingKeys.all })
			await navigate({ to: "/inventory/openings" })
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmDelete(false)
		},
	})

	const back = (
		<Button asChild variant="outline" size="sm">
			<Link to="/inventory/openings">
				<ChevronLeftIcon className="size-4" aria-hidden="true" />
				Back to opening stock
			</Link>
		</Button>
	)

	if (detailQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading opening stock…</p>
	}
	if (detailQuery.isError || !detail) {
		return (
			<section>
				<PageHeader title="Opening stock" actions={back} />
				<p role="alert" className="text-sm text-destructive">
					Could not load this opening, or it is outside your branch.
				</p>
			</section>
		)
	}

	const opening = detail.opening
	const branchLabel = branchLabelFor(branches, {
		id: opening.branchId,
		code: opening.branchCode,
	})
	const isDraft = opening.status === "DRAFT"
	const canPost = hasPermission(session.user.role, "inventory.opening.post")
	const canDraft = hasPermission(session.user.role, "inventory.opening.draft")
	const uncostedBlocked = opening.uncostedLineCount > 0 && !acknowledgeUncosted
	const valueToPost = detail.lines.reduce(
		(sum, line) => sum + Math.max(line.deltaAtDraft, 0) * line.unitCostMinor,
		0,
	)

	return (
		<section>
			<PageHeader
				eyebrow="Inventory"
				title={`Opening stock ${opening.number}`}
				description={`${branchLabel} · counted ${formatDay(opening.countedAt)}`}
				actions={
					<>
						{back}
						{isDraft && canDraft ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setConfirmDelete(true)}
								disabled={deleteMutation.isPending}
							>
								<Trash2Icon className="size-4" aria-hidden="true" />
								Delete draft
							</Button>
						) : null}
						{isDraft && canPost ? (
							<Button
								size="sm"
								onClick={() => setConfirmPost(true)}
								disabled={postMutation.isPending || uncostedBlocked}
							>
								Post opening
							</Button>
						) : null}
					</>
				}
			/>

			{isDraft ? (
				<StatusNote tone="warn" className="mb-4">
					This document is a draft. The ledger has not moved yet; an admin must post it.
				</StatusNote>
			) : (
				<StatusNote tone="ok" className="mb-4">
					Posted {opening.postedAt ? formatDay(opening.postedAt) : ""}
					{opening.postedBy ? ` by ${opening.postedBy}` : ""}. Corrections from here are stock
					counts or write-offs.
				</StatusNote>
			)}

			{opening.uncostedLineCount > 0 ? (
				<StatusNote tone="warn" className="mb-4">
					{opening.uncostedLineCount} line(s) have no cost, so their margin will be unknown.{" "}
					{isDraft ? (
						<label className="mt-1 flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={acknowledgeUncosted}
								onChange={(event) => setAcknowledgeUncosted(event.target.checked)}
							/>
							I understand these lines will be posted uncosted.
						</label>
					) : null}
				</StatusNote>
			) : null}

			<div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm text-muted-foreground">Counted value</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl font-semibold tabular-nums">
						{formatGhs(opening.countedValueMinor)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm text-muted-foreground">
							{isDraft ? "Value to post" : "Posted value"}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl font-semibold tabular-nums">
						{formatGhs(isDraft ? valueToPost : opening.postedValueMinor)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm text-muted-foreground">Units</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl font-semibold tabular-nums">
						{opening.totalUnits}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm text-muted-foreground">New products</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl font-semibold tabular-nums">
						{opening.newProductCount}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between gap-3">
					<CardTitle>Lines</CardTitle>
					<StatusBadge variant={isDraft ? "warn" : "ok"}>
						{isDraft ? "Draft" : "Posted"}
					</StatusBadge>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-12 text-right">#</TableHead>
									<TableHead>Product</TableHead>
									<TableHead>Match</TableHead>
									<TableHead className="text-right">On hand</TableHead>
									<TableHead className="text-right">Counted</TableHead>
									<TableHead className="text-right">Delta</TableHead>
									<TableHead className="text-right">Unit cost</TableHead>
									<TableHead className="text-right">Value</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{detail.lines.length === 0 ? (
									<TableRow>
										<TableCell colSpan={8} className="text-muted-foreground">
											No lines.
										</TableCell>
									</TableRow>
								) : (
									detail.lines.map((line) => (
										<TableRow key={line.id}>
											<TableCell className="text-right font-mono text-xs">{line.lineNo}</TableCell>
											<TableCell>
												<p className="font-medium">{line.productName ?? line.name}</p>
												<p className="text-xs text-muted-foreground">
													{line.productSku ?? line.name}
													{line.barcode ? ` · ${line.barcode}` : ""}
												</p>
												{line.warning ? (
													<p className="mt-1 text-xs text-muted-foreground">{line.warning}</p>
												) : null}
											</TableCell>
											<TableCell>
												<StatusBadge variant={line.isNew ? "info" : "ok"}>
													{line.isNew ? "New" : "Existing"}
												</StatusBadge>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{line.onHandAtDraft}
											</TableCell>
											<TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
											<TableCell className="text-right tabular-nums">
												{line.deltaAtDraft > 0 ? "+" : ""}
												{line.deltaAtDraft}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.unitCostMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(line.quantity * line.unitCostMinor)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<ConfirmDialog
				open={confirmPost}
				onOpenChange={setConfirmPost}
				title="Post this opening?"
				description="This appends the opening movements to the ledger, creates any new products, and cannot be undone. Corrections afterwards are stock counts."
				confirmLabel="Post opening"
				pending={postMutation.isPending}
				onConfirm={() => postMutation.mutate()}
			/>

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete this draft?"
				description="The draft and its rows are removed. No stock movement is posted."
				confirmLabel="Delete draft"
				destructive
				pending={deleteMutation.isPending}
				onConfirm={() => deleteMutation.mutate()}
			/>
		</section>
	)
}
