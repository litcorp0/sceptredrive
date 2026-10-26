import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
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
import { formatMinorPlain } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { orderKeys } from "../api/keys"
import { createOrder, updateOrder } from "../api/orders"
import type { OrderDetail } from "../types"
import {
	newOrderLine,
	type OrderLineDraft,
	OrderLinesEditor,
	toOrderLineInputs,
	validateOrderLineDraft,
} from "./order-lines-editor"

/**
 * Create a draft order, or edit one while it is still a draft.
 *
 * The branch is fixed after creation (the API has no branch move), the supplier defaults from the
 * order on edit, and the lines go to the API as typed costs — the server computes the goods value
 * and the approval decision.
 */
export function OrderForm({
	mode,
	order = null,
	onSaved,
	onCancel,
}: {
	mode: "create" | "edit"
	order?: OrderDetail | null
	onSaved?: (order: OrderDetail) => void
	onCancel?: () => void
}) {
	const queryClient = useQueryClient()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()
	const isEdit = mode === "edit" && order !== null

	const [branchId, setBranchId] = useState<string>(
		order?.order.branchId ?? activeBranchId ?? branches[0]?.id ?? "",
	)
	const [supplier, setSupplier] = useState<PickedSupplier | null>(() =>
		order
			? {
					id: order.order.supplierId,
					code: order.order.supplierCode,
					name: order.order.supplierName,
					paymentTermDays: 0,
				}
			: null,
	)
	const [expectedDate, setExpectedDate] = useState(order?.order.expectedDate ?? "")
	const [note, setNote] = useState(order?.order.note ?? "")
	const [rows, setRows] = useState<OrderLineDraft[]>(() =>
		order
			? order.lines.map((line) => ({
					key: crypto.randomUUID(),
					product: {
						id: line.productId,
						sku: line.sku,
						name: line.name,
						costPriceMinor: line.unitCostMinor,
					},
					quantity: String(line.quantity),
					unitCost: formatMinorPlain(line.unitCostMinor),
				}))
			: [newOrderLine()],
	)
	const [formError, setFormError] = useState<string | null>(null)

	// A draft is a document; retrying a network failure must not create a second order.
	const idempotencyKey = useRef<string | null>(null)

	useEffect(() => {
		if (!canSelectBranch) return
		if (branchId !== "") return
		setBranchId(activeBranchId ?? branches[0]?.id ?? "")
	}, [canSelectBranch, branchId, activeBranchId, branches])

	const effectiveBranchId = canSelectBranch ? branchId : (activeBranchId ?? "")

	const saveMutation = useMutation({
		mutationFn: () => {
			if (!supplier) throw new Error("Choose the supplier before saving.")
			const lines = toOrderLineInputs(rows)
			if (isEdit && order) {
				return updateOrder(order.order.id, {
					supplierId: supplier.id,
					expectedDate: expectedDate || null,
					note: note.trim() || null,
					lines,
				})
			}
			idempotencyKey.current ??= crypto.randomUUID()
			return createOrder({
				branchId: effectiveBranchId,
				supplierId: supplier.id,
				expectedDate: expectedDate || undefined,
				note: note.trim() || undefined,
				idempotencyKey: idempotencyKey.current,
				lines,
			})
		},
		onSuccess: async (data) => {
			idempotencyKey.current = null
			toast.success(
				isEdit ? `Order ${data.order.number} updated` : `Order ${data.order.number} drafted`,
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orderKeys.all }),
				queryClient.invalidateQueries({ queryKey: orderKeys.byId(data.order.id) }),
			])
			onSaved?.(data)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				if (error.status === 400 || error.status === 409) {
					idempotencyKey.current = null
					setFormError(error.message)
					return
				}
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		if (!isEdit && !effectiveBranchId) {
			setFormError("Choose the branch that owns this order.")
			return
		}
		if (!supplier) {
			setFormError("Choose the supplier this order goes to.")
			return
		}
		if (rows.length === 0) {
			setFormError("Add at least one order line.")
			return
		}
		for (const [index, row] of rows.entries()) {
			const lineError = validateOrderLineDraft(row)
			if (lineError) {
				setFormError(`Line ${index + 1}: ${lineError}`)
				return
			}
		}
		const productIds = rows.map((row) => row.product?.id)
		if (new Set(productIds).size !== productIds.length) {
			setFormError("Each product may appear only once in an order.")
			return
		}

		saveMutation.mutate()
	}

	const busy = saveMutation.isPending

	return (
		<form onSubmit={handleSubmit} className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Purchase order</CardTitle>
					<CardDescription>
						A draft costs nothing and commits nothing. Submitting it applies the branch approval
						limit.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label>Supplier</Label>
							<SupplierCombobox value={supplier} onSelect={setSupplier} disabled={busy} />
						</div>

						{canSelectBranch && !isEdit ? (
							<div className="grid gap-1.5">
								<Label htmlFor="order-branch">Branch</Label>
								<Select value={branchId || undefined} onValueChange={setBranchId}>
									<SelectTrigger id="order-branch" className="w-full">
										<SelectValue placeholder="Select a branch" />
									</SelectTrigger>
									<SelectContent>
										{branches.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.code} · {branch.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : (
							<div className="grid gap-1.5">
								<Label>Branch</Label>
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
									{isEdit && order
										? (branches.find((branch) => branch.id === order.order.branchId)?.name ??
											"Branch")
										: (activeBranch?.name ?? "Your branch")}
								</p>
							</div>
						)}
					</div>

					<div className="grid gap-1.5 sm:max-w-xs">
						<Label htmlFor="order-expected">Expected delivery (optional)</Label>
						<Input
							id="order-expected"
							type="date"
							value={expectedDate}
							disabled={busy}
							onChange={(event) => setExpectedDate(event.target.value)}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Lines</CardTitle>
					<CardDescription>
						Quantities are whole units. The goods value used for approval is the sum of quantity ×
						unit cost, ex-tax.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<OrderLinesEditor rows={rows} onChange={setRows} disabled={busy} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Note</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						rows={2}
						maxLength={300}
						placeholder="Delivery instructions or anything the approver should know (optional)"
						value={note}
						disabled={busy}
						onChange={(event) => setNote(event.target.value)}
					/>
				</CardContent>
			</Card>

			{formError ? (
				<div
					role="alert"
					className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
				>
					{formError}
				</div>
			) : null}

			<div className="flex flex-wrap items-center justify-end gap-2">
				{onCancel ? (
					<Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
						Cancel
					</Button>
				) : null}
				<Button type="submit" disabled={busy}>
					{busy ? "Saving…" : isEdit ? "Save draft" : "Create draft"}
				</Button>
			</div>
		</form>
	)
}
