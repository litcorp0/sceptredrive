import { parseCsv } from "@sceptre/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { UploadIcon } from "lucide-react"
import { type ChangeEvent, type FormEvent, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { openingKeys } from "../api/keys"
import { createOpening, previewOpening } from "../api/openings"
import { OpeningPreviewTable } from "../components/opening-preview-table"
import type { OpeningLineInput, OpeningPreview } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const MAX_FILE_BYTES = 2_000_000
const MAX_ROWS = 5_000

const HEADER_ALIASES: Record<string, keyof RawRow> = {
	sku: "sku",
	barcode: "barcode",
	name: "name",
	product: "name",
	category: "category",
	unit: "unit",
	uom: "unit",
	brand: "brand",
	price: "price",
	"selling price": "price",
	cost: "cost",
	"unit cost": "cost",
	quantity: "quantity",
	qty: "quantity",
	"counted quantity": "quantity",
	taxcategory: "taxCategory",
	"tax category": "taxCategory",
}

type RawRow = {
	sku?: string
	barcode?: string
	name: string
	category: string
	unit: string
	brand?: string
	price: string
	cost: string
	quantity: string
	taxCategory?: string
}

function normaliseHeader(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function parseFileText(text: string): OpeningLineInput[] {
	const parsed = parseCsv(text, { maxRows: MAX_ROWS })
	const columns = new Map<string, number>()
	for (const [index, header] of parsed.headers.entries()) {
		const key = HEADER_ALIASES[normaliseHeader(header)]
		if (key && !columns.has(key)) columns.set(key, index)
	}

	const missing = (["name", "category", "unit", "price", "cost", "quantity"] as const).filter(
		(key) => !columns.has(key),
	)
	if (missing.length > 0) {
		throw new Error(`The file is missing: ${missing.join(", ")}.`)
	}

	const rows: OpeningLineInput[] = []
	for (const [offset, cells] of parsed.rows.entries()) {
		const cell = (key: keyof RawRow) => {
			const index = columns.get(key)
			return index === undefined ? "" : (cells[index] ?? "").trim()
		}
		const name = cell("name")
		const category = cell("category")
		const unit = cell("unit")
		const price = cell("price")
		const cost = cell("cost")
		const quantity = cell("quantity")
		if (!name && !category && !unit && !price && !cost && !quantity) continue

		const tax = cell("taxCategory").toUpperCase()
		if (tax && !["STANDARD", "ZERO_RATED", "EXEMPT"].includes(tax)) {
			throw new Error(`Row ${offset + 2}: tax category must be STANDARD, ZERO_RATED or EXEMPT.`)
		}

		rows.push({
			lineNo: offset + 2,
			...(cell("sku") ? { sku: cell("sku") } : {}),
			...(cell("barcode") ? { barcode: cell("barcode") } : {}),
			name,
			category,
			unit,
			...(cell("brand") ? { brand: cell("brand") } : {}),
			price,
			cost,
			quantity,
			...(tax ? { taxCategory: tax as OpeningLineInput["taxCategory"] } : {}),
		})
	}

	if (rows.length === 0) throw new Error("The file has no data rows.")
	return rows
}

/**
 * The go-live upload: a manager prepares it, the admin posts it. The client parses the
 * CSV into JSON rows only; the server validates every field again and owns the value
 * arithmetic (OWASP A03/A05). Nothing is written until "Save draft".
 */
export function OpeningNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, activeBranch } = useBranch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const [rows, setRows] = useState<OpeningLineInput[]>([])
	const [preview, setPreview] = useState<OpeningPreview | null>(null)
	const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
	const [countedAt, setCountedAt] = useState(() => new Date().toISOString().slice(0, 10))
	const [note, setNote] = useState("")
	const [pasteValue, setPasteValue] = useState("")
	const [fileError, setFileError] = useState<string | null>(null)

	const branchId = activeBranchId
	const canDraft = hasPermission(session.user.role, "inventory.opening.draft")

	const previewMutation = useMutation({
		mutationFn: () => previewOpening(branchId as string, rows),
		onSuccess: (data) => {
			setPreview(data)
			setIdempotencyKey(crypto.randomUUID())
		},
		onError: (error) => {
			setPreview(null)
			if (error instanceof ApiError) {
				setFileError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const createMutation = useMutation({
		mutationFn: () =>
			createOpening({
				branchId: branchId as string,
				...(countedAt ? { countedAt } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
				idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
				rows,
			}),
		onSuccess: async (detail) => {
			toast.success("Opening draft saved")
			await queryClient.invalidateQueries({ queryKey: openingKeys.all })
			await navigate({
				to: "/inventory/openings/$openingId",
				params: { openingId: detail.opening.id },
			})
		},
		onError: (error) => toastApiError(error),
	})

	function acceptText(text: string): void {
		setFileError(null)
		setPreview(null)
		setIdempotencyKey(null)
		try {
			const parsed = parseFileText(text)
			setRows(parsed)
			setPasteValue(text)
		} catch (error) {
			setRows([])
			setFileError(error instanceof Error ? error.message : "The file could not be read")
		}
	}

	async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
		const file = event.target.files?.[0]
		if (!file) return
		if (file.size > MAX_FILE_BYTES) {
			setFileError("The file is larger than 2 MB. Split it by category or branch.")
			return
		}
		acceptText(await file.text())
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault()
		setFileError(null)
		if (!branchId) {
			setFileError("Choose a branch before importing stock.")
			return
		}
		if (rows.length === 0) {
			setFileError("Load or paste a file first.")
			return
		}
		previewMutation.mutate()
	}

	if (!canDraft) {
		return (
			<section>
				<PageHeader title="Go-live opening stock" />
				<StatusNote tone="warn">
					You do not have permission to prepare an opening stock document.
				</StatusNote>
			</section>
		)
	}

	return (
		<section className="mx-auto max-w-6xl">
			<PageHeader
				eyebrow="Inventory"
				title="Go-live opening stock"
				description="Load the shelf count and the catalogue rows it needs. A manager saves the draft; an admin posts its value."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/inventory/openings">Back to opening stock</Link>
					</Button>
				}
			/>

			{!branchId ? (
				<StatusNote tone="warn" className="mb-4">
					Choose a branch in the branch switcher. An opening document belongs to one branch.
				</StatusNote>
			) : (
				<StatusNote tone="info" className="mb-4">
					Posting at <strong>{activeBranch?.name ?? "the selected branch"}</strong>. The count is
					dated {countedAt || "today"}.
				</StatusNote>
			)}

			{fileError ? (
				<StatusNote tone="danger" className="mb-4">
					{fileError}
				</StatusNote>
			) : null}

			<form onSubmit={handleSubmit} className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle>1. The count file</CardTitle>
						<CardDescription>
							CSV columns: <code>name, category, unit, price, cost, quantity</code>. Optional:
							<code> sku, barcode, brand, taxCategory</code>. Use the physical count, not the old
							system's number. One row per product, and no product twice.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<div className="grid gap-1.5">
							<Label htmlFor="opening-file">Upload CSV</Label>
							<Input
								id="opening-file"
								type="file"
								accept=".csv,text/csv"
								onChange={(event) => void handleFile(event)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="opening-paste">…or paste the rows</Label>
							<Textarea
								id="opening-paste"
								rows={5}
								value={pasteValue}
								placeholder={
									"name,category,unit,price,cost,quantity\nBrake pad,brakes,piece,120.00,80.00,12"
								}
								onChange={(event) => setPasteValue(event.target.value)}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-fit"
								onClick={() => acceptText(pasteValue)}
							>
								Use pasted rows
							</Button>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label htmlFor="opening-counted-at">Count date</Label>
								<Input
									id="opening-counted-at"
									type="date"
									value={countedAt}
									onChange={(event) => setCountedAt(event.target.value)}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="opening-note">Note (optional)</Label>
								<Input
									id="opening-note"
									value={note}
									maxLength={300}
									placeholder="e.g. Physical count before go-live"
									onChange={(event) => setNote(event.target.value)}
								/>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={previewMutation.isPending || rows.length === 0}>
								<UploadIcon className="size-4" aria-hidden="true" />
								{previewMutation.isPending ? "Checking…" : `Preview ${rows.length} rows`}
							</Button>
							<p className="text-xs text-muted-foreground">
								{rows.length > 0
									? `${rows.length} rows loaded. The preview writes nothing.`
									: "No rows loaded yet."}
							</p>
						</div>
					</CardContent>
				</Card>

				{preview ? (
					<Card>
						<CardHeader>
							<CardTitle>2. Review</CardTitle>
							<CardDescription>
								{preview.lineCount} lines · {preview.totalUnits} units ·{" "}
								{formatGhs(preview.countedValueMinor)} counted value · {preview.newProductCount} new
								product(s)
								{preview.uncostedLineCount > 0
									? ` · ${preview.uncostedLineCount} uncosted line(s)`
									: ""}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3">
							{preview.canPost ? (
								<StatusNote tone="ok">
									Every row is ready. Saving creates a draft; the admin can post it.
								</StatusNote>
							) : (
								<StatusNote tone="danger">
									Fix the rows marked below. Nothing can be saved until every row is valid.
								</StatusNote>
							)}
							<OpeningPreviewTable preview={preview} />
						</CardContent>
					</Card>
				) : null}

				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						disabled={!preview?.canPost || createMutation.isPending || !branchId || !idempotencyKey}
						onClick={() => createMutation.mutate()}
					>
						{createMutation.isPending ? "Saving…" : "Save draft"}
					</Button>
					<p className="text-sm text-muted-foreground">
						The manager prepares; an admin posts. Nothing reaches the ledger until then.
					</p>
				</div>
			</form>
		</section>
	)
}
