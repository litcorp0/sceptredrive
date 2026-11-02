import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Inbox, ShieldAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Skeleton } from "#/components/ui/skeleton"
import { ApiError } from "#/lib/api"
import { productDetailOptions } from "#/modules/catalog"
import { AdjustDialog } from "#/modules/inventory"
import { approvalDetailOptions } from "../api/approvals"
import { ApprovalDetailPanel } from "../components/approval-detail-panel"
import { typeLabel } from "../utils/approval"

const routeApi = getRouteApi("/_authenticated/approvals/$approvalId")

/** One request, its evidence, and the decision controls the server says this actor may use. */
export function ApprovalDetailPage() {
	const { approvalId } = routeApi.useParams()
	const detailQuery = useQuery({ ...approvalDetailOptions(approvalId), retry: false })
	const [adjustOpen, setAdjustOpen] = useState(false)

	const error = detailQuery.error
	const denied = error instanceof ApiError && error.status === 403
	const missing = error instanceof ApiError && error.status === 404

	const approval = detailQuery.data?.approval
	const approvedProductId =
		approval?.type === "PRODUCT_CREATE" && approval.status === "APPROVED" ? approval.entityId : null
	const productQuery = useQuery({
		...productDetailOptions(approvedProductId ?? ""),
		enabled: approvedProductId !== null,
	})
	const pickedProduct = useMemo(
		() =>
			productQuery.data
				? {
						id: productQuery.data.product.id,
						sku: productQuery.data.product.sku,
						name: productQuery.data.product.name,
						costPriceMinor: productQuery.data.product.costPriceMinor,
					}
				: null,
		[productQuery.data],
	)

	const productProposal =
		detailQuery.data?.subject.kind === "product" ? detailQuery.data.subject.proposal : null
	const openingQuantity =
		typeof productProposal === "object" && productProposal !== null
			? (productProposal as Record<string, unknown>).openingQuantity
			: undefined
	const hadOpeningStock = typeof openingQuantity === "number" && openingQuantity > 0

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Operations"
				title={detailQuery.data ? typeLabel(detailQuery.data.approval.type) : "Request"}
				description="The evidence behind the decision, rendered from the subject the API loaded for this request."
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/approvals">Back to the inbox</Link>
					</Button>
				}
			/>

			{detailQuery.isLoading ? (
				<div className="grid gap-3" aria-busy="true">
					<output className="sr-only">Loading the request</output>
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-48 w-full" />
				</div>
			) : denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see this request"
					description="It belongs to a branch your role does not cover. The API refuses the read; the console does not guess at the answer."
				/>
			) : missing ? (
				<EmptyState
					icon={Inbox}
					title="Request not found"
					description="It may have been removed, or the link may be wrong. Return to the inbox to see what is waiting."
				/>
			) : detailQuery.isError || !detailQuery.data ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">Couldn't load this request.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The server did not answer. Try again in a moment.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void detailQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<>
					{/* 18-05: approving a product creates a catalogue row, not stock. Say so
					    where the decision was just made, so the item cannot sit invisible. */}
					{detailQuery.data.approval.type === "PRODUCT_CREATE" &&
					detailQuery.data.approval.status === "APPROVED" &&
					!hadOpeningStock ? (
						<StatusNote tone="info">
							The product exists but has no stock yet, so the till will treat it as out of stock.{" "}
							<Link to="/inventory" className="font-medium text-primary hover:underline">
								Record a receipt or opening stock
							</Link>{" "}
							before selling it.
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="ml-2"
								onClick={() => setAdjustOpen(true)}
							>
								Open stock now
							</Button>
						</StatusNote>
					) : null}
					<ApprovalDetailPanel detail={detailQuery.data} />
					<AdjustDialog
						open={adjustOpen}
						onOpenChange={setAdjustOpen}
						branchId={detailQuery.data.approval.branchId}
						branchName={null}
						initialProduct={pickedProduct}
					/>
				</>
			)}
		</div>
	)
}
