import { formatCount } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { stockListOptions } from "../api/inventory"
import { writeOffKeys } from "../api/keys"
import { createWriteOff } from "../api/writeoffs"
import type { WriteOffLineInput } from "../types"
import { writeOffReasonNeedsNote } from "../utils/writeoff"
import {
	newWriteOffLine,
	type WriteOffLevel,
	type WriteOffLineDraft,
	WriteOffLinesEditor,
} from "./write-off-lines-editor"

/**
 * Raise a stock write-off at the caller's own branch.
 *
 * The form holds quantity and reason; the branch and the frozen value come from the API. The
 * live figure is a provisional multiplication of the quantity by the branch's server-provided
 * average cost, shown so the requester can see what the admin will approve — the server
 * recomputes and freezes it on submit, so nothing here decides money.
 */
export function WriteOffForm({
	branchId,
	branchName,
}: {
	branchId: string
	branchName: string | null
}) {
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const [rows, setRows] = useState<WriteOffLineDraft[]>([newWriteOffLine()])
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const stockQuery = useQuery(stockListOptions({ branchId, limit: 200 }))

	const levels = useMemo(() => {
		const map = new Map<string, WriteOffLevel>()
		for (const row of stockQuery.data?.stock ?? []) {
			map.set(row.productId, {
				quantityOnHand: row.quantityOnHand,
				avgCostMinor: row.avgCostMinor,
			})
		}
		return map
	}, [stockQuery.data])

	const valueMinor = rows.reduce((sum, row) => {
		const quantity = Number.parseInt(row.quantity, 10)
		if (!Number.isSafeInteger(quantity) || quantity <= 0) return sum
		if (!row.product) return sum
		return sum + quantity * (levels.get(row.product.id)?.avgCostMinor ?? 0)
	}, 0)

	const createMutation = useMutation({
		mutationFn: (input: { lines: WriteOffLineInput[]; note?: string }) => createWriteOff(input),
		onSuccess: async (data) => {
			toast.success(`Write-off ${data.writeOff.number} raised for approval`)
			await queryClient.invalidateQueries({ queryKey: writeOffKeys.all })
			await navigate({
				to: "/inventory/write-offs/$writeOffId",
				params: { writeOffId: data.writeOff.id },
			})
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const lines: WriteOffLineInput[] = []
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
			const noteText = row.note.trim()
			if (writeOffReasonNeedsNote(row.reason) && noteText.length === 0) {
				setFormError(
					`A ${row.reason === "THEFT" ? "theft" : "other"} write-off needs a note explaining what happened to ${row.product.name}.`,
				)
				return
			}
			lines.push({
				productId: row.product.id,
				quantity,
				reason: row.reason,
				...(noteText ? { note: noteText } : {}),
			})
		}
		if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
			setFormError("Each product may appear only once.")
			return
		}

		createMutation.mutate({
			lines,
			...(note.trim() ? { note: note.trim() } : {}),
		})
	}

	return (
		<form onSubmit={handleSubmit} className="grid gap-5">
			{stockQuery.isLoading ? (
				<StatusNote tone="info">Loading the branch's on-hand figures…</StatusNote>
			) : stockQuery.isError ? (
				<StatusNote tone="danger">
					Couldn't load on-hand stock. You can still submit; the API values the write-off.
				</StatusNote>
			) : null}

			<div className="grid gap-2">
				<Label>Lines</Label>
				<WriteOffLinesEditor
					rows={rows}
					onChange={setRows}
					levels={levels}
					branchName={branchName}
					disabled={createMutation.isPending}
				/>
			</div>

			<div className="rounded-md border bg-muted/40 p-3">
				<p className="text-sm font-medium tabular-nums">
					Value at average cost: {formatGhs(valueMinor)}
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					This is the value the admin will approve. The figure is frozen when you submit; later cost
					changes do not alter it.
				</p>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="write-off-note">
					Note for the admin <span className="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id="write-off-note"
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

			<div className="flex flex-wrap justify-end gap-2">
				<Button asChild variant="outline">
					<Link to="/inventory/write-offs">Cancel</Link>
				</Button>
				<Button type="submit" disabled={createMutation.isPending}>
					{createMutation.isPending ? "Submitting…" : "Submit for approval"}
				</Button>
			</div>

			<p className="text-xs text-muted-foreground">
				{formatCount(rows.length)} {rows.length === 1 ? "line" : "lines"} · the document is numbered
				and its value frozen when submitted.
			</p>
		</form>
	)
}
