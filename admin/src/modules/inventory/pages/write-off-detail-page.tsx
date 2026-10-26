import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"
import { writeOffKeys } from "../api/keys"
import { cancelWriteOff, writeOffDetailOptions } from "../api/writeoffs"
import { WriteOffDetail } from "../components/write-off-detail"

const authenticatedRoute = getRouteApi("/_authenticated")
const detailRoute = getRouteApi("/_authenticated/inventory/write-offs/$writeOffId")

/**
 * One write-off, its frozen lines and its decision.
 *
 * Withdrawing is offered only to the requester while the document is pending: the server enforces
 * that, and the console compares the same `requestedBy` label rather than guessing from the role.
 */
export function WriteOffDetailPage() {
	const { writeOffId } = detailRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const queryClient = useQueryClient()
	const [confirmOpen, setConfirmOpen] = useState(false)

	const detailQuery = useQuery(writeOffDetailOptions(writeOffId))
	const detail = detailQuery.data

	const cancelMutation = useMutation({
		mutationFn: () => cancelWriteOff(writeOffId),
		onSuccess: async () => {
			toast.success("Write-off withdrawn")
			await queryClient.invalidateQueries({ queryKey: writeOffKeys.all })
			await queryClient.invalidateQueries({ queryKey: writeOffKeys.detail(writeOffId) })
			setConfirmOpen(false)
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmOpen(false)
		},
	})

	const back = (
		<Button asChild variant="outline" size="sm">
			<Link to="/inventory/write-offs">
				<ChevronLeftIcon className="size-4" aria-hidden="true" />
				Back to write-offs
			</Link>
		</Button>
	)

	if (detailQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading write-off…</p>
	}
	if (detailQuery.isError || !detail) {
		return (
			<section>
				<PageHeader title="Write-off" actions={back} />
				<p role="alert" className="text-sm text-destructive">
					Could not load this write-off, or it is outside your branch.
				</p>
			</section>
		)
	}

	const writeOff = detail.writeOff
	const branchName =
		branches.find((branch) => branch.id === writeOff.branchId)?.name ?? writeOff.branchName
	const actorLabel = session.user.staffId ?? session.user.id
	const canWithdraw =
		writeOff.status === "PENDING_APPROVAL" && writeOff.requestedBy === actorLabel

	return (
		<section>
			<PageHeader
				eyebrow="Inventory"
				title={`Write-off ${writeOff.number}`}
				description={`${branchName} · raised complete; the admin's decision posts the movements.`}
				actions={back}
			/>

			<WriteOffDetail
				detail={detail}
				branchName={branchName}
				canWithdraw={canWithdraw}
				withdrawing={cancelMutation.isPending}
				onWithdraw={() => setConfirmOpen(true)}
			/>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title="Withdraw this write-off?"
				description="The document is marked cancelled and leaves the admin's queue. No stock movement is posted."
				confirmLabel="Withdraw write-off"
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => cancelMutation.mutate()}
			/>
		</section>
	)
}
