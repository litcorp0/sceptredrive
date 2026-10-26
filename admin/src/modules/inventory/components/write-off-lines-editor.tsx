import { formatCount } from "@sceptre/shared"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { type PickedProduct, ProductPicker } from "#/components/common/product-picker"
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
import { formatGhs } from "#/lib/format"
import type { WriteOffReason } from "../types"
import { WRITE_OFF_REASONS, writeOffReasonLabel, writeOffReasonNeedsNote } from "../utils/writeoff"

export interface WriteOffLineDraft {
	key: string
	product: PickedProduct | null
	quantity: string
	reason: WriteOffReason
	note: string
}

export interface WriteOffLevel {
	quantityOnHand: number
	avgCostMinor: number
}

export function newWriteOffLine(): WriteOffLineDraft {
	return { key: crypto.randomUUID(), product: null, quantity: "", reason: "DAMAGE", note: "" }
}

/**
 * The lines of a write-off request: the product, what the branch holds, how many left the shelf,
 * why, and the explanation the server requires for `THEFT` and `OTHER`.
 *
 * On-hand and average cost come from the branch's stock read passed in by the form. This component
 * never fetches: the figures are the server's, and the form freezes them by submitting quantity
 * only.
 */
export function WriteOffLinesEditor({
	rows,
	onChange,
	levels,
	branchName,
	disabled,
}: {
	rows: WriteOffLineDraft[]
	onChange: (rows: WriteOffLineDraft[]) => void
	levels: Map<string, WriteOffLevel>
	branchName: string | null
	disabled?: boolean
}) {
	function update(key: string, patch: Partial<WriteOffLineDraft>) {
		onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
	}

	return (
		<div className="grid gap-3">
			{rows.map((row, index) => {
				const level = row.product ? levels.get(row.product.id) : undefined
				const needsNote = writeOffReasonNeedsNote(row.reason)
				const noteId = `write-off-note-${row.key}`

				return (
					<div key={row.key} className="grid gap-3 rounded-md border p-3">
						<div className="grid items-start gap-3 sm:grid-cols-[1fr_110px_auto]">
							<div className="grid gap-1">
								<ProductPicker
									value={row.product}
									onSelect={(product) => update(row.key, { product })}
									disabled={disabled}
								/>
								{row.product ? (
									<p className="text-xs text-muted-foreground">
										{level
											? `${formatCount(level.quantityOnHand)} on hand at ${branchName ?? "this branch"} · average cost ${formatGhs(level.avgCostMinor)}`
											: `No stock at ${branchName ?? "this branch"} yet`}
									</p>
								) : null}
							</div>
							<div className="grid gap-1">
								<Label className="text-xs" htmlFor={`write-off-qty-${row.key}`}>
									Quantity
								</Label>
								<Input
									id={`write-off-qty-${row.key}`}
									inputMode="numeric"
									value={row.quantity}
									onChange={(event) => update(row.key, { quantity: event.target.value })}
									aria-label={`Quantity for line ${index + 1}`}
								/>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="mt-5"
								aria-label={`Remove line ${index + 1}`}
								disabled={rows.length === 1 || disabled}
								onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
							>
								<Trash2Icon className="size-4" aria-hidden="true" />
							</Button>
						</div>

						<div className="grid gap-3 sm:grid-cols-[200px_1fr]">
							<div className="grid gap-1">
								<Label className="text-xs" htmlFor={`write-off-reason-${row.key}`}>
									Reason
								</Label>
								<Select
									value={row.reason}
									onValueChange={(value) => update(row.key, { reason: value as WriteOffReason })}
								>
									<SelectTrigger id={`write-off-reason-${row.key}`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{WRITE_OFF_REASONS.map((reason) => (
											<SelectItem key={reason} value={reason}>
												{writeOffReasonLabel(reason)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-1">
								<Label className="text-xs" htmlFor={noteId}>
									Note{" "}
									<span className="font-normal text-muted-foreground">
										{needsNote ? "(required for this reason)" : "(optional)"}
									</span>
								</Label>
								<Input
									id={noteId}
									value={row.note}
									onChange={(event) => update(row.key, { note: event.target.value })}
									maxLength={300}
									aria-required={needsNote}
									aria-describedby={needsNote ? `${noteId}-hint` : undefined}
								/>
								{needsNote ? (
									<p id={`${noteId}-hint`} className="text-xs text-muted-foreground">
										Say what happened to this stock; the admin deciding it needs the detail.
									</p>
								) : null}
							</div>
						</div>
					</div>
				)
			})}

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={disabled}
				onClick={() => onChange([...rows, newWriteOffLine()])}
			>
				<PlusIcon className="size-4" aria-hidden="true" />
				Add line
			</Button>
		</div>
	)
}
