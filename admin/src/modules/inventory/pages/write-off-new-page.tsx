import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { useBranch } from "#/lib/branch-context"
import { AdjustDialog } from "../components/adjust-dialog"
import { WriteOffForm } from "../components/write-off-form"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * The write-off request form, for a branch manager.
 *
 * An admin has nobody to approve them, so their direct path is a reason-coded negative
 * adjustment (P12-D3). The admin never sees this form: the page renders the adjustment screen the
 * API points them at instead.
 */
export function WriteOffNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranch, activeBranchId } = useBranch()
	const [adjustOpen, setAdjustOpen] = useState(false)

	const isAdmin = session.user.role === "ADMIN"
	const branchId = activeBranchId ?? session.user.branchId ?? null

	const back = (
		<Button asChild variant="outline" size="sm">
			<Link to="/inventory/write-offs">
				<ChevronLeftIcon className="size-4" aria-hidden="true" />
				Back to write-offs
			</Link>
		</Button>
	)

	if (isAdmin) {
		return (
			<section className="mx-auto max-w-3xl">
				<PageHeader
					eyebrow="Inventory"
					title="Adjust stock directly"
					description="An administrator does not raise a write-off for approval; the direct adjustment is reason-coded, audited and posted immediately."
					actions={back}
				/>

				<StatusNote tone="info" title="No approval needed">
					Write-off requests are for branch managers. Your direct path is a negative adjustment
					with a reason code, recorded in the stock ledger as one audited movement.
				</StatusNote>

				<Card className="mt-4">
					<CardHeader>
						<CardTitle>Post a negative adjustment</CardTitle>
						<CardDescription>
							Choose the product, the quantity and the reason. The ledger keeps the movement; the
							average cost is unchanged.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => setAdjustOpen(true)} disabled={!branchId}>
							Open the adjustment form
						</Button>
						<Button asChild variant="outline">
							<Link to="/inventory/stock">Go to stock</Link>
						</Button>
						{!branchId ? (
							<p className="w-full text-xs text-muted-foreground">
								Choose a branch in the header before adjusting stock.
							</p>
						) : null}
					</CardContent>
				</Card>

				<AdjustDialog
					open={adjustOpen}
					onOpenChange={setAdjustOpen}
					branchId={branchId}
					branchName={activeBranch?.name ?? null}
				/>
			</section>
		)
	}

	return (
		<section className="mx-auto max-w-3xl">
			<PageHeader
				eyebrow="Inventory"
				title="New write-off"
				description="Record goods that left the shelf without a sale. The document is raised complete; an admin approves it before anything is posted."
				actions={back}
			/>

			{branchId ? (
				<WriteOffForm branchId={branchId} branchName={activeBranch?.name ?? null} />
			) : (
				<StatusNote tone="danger">
					Your account has no branch, so a write-off cannot be raised.
				</StatusNote>
			)}
		</section>
	)
}
