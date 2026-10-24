import { formatDay, taxBreakdown, toDateInputValue } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { addDays, parseISO } from "date-fns"
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
	createInvoiceLineDraft,
	type InvoiceLineDraft,
	InvoiceLinesEditor,
	invoiceLineDraftsSum,
	toInvoiceLineInputs,
	validateInvoiceLineDraft,
} from "#/components/payables/invoice-lines-editor"
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
import { ApiError, api } from "#/lib/api"
import type { InventoryReceipt, InvoiceCreateInput } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

type TaxMode = "STANDARD" | "NONE" | "MANUAL"

function isoToday(): string {
	return toDateInputValue(new Date())
}

function addDaysToIsoDate(isoDate: string, days: number): string {
	return toDateInputValue(addDays(parseISO(isoDate), days))
}

/** Empty manual tax boxes mean zero; unparseable values return null. */
function parseTaxInput(value: string): number | null {
	if (value.trim() === "") return 0
	return parseGhsToMinor(value)
}

export function InvoiceForm({
	receiptId,
	supplierId,
}: {
	receiptId?: string
	supplierId?: string
}) {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()

	const [branchId, setBranchId] = useState<string>(activeBranchId ?? "")
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [receipt, setReceipt] = useState<InventoryReceipt | null>(null)
	const [receiptPick, setReceiptPick] = useState<string>("none")
	const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
	const [invoiceDate, setInvoiceDate] = useState(isoToday())
	const [dueDate, setDueDate] = useState("")
	const [dueDateTouched, setDueDateTouched] = useState(false)
	const [lines, setLines] = useState<InvoiceLineDraft[]>(() => [createInvoiceLineDraft("product")])
	const [linesTouched, setLinesTouched] = useState(false)
	const [taxMode, setTaxMode] = useState<TaxMode>("STANDARD")
	const [manualVat, setManualVat] = useState("")
	const [manualNhil, setManualNhil] = useState("")
	const [manualGetfund, setManualGetfund] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [formDetails, setFormDetails] = useState<Record<string, unknown> | null>(null)

	// One key per form session: a network failure retries the same posting
	// (the server replays it), while a server response resets the key.
	const idempotencyKey = useRef<string | null>(null)

	function takeIdempotencyKey(): string {
		idempotencyKey.current ??= crypto.randomUUID()
		return idempotencyKey.current
	}

	const effectiveBranchId = canSelectBranch ? branchId : (activeBranchId ?? "")

	useEffect(() => {
		if (!canSelectBranch) return
		if (branchId !== "") return
		setBranchId(activeBranchId ?? branches[0]?.id ?? "")
	}, [canSelectBranch, branchId, activeBranchId, branches])

	// Default the due date from the supplier's terms until the operator edits it.
	useEffect(() => {
		if (!supplier || dueDateTouched) return
		setDueDate(addDaysToIsoDate(invoiceDate, supplier.paymentTermDays))
	}, [supplier, invoiceDate, dueDateTouched])

	const receiptOptionsQuery = useQuery({
		queryKey: ["invoice-receipt-options", effectiveBranchId],
		queryFn: () =>
			api.inventory.receipts.list({
				branchId: effectiveBranchId || undefined,
				limit: 50,
			}),
		enabled: effectiveBranchId !== "" || canSelectBranch,
	})

	const initialReceiptQuery = useQuery({
		queryKey: ["invoice-receipt", receiptId],
		queryFn: () => api.inventory.receipts.get(receiptId as string),
		enabled: Boolean(receiptId),
	})

	const initialSupplierQuery = useQuery({
		queryKey: ["invoice-supplier", supplierId],
		queryFn: () => api.suppliers.get(supplierId as string),
		enabled: Boolean(supplierId) && !receiptId,
	})

	const applySupplier = useCallback(
		(next: { id: string; code: string; name: string; paymentTermDays: number }) => {
			setSupplier(next)
		},
		[],
	)

	const applyReceipt = useCallback(
		async (detail: InventoryReceipt) => {
			setReceipt(detail)
			setReceiptPick(detail.id)
			setSupplierInvoiceNumber(detail.supplierInvoiceNumber ?? "")
			if (canSelectBranch) setBranchId(detail.branchId)
			const receiptLines = detail.lines ?? []
			setLines(
				receiptLines.length > 0
					? receiptLines.map((line) => ({
							key: crypto.randomUUID(),
							kind: "product" as const,
							product: {
								id: line.productId,
								sku: line.sku,
								name: line.productName,
								costPriceMinor: line.unitCostMinor,
							},
							description: "",
							quantity: String(line.quantity),
							unitCost: formatMinorPlain(line.unitCostMinor),
						}))
					: [createInvoiceLineDraft("product")],
			)
			setLinesTouched(false)
			setDueDateTouched(false)

			if (detail.supplierId) {
				const supplierIdValue = detail.supplierId
				try {
					const data = await api.suppliers.get(supplierIdValue)
					applySupplier({
						id: data.supplier.id,
						code: data.supplier.code,
						name: data.supplier.name,
						paymentTermDays: data.supplier.paymentTermDays,
					})
				} catch {
					applySupplier({
						id: supplierIdValue,
						code: "",
						name: detail.supplierName ?? "",
						paymentTermDays: 0,
					})
				}
			}
		},
		[canSelectBranch, applySupplier],
	)

	// `?receiptId=` and `?supplierId=` pre-selections load once.
	const appliedInitialReceipt = useRef(false)
	useEffect(() => {
		if (appliedInitialReceipt.current) return
		const detail = initialReceiptQuery.data?.receipt
		if (!detail) return
		appliedInitialReceipt.current = true
		void applyReceipt(detail)
	}, [initialReceiptQuery.data, applyReceipt])

	useEffect(() => {
		const data = initialSupplierQuery.data
		if (!data) return
		applySupplier({
			id: data.supplier.id,
			code: data.supplier.code,
			name: data.supplier.name,
			paymentTermDays: data.supplier.paymentTermDays,
		})
	}, [initialSupplierQuery.data, applySupplier])

	async function chooseReceipt(nextId: string) {
		setReceiptPick(nextId)
		if (nextId === "none") {
			setReceipt(null)
			return
		}
		try {
			const data = await api.inventory.receipts.get(nextId)
			await applyReceipt(data.receipt)
		} catch (error) {
			toastApiError(error)
			setReceiptPick(receipt?.id ?? "none")
		}
	}

	const lineSumMinor = invoiceLineDraftsSum(lines)
	const standard = taxBreakdown(lineSumMinor, "STANDARD", "INCLUSIVE")
	const manualVatMinor = parseTaxInput(manualVat) ?? 0
	const manualNhilMinor = parseTaxInput(manualNhil) ?? 0
	const manualGetfundMinor = parseTaxInput(manualGetfund) ?? 0

	const totals =
		taxMode === "STANDARD"
			? {
					subtotal: standard.baseMinor,
					vat: standard.vatMinor,
					nhil: standard.nhilMinor,
					getfund: standard.getfundMinor,
					total: standard.totalMinor,
				}
			: taxMode === "NONE"
				? { subtotal: lineSumMinor, vat: 0, nhil: 0, getfund: 0, total: lineSumMinor }
				: {
						subtotal: lineSumMinor,
						vat: manualVatMinor,
						nhil: manualNhilMinor,
						getfund: manualGetfundMinor,
						total: lineSumMinor + manualVatMinor + manualNhilMinor + manualGetfundMinor,
					}

	function switchTaxMode(mode: TaxMode) {
		setTaxMode(mode)
		if (mode === "MANUAL" && manualVat === "" && manualNhil === "" && manualGetfund === "") {
			setManualVat(formatMinorPlain(standard.vatMinor))
			setManualNhil(formatMinorPlain(standard.nhilMinor))
			setManualGetfund(formatMinorPlain(standard.getfundMinor))
		}
	}

	const saveMutation = useMutation({
		mutationFn: (input: InvoiceCreateInput) => api.payables.invoices.create(input),
		onSuccess: async (data) => {
			idempotencyKey.current = null
			toast.success(
				data.replayed
					? `Invoice ${data.invoice.invoice.number} was already recorded`
					: `Invoice ${data.invoice.invoice.number} recorded`,
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier", data.invoice.invoice.supplierId] }),
				queryClient.invalidateQueries({ queryKey: ["invoice-receipt-options"] }),
			])
			await navigate({
				to: "/suppliers/invoices/$invoiceId",
				params: { invoiceId: data.invoice.invoice.id },
			})
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				idempotencyKey.current = null
				if (error.status === 400 || error.status === 409) {
					setFormError(error.message)
					setFormDetails(error.details ?? null)
					return
				}
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		setFormDetails(null)

		if (canSelectBranch && !branchId) {
			setFormError("Choose the branch that owns this invoice.")
			return
		}
		if (!supplier) {
			setFormError("Choose the supplier this invoice belongs to.")
			return
		}
		if (supplierInvoiceNumber.trim().length === 0) {
			setFormError("Enter the supplier's invoice number.")
			return
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
			setFormError("Enter a valid invoice date.")
			return
		}

		const usingReceiptCopy = receipt !== null && !linesTouched
		if (!usingReceiptCopy) {
			if (lines.length === 0) {
				setFormError("Add at least one invoice line.")
				return
			}
			for (const [index, line] of lines.entries()) {
				const lineError = validateInvoiceLineDraft(line)
				if (lineError) {
					setFormError(`Line ${index + 1}: ${lineError}`)
					return
				}
			}
			const productIds = lines
				.filter((line) => line.kind === "product" && line.product)
				.map((line) => line.product?.id)
			if (new Set(productIds).size !== productIds.length) {
				setFormError("Each product may appear only once in an invoice.")
				return
			}
		}

		if (taxMode === "MANUAL") {
			for (const [label, value] of [
				["VAT", manualVat],
				["NHIL", manualNhil],
				["GETFund", manualGetfund],
			] as const) {
				if (parseTaxInput(value) === null) {
					setFormError(`Enter a valid ${label} amount like 12.50.`)
					return
				}
			}
		}

		const taxFields =
			taxMode === "STANDARD"
				? {}
				: taxMode === "NONE"
					? { vatMinor: 0, nhilMinor: 0, getfundMinor: 0 }
					: {
							vatMinor: manualVatMinor,
							nhilMinor: manualNhilMinor,
							getfundMinor: manualGetfundMinor,
						}

		saveMutation.mutate({
			supplierId: supplier.id,
			branchId: canSelectBranch ? branchId : undefined,
			supplierInvoiceNumber: supplierInvoiceNumber.trim(),
			invoiceDate,
			dueDate: dueDate || undefined,
			...(usingReceiptCopy
				? { receiptId: receipt.id, copyFromReceipt: true }
				: {
						...(receipt ? { receiptId: receipt.id } : {}),
						lines: toInvoiceLineInputs(lines),
					}),
			...taxFields,
			note: note.trim() || undefined,
			idempotencyKey: takeIdempotencyKey(),
		})
	}

	const duplicateInvoiceId =
		typeof formDetails?.existingInvoiceId === "string" ? formDetails.existingInvoiceId : null
	const receiptOptions = receiptOptionsQuery.data?.receipts ?? []

	return (
		<form onSubmit={handleSubmit} className="grid gap-4">
			<div>
				<Link
					to="/suppliers/invoices"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Invoices
				</Link>
				<h2 className="mt-2 text-lg font-semibold tracking-tight">New supplier invoice</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Record a purchase invoice standalone or copy the lines from a goods receipt. Totals are
					always recomputed by the server.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Source</CardTitle>
					<CardDescription>
						Link a goods receipt to prefill its lines, or enter the invoice manually.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="invoice-receipt">Goods receipt (optional)</Label>
							<Select value={receiptPick} onValueChange={(value) => void chooseReceipt(value)}>
								<SelectTrigger id="invoice-receipt" className="w-full">
									<SelectValue placeholder="No receipt" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No receipt — standalone invoice</SelectItem>
									{receiptOptions.map((option) => (
										<SelectItem key={option.id} value={option.id}>
											{option.number} · {option.supplierName ?? "No supplier"} ·{" "}
											{formatGhs(option.totalCostMinor)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Recent receipts for this branch. A receipt can carry only one invoice.
							</p>
						</div>

						{canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="invoice-branch">Branch</Label>
								<Select value={branchId} onValueChange={setBranchId}>
									<SelectTrigger id="invoice-branch" className="w-full">
										<SelectValue placeholder="Select a branch" />
									</SelectTrigger>
									<SelectContent>
										{branches.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : (
							<div className="grid gap-1.5">
								<Label>Branch</Label>
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
									{activeBranch?.name ?? "Your branch"}
								</p>
							</div>
						)}
					</div>

					{receipt ? (
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
							<div>
								<span className="font-medium">From receipt {receipt.number}</span>
								<span className="text-muted-foreground">
									{" "}
									· {receipt.supplierName ?? "No supplier"} · {formatGhs(receipt.totalCostMinor)} ·{" "}
									{formatDay(receipt.createdAt)}
								</span>
							</div>
							<Button variant="link" size="sm" className="h-auto px-0" asChild>
								<Link
									to="/inventory/receipts/$receiptId"
									params={{ receiptId: receipt.id }}
									target="_blank"
								>
									Open receipt
								</Link>
							</Button>
						</div>
					) : null}

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label>Supplier</Label>
							<SupplierCombobox value={supplier} onSelect={setSupplier} />
							{supplier && supplier.paymentTermDays >= 0 ? (
								<p className="text-xs text-muted-foreground">
									Terms: {supplier.paymentTermDays} days
								</p>
							) : null}
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="invoice-supplier-number">Supplier invoice number</Label>
							<Input
								id="invoice-supplier-number"
								required
								maxLength={60}
								value={supplierInvoiceNumber}
								onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="invoice-date">Invoice date</Label>
							<Input
								id="invoice-date"
								type="date"
								required
								value={invoiceDate}
								onChange={(event) => setInvoiceDate(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="invoice-due">Due date</Label>
							<Input
								id="invoice-due"
								type="date"
								value={dueDate}
								onChange={(event) => {
									setDueDate(event.target.value)
									setDueDateTouched(true)
								}}
							/>
							<p className="text-xs text-muted-foreground">
								Defaults from the supplier's payment terms.
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Lines</CardTitle>
					<CardDescription>
						Unit costs are tax-inclusive for the standard 20% split (VAT 15%, NHIL 2.5%, GETFund
						2.5%). Products or free-text lines, not both on one row.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<InvoiceLinesEditor
						lines={lines}
						onChange={(next) => {
							setLines(next)
							setLinesTouched(true)
						}}
					/>

					<div className="ml-auto w-full max-w-sm rounded-lg border bg-muted/30 p-3 text-sm">
						<div className="flex justify-between py-0.5">
							<span className="text-muted-foreground">Lines (tax-inclusive)</span>
							<span className="tabular-nums">{formatGhs(lineSumMinor)}</span>
						</div>
						<div className="flex justify-between py-0.5">
							<span className="text-muted-foreground">Subtotal</span>
							<span className="tabular-nums">{formatGhs(totals.subtotal)}</span>
						</div>
						<div className="flex justify-between py-0.5">
							<span className="text-muted-foreground">VAT 15%</span>
							<span className="tabular-nums">{formatGhs(totals.vat)}</span>
						</div>
						<div className="flex justify-between py-0.5">
							<span className="text-muted-foreground">NHIL 2.5%</span>
							<span className="tabular-nums">{formatGhs(totals.nhil)}</span>
						</div>
						<div className="flex justify-between py-0.5">
							<span className="text-muted-foreground">GETFund 2.5%</span>
							<span className="tabular-nums">{formatGhs(totals.getfund)}</span>
						</div>
						<div className="mt-1 flex justify-between border-t pt-1.5 font-medium">
							<span>Total</span>
							<span className="tabular-nums">{formatGhs(totals.total)}</span>
						</div>
						{receipt && !linesTouched ? (
							<p className="mt-2 text-xs text-muted-foreground">
								Lines copied from the receipt on save; the total matches the receipt by
								construction.
							</p>
						) : null}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Tax</CardTitle>
					<CardDescription>
						Standard derives the split from the line total. No tax or a manual split switches the
						lines to net amounts.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-1.5 sm:max-w-xs">
						<Label htmlFor="invoice-tax-mode">Tax treatment</Label>
						<Select value={taxMode} onValueChange={(value) => switchTaxMode(value as TaxMode)}>
							<SelectTrigger id="invoice-tax-mode" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="STANDARD">Standard 20% (derived)</SelectItem>
								<SelectItem value="NONE">No tax</SelectItem>
								<SelectItem value="MANUAL">Manual split</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{taxMode === "MANUAL" ? (
						<div className="grid gap-4 sm:grid-cols-3">
							<div className="grid gap-1.5">
								<Label htmlFor="invoice-vat">VAT</Label>
								<Input
									id="invoice-vat"
									inputMode="decimal"
									placeholder="0.00"
									value={manualVat}
									onChange={(event) => setManualVat(event.target.value)}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="invoice-nhil">NHIL</Label>
								<Input
									id="invoice-nhil"
									inputMode="decimal"
									placeholder="0.00"
									value={manualNhil}
									onChange={(event) => setManualNhil(event.target.value)}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="invoice-getfund">GETFund</Label>
								<Input
									id="invoice-getfund"
									inputMode="decimal"
									placeholder="0.00"
									value={manualGetfund}
									onChange={(event) => setManualGetfund(event.target.value)}
								/>
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Note</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						rows={2}
						maxLength={500}
						placeholder="Anything the finance team should know (optional)"
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</CardContent>
			</Card>

			{formError ? (
				<div
					role="alert"
					className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
				>
					<p>{formError}</p>
					{duplicateInvoiceId ? (
						<Button variant="link" size="sm" className="h-auto px-0" asChild>
							<Link to="/suppliers/invoices/$invoiceId" params={{ invoiceId: duplicateInvoiceId }}>
								Open the existing invoice
							</Link>
						</Button>
					) : null}
				</div>
			) : null}

			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button type="button" variant="outline" asChild>
					<Link to="/suppliers/invoices">Cancel</Link>
				</Button>
				<Button type="submit" disabled={saveMutation.isPending}>
					{saveMutation.isPending ? "Recording…" : "Record invoice"}
				</Button>
			</div>
		</form>
	)
}
