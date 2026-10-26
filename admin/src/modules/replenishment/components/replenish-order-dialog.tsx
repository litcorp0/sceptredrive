import { formatCount } from "@sceptre/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import {
	createOrderFromSuggestions,
	type OrderFromSuggestionsInput,
	orderKeys,
} from "#/modules/procurement"
import { replenishmentKeys } from "../api/keys"
import type { ReplenishmentRow } from "../types"

interface DraftLine {
	productId: string
	sku: string
	name: string
	suggested: number
	lastCostMinor: number
	quantity: string
	unitCost: string
}

/**
 * Review the selected suggestion lines and raise one DRAFT purchase order.
 *
 * It never submits: submitting applies the branch approval limit, which is the order screen's
 * job. A fresh idempotency key is created per dialog session and reused across retries, so a
 * network retry returns the first order rather than drafting a second one.
 */
export function ReplenishOrderDialog({
	open,
	onOpenChange,
	branchId,
	supplierId,
	supplierName,
	rows,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	branchId: string
	supplierId: string
	supplierName: string
	rows: ReplenishmentRow[]
}) {
	const queryClient = useQueryClient()
	const [lines, setLines] = useState<DraftLine[]>(() =>
		rows.map((row) => ({
			productId: row.productId,
			sku: row.sku,
			name: row.name,
			suggested: row.suggested,
			lastCostMinor: row.lastCostMinor,
			quantity: String(row.suggested),
			unitCost: formatMinorPlain(row.lastCostMinor),
		})),
	)
	const [expectedDate, setExpectedDate] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [created, setCreated] = useState<{ id: string; number: string } | null>(null)

	// One session, one key: a retry after a timeout must not create a second order.
	const idempotencyKey = useRef(crypto.randomUUID())

	const saveMutation = useMutation({
		mutationFn: (input: OrderFromSuggestionsInput) => createOrderFromSuggestions(input),
		onSuccess: async (detail) => {
			setCreated({ id: detail.order.id, number: detail.order.number })
			toast.success(`Order ${detail.order.number} drafted`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: replenishmentKeys.all }),
				queryClient.invalidateQueries({ queryKey: orderKeys.all }),
			])
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function updateLine(productId: string, patch: Partial<Pick<DraftLine, "quantity" | "unitCost">>) {
		setLines((current) =>
			current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)),
		)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (created) return

		const parsed: OrderFromSuggestionsInput["lines"] = []
		for (const [index, line] of lines.entries()) {
			const quantity = Number.parseInt(line.quantity, 10)
			if (!Number.isSafeInteger(quantity) || quantity < 1) {
				setFormError(`Line ${index + 1}: enter a whole quantity of at least one.`)
				return
			}
			const unitCostMinor = parseGhsToMinor(line.unitCost)
			if (unitCostMinor === null || unitCostMinor <= 0) {
				setFormError(`Line ${index + 1}: enter a unit cost above zero.`)
				return
			}
			parsed.push({ productId: line.productId, quantity, unitCostMinor })
		}

		saveMutation.mutate({
			branchId,
			supplierId,
			expectedDate: expectedDate || undefined,
			note: note.trim() || undefined,
			idempotencyKey: idempotencyKey.current,
			lines: parsed,
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Raise an order for {supplierName}</DialogTitle>
					<DialogDescription>
						Review the suggested lines. Saving creates a draft order and nothing is sent to the
						supplier until it is submitted on the order page.
					</DialogDescription>
				</DialogHeader>

				{created ? (
					<div className="grid gap-4">
						<output className="block rounded-md border bg-muted/40 px-3 py-2">
							<span className="block text-sm font-medium">
								Draft order {created.number} created.
							</span>
							<span className="mt-1 block text-sm text-muted-foreground">
								It is a draft. Open it to review the lines, then submit it when you are ready.
							</span>
						</output>
						<DialogFooter>
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Close
							</Button>
							<Button asChild>
								<Link
									to="/procurement/orders/$orderId"
									params={{ orderId: created.id }}
									onClick={() => onOpenChange(false)}
								>
									Open draft order
								</Link>
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form onSubmit={handleSubmit} className="grid gap-4">
						<div className="rounded-md border">
							<Table>
								<caption className="sr-only">Suggested lines in this order</caption>
								<TableHeader>
									<TableRow>
										<TableHead>Product</TableHead>
										<TableHead className="text-right">Suggested</TableHead>
										<TableHead className="w-28">Quantity</TableHead>
										<TableHead className="w-36">Unit cost</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{lines.map((line) => (
										<TableRow key={line.productId}>
											<TableCell>
												<p className="font-medium">{line.name}</p>
												<p className="font-mono text-xs text-muted-foreground">{line.sku}</p>
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{formatCount(line.suggested)}
											</TableCell>
											<TableCell>
												<Input
													inputMode="numeric"
													value={line.quantity}
													aria-label={`Quantity for ${line.name}`}
													disabled={saveMutation.isPending}
													onChange={(event) =>
														updateLine(line.productId, { quantity: event.target.value })
													}
												/>
											</TableCell>
											<TableCell>
												<Input
													inputMode="decimal"
													value={line.unitCost}
													aria-label={`Unit cost for ${line.name}`}
													disabled={saveMutation.isPending}
													onChange={(event) =>
														updateLine(line.productId, { unitCost: event.target.value })
													}
												/>
												<p className="mt-1 text-xs text-muted-foreground">
													Last cost {formatGhs(line.lastCostMinor)}
												</p>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>

						<p className="text-xs text-muted-foreground">
							The quantity defaults to the suggestion and the cost to the supplier's last delivery.
							The server recomputes the order value and the approval decision.
						</p>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label htmlFor="replenish-expected-date">Expected delivery (optional)</Label>
								<Input
									id="replenish-expected-date"
									type="date"
									value={expectedDate}
									disabled={saveMutation.isPending}
									onChange={(event) => setExpectedDate(event.target.value)}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="replenish-note">Note (optional)</Label>
								<Input
									id="replenish-note"
									maxLength={300}
									placeholder="Delivery instructions"
									value={note}
									disabled={saveMutation.isPending}
									onChange={(event) => setNote(event.target.value)}
								/>
							</div>
						</div>

						{formError ? (
							<p role="alert" className="text-sm text-destructive">
								{formError}
							</p>
						) : null}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={saveMutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={saveMutation.isPending || lines.length === 0}>
								{saveMutation.isPending ? "Creating…" : "Create draft order"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}
