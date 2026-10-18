import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { type FormEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import {
	newTransferLine,
	type TransferLineDraft,
	TransferLinesEditor,
} from "#/components/inventory/transfer-lines-editor"
import { Button } from "#/components/ui/button"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Textarea } from "#/components/ui/textarea"
import { ApiError, api } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/inventory/transfers/new")({
	component: NewTransferPage,
})

function NewTransferPage() {
	const { session } = Route.useRouteContext()
	const { branches, activeBranchId, isLoading } = useBranch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const selectableBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches])

	const [fromBranchId, setFromBranchId] = useState<string>(
		session.user.branchId ?? activeBranchId ?? "",
	)
	const [toBranchId, setToBranchId] = useState<string>("")
	const [note, setNote] = useState("")
	const [rows, setRows] = useState<TransferLineDraft[]>([newTransferLine()])
	const [formError, setFormError] = useState<string | null>(null)

	const createMutation = useMutation({
		mutationFn: (input: {
			fromBranchId: string
			toBranchId: string
			note?: string
			lines: { productId: string; quantityRequested: number }[]
		}) => api.transfers.create(input),
		onSuccess: async (data) => {
			toast.success(`Transfer ${data.transfer.number} drafted`)
			await queryClient.invalidateQueries({ queryKey: ["transfers"] })
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

		if (!fromBranchId || !toBranchId) {
			setFormError("Choose both the source and destination branches.")
			return
		}
		if (fromBranchId === toBranchId) {
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
			toBranchId,
			...(note.trim() ? { note: note.trim() } : {}),
			lines,
		})
	}

	return (
		<section className="mx-auto max-w-3xl">
			<PageHeader
				title="New transfer"
				description="Draft a stock transfer between branches. Nothing moves until the source dispatches."
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
								<SelectValue placeholder={isLoading ? "Loading…" : "Choose source"} />
							</SelectTrigger>
							<SelectContent>
								{selectableBranches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.code} · {branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="to-branch">To branch</Label>
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
					</div>
				</div>

				<div className="grid gap-2">
					<Label>Lines</Label>
					<TransferLinesEditor rows={rows} onChange={setRows} disabled={createMutation.isPending} />
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="transfer-note">Note (optional)</Label>
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
					<Button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending ? "Saving…" : "Save draft"}
					</Button>
				</div>
			</form>
		</section>
	)
}
