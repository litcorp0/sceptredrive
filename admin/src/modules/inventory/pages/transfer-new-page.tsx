import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { type FormEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"
import { branchDirectoryOptions } from "#/modules/branches"
import { transferKeys } from "../api/keys"
import { createTransfer } from "../api/transfers"
import {
	newTransferLine,
	type TransferLineDraft,
	TransferLinesEditor,
} from "../components/transfer-lines-editor"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * An admin drafts a transfer; a manager asks the source branch for stock.
 *
 * The manager's destination is fixed to their own branch because that is the only request the
 * API accepts (P12-D10). The `from` choice is the manager's, and the source branch decides before
 * anything moves — the note below the picker says so, and the detail repeats it while the
 * request is pending.
 */
export function TransferNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { branches, activeBranch, activeBranchId, isLoading } = useBranch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const isAdmin = session.user.role === "ADMIN"
	const managerBranchId = session.user.branchId ?? activeBranchId ?? ""

	const selectableBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches])

	/**
	 * A manager's `/api/branches` is scoped to their own branch, so the source picker reads the
	 * deliberately unscoped active-branch directory. An admin already sees every branch in the
	 * shell context and does not need a second request.
	 */
	const directoryQuery = useQuery({
		...branchDirectoryOptions(),
		enabled: !isAdmin,
	})
	const sourceBranches = useMemo(() => {
		const choices = isAdmin ? selectableBranches : (directoryQuery.data?.branches ?? [])
		return choices.filter((branch) => branch.id !== managerBranchId)
	}, [isAdmin, selectableBranches, managerBranchId, directoryQuery.data])

	const [fromBranchId, setFromBranchId] = useState<string>(
		isAdmin ? (session.user.branchId ?? activeBranchId ?? "") : "",
	)
	const [toBranchId, setToBranchId] = useState<string>(
		isAdmin ? "" : (session.user.branchId ?? activeBranchId ?? ""),
	)
	const [note, setNote] = useState("")
	const [rows, setRows] = useState<TransferLineDraft[]>([newTransferLine()])
	const [formError, setFormError] = useState<string | null>(null)

	const selectedSourceType = isAdmin
		? undefined
		: directoryQuery.data?.branches.find((branch) => branch.id === fromBranchId)?.type
	const sourceIsWarehouse = selectedSourceType === "WAREHOUSE"
	const loadingBranches = isLoading || (!isAdmin && directoryQuery.isLoading)

	const createMutation = useMutation({
		mutationFn: (input: {
			fromBranchId: string
			toBranchId: string
			note?: string
			lines: { productId: string; quantityRequested: number }[]
		}) => createTransfer(input),
		onSuccess: async (data) => {
			toast.success(
				isAdmin
					? `Transfer ${data.transfer.number} drafted`
					: `Transfer ${data.transfer.number} requested`,
			)
			await queryClient.invalidateQueries({ queryKey: transferKeys.all })
			await navigate({
				to: "/inventory/transfers/$transferId",
				params: { transferId: data.transfer.id },
			})
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const destination = isAdmin ? toBranchId : managerBranchId
		if (!fromBranchId || !destination) {
			setFormError("Choose both the source and destination branches.")
			return
		}
		if (fromBranchId === destination) {
			setFormError("Source and destination must differ.")
			return
		}

		const lines: { productId: string; quantityRequested: number }[] = []
		for (const row of rows) {
			if (!row.product) {
				setFormError("Choose a product for every line.")
				return
			}
			const quantity = Number.parseInt(row.quantity, 10)
			if (!Number.isSafeInteger(quantity) || quantity <= 0) {
				setFormError(`Enter a whole quantity for ${row.product.name}.`)
				return
			}
			lines.push({ productId: row.product.id, quantityRequested: quantity })
		}
		if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
			setFormError("Each product may appear only once.")
			return
		}

		createMutation.mutate({
			fromBranchId,
			toBranchId: destination,
			...(note.trim() ? { note: note.trim() } : {}),
			lines,
		})
	}

	return (
		<section className="mx-auto max-w-3xl">
			<PageHeader
				title={isAdmin ? "New transfer" : "Request transfer"}
				description={
					isAdmin
						? "Draft a stock transfer between branches. Nothing moves until the source dispatches."
						: "Ask another branch for stock. The source branch decides before anything moves."
				}
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/inventory/transfers">
							<ChevronLeftIcon className="size-4" aria-hidden="true" />
							Back to transfers
						</Link>
					</Button>
				}
			/>

			<form onSubmit={handleSubmit} className="grid gap-5">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="from-branch">From branch</Label>
						<Select value={fromBranchId || undefined} onValueChange={setFromBranchId}>
							<SelectTrigger id="from-branch">
								<SelectValue placeholder={loadingBranches ? "Loading…" : "Choose source"} />
							</SelectTrigger>
							<SelectContent>
								{sourceBranches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.code} · {branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="to-branch">To branch</Label>
						{isAdmin ? (
							<Select value={toBranchId || undefined} onValueChange={setToBranchId}>
								<SelectTrigger id="to-branch">
									<SelectValue placeholder={isLoading ? "Loading…" : "Choose destination"} />
								</SelectTrigger>
								<SelectContent>
									{selectableBranches.map((branch) => (
										<SelectItem key={branch.id} value={branch.id}>
											{branch.code} · {branch.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Input
								id="to-branch"
								readOnly
								aria-readonly="true"
								value={activeBranch ? `${activeBranch.code} · ${activeBranch.name}` : "Your branch"}
							/>
						)}
					</div>
				</div>

				{!isAdmin ? (
					directoryQuery.isError ? (
						<StatusNote tone="danger" title="Couldn't load the branch directory">
							The source branches could not be listed. Refresh the page and try again before raising
							the request.
						</StatusNote>
					) : (
						<StatusNote tone="info">
							{sourceIsWarehouse
								? "An administrator approves a request from a warehouse before stock moves. You can withdraw it while it is waiting."
								: "The source branch's manager approves this request before stock moves. You can withdraw it while it is waiting."}
						</StatusNote>
					)
				) : null}

				<div className="grid gap-2">
					<Label>Lines</Label>
					<TransferLinesEditor rows={rows} onChange={setRows} disabled={createMutation.isPending} />
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="transfer-note">
						Note <span className="font-normal text-muted-foreground">(optional)</span>
					</Label>
					<Textarea
						id="transfer-note"
						value={note}
						onChange={(event) => setNote(event.target.value)}
						maxLength={300}
						rows={2}
					/>
				</div>

				{formError ? (
					<p role="alert" className="text-sm text-destructive">
						{formError}
					</p>
				) : null}

				<div className="flex justify-end gap-2">
					<Button asChild variant="outline">
						<Link to="/inventory/transfers">Cancel</Link>
					</Button>
					<Button
						type="submit"
						disabled={
							createMutation.isPending ||
							(!isAdmin && (directoryQuery.isLoading || directoryQuery.isError))
						}
					>
						{createMutation.isPending ? "Saving…" : isAdmin ? "Save draft" : "Request transfer"}
					</Button>
				</div>
			</form>
		</section>
	)
}
