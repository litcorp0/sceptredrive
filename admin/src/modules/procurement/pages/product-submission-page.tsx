import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
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
import { formatGhs, parseGhsToMinor } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
// The catalogue owns the reference data a proposal names; the approval is procurement's.
import { brandListOptions, categoryListOptions, unitListOptions } from "#/modules/catalog"
import { submitProductProposal } from "../api/approvals"
import { approvalKeys } from "../api/keys"
import type { ProductSubmissionInput } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const NO_BRAND = "none"

/**
 * A manager's product proposal (MGR-02, P11-D7).
 *
 * The form records a decision request, not a product: nothing appears in the catalogue until an
 * administrator approves the `PRODUCT_CREATE` approval. An admin is pointed at the ordinary create
 * screen instead, because the API refuses a submission from the person who would have to decide it.
 */
export function ProductSubmissionPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const isAdmin = session.user.role === "ADMIN"
	const canSubmit = hasPermission(session.user.role, "procurement.create")

	const [name, setName] = useState("")
	const [categoryId, setCategoryId] = useState("")
	const [uomId, setUomId] = useState("")
	const [brandId, setBrandId] = useState<string>(NO_BRAND)
	const [description, setDescription] = useState("")
	const [price, setPrice] = useState("")
	const [barcode, setBarcode] = useState("")
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [note, setNote] = useState("")
	const [priceError, setPriceError] = useState<string | null>(null)
	const [formError, setFormError] = useState<string | null>(null)

	const categoriesQuery = useQuery(categoryListOptions({ includeArchived: true }))
	const brandsQuery = useQuery(brandListOptions())
	const unitsQuery = useQuery(unitListOptions())

	const submitMutation = useMutation({
		mutationFn: (input: ProductSubmissionInput) => submitProductProposal(input),
		onSuccess: async () => {
			toast.success("Submitted for approval — an admin will decide.")
			await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
			await navigate({ to: "/catalog/products" })
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	if (isAdmin) {
		return (
			<section className="mx-auto max-w-3xl">
				<BackLink />
				<h2 className="text-lg font-semibold tracking-tight">Submit a product</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Submission is for branch managers. Create the product directly in the catalogue; the
					server refuses a submission from the person who would decide it.
				</p>
				<Button className="mt-4" asChild>
					<Link to="/catalog/products/new">Create a product</Link>
				</Button>
			</section>
		)
	}

	if (!canSubmit) {
		return (
			<section className="mx-auto max-w-3xl">
				<BackLink />
				<p className="text-sm text-muted-foreground">
					You don't have permission to submit products.
				</p>
			</section>
		)
	}

	const categoryOptions = (categoriesQuery.data?.categories ?? []).flatMap((parent) => [
		{ id: parent.id, label: parent.name, active: parent.isActive },
		...parent.children.map((child) => ({
			id: child.id,
			label: `${parent.name} / ${child.name}`,
			active: child.isActive,
		})),
	])
	const loadingCatalog = categoriesQuery.isLoading || brandsQuery.isLoading || unitsQuery.isLoading
	const catalogError = categoriesQuery.isError || brandsQuery.isError || unitsQuery.isError

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		setPriceError(null)

		const proposedBasePriceMinor = parseGhsToMinor(price)
		if (proposedBasePriceMinor === null || proposedBasePriceMinor < 1) {
			setPriceError("Enter a selling price above zero, e.g. 95.00")
			return
		}
		if (name.trim().length < 2) {
			setFormError("Enter a product name of at least two characters.")
			return
		}
		if (!categoryId) {
			setFormError("Choose a category.")
			return
		}
		if (!uomId) {
			setFormError("Choose a unit of measure.")
			return
		}
		if (barcode.trim() && !/^[A-Za-z0-9-]{6,64}$/.test(barcode.trim())) {
			setFormError("A barcode is 6–64 letters, digits or dashes.")
			return
		}

		submitMutation.mutate({
			name: name.trim(),
			categoryId,
			uomId,
			...(brandId !== NO_BRAND ? { brandId } : {}),
			...(description.trim() ? { description: description.trim() } : {}),
			proposedBasePriceMinor,
			...(barcode.trim() ? { barcode: barcode.trim() } : {}),
			...(supplier ? { supplierId: supplier.id } : {}),
			...(note.trim() ? { note: note.trim() } : {}),
		})
	}

	const busy = submitMutation.isPending

	return (
		<section className="mx-auto max-w-3xl">
			<BackLink />
			<h2 className="text-lg font-semibold tracking-tight">Submit a product</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				This creates an approval request, not a product. An administrator decides; only then does it
				appear in the catalogue.
			</p>

			<form onSubmit={handleSubmit} className="mt-4 grid gap-4">
				{catalogError ? (
					<p
						role="alert"
						className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
					>
						Couldn't load the catalogue's categories, brands or units. Reload the page and try
						again.
					</p>
				) : null}
				<Card>
					<CardHeader>
						<CardTitle>Product</CardTitle>
						<CardDescription>
							The SKU is allocated by the server when the proposal is approved.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<div className="grid gap-1.5">
							<Label htmlFor="submission-name">Name</Label>
							<Input
								id="submission-name"
								required
								minLength={2}
								maxLength={120}
								value={name}
								disabled={busy}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label htmlFor="submission-category">Category</Label>
								<Select
									value={categoryId || undefined}
									onValueChange={setCategoryId}
									disabled={busy || loadingCatalog}
								>
									<SelectTrigger id="submission-category" className="w-full">
										<SelectValue placeholder="Pick a category" />
									</SelectTrigger>
									<SelectContent>
										{categoryOptions.map((option) => (
											<SelectItem key={option.id} value={option.id} disabled={!option.active}>
												{option.label}
												{option.active ? "" : " (archived)"}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="submission-unit">Unit</Label>
								<Select
									value={uomId || undefined}
									onValueChange={setUomId}
									disabled={busy || loadingCatalog}
								>
									<SelectTrigger id="submission-unit" className="w-full">
										<SelectValue placeholder="Pick a unit" />
									</SelectTrigger>
									<SelectContent>
										{(unitsQuery.data?.uoms ?? []).map((unit) => (
											<SelectItem key={unit.id} value={unit.id} disabled={!unit.isActive}>
												{`${unit.code} · ${unit.name}`}
												{unit.isActive ? "" : " (archived)"}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label htmlFor="submission-brand">Brand (optional)</Label>
								<Select
									value={brandId}
									onValueChange={setBrandId}
									disabled={busy || loadingCatalog}
								>
									<SelectTrigger id="submission-brand" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NO_BRAND}>No brand</SelectItem>
										{(brandsQuery.data?.brands ?? []).map((brand) => (
											<SelectItem key={brand.id} value={brand.id} disabled={!brand.isActive}>
												{brand.name}
												{brand.isActive ? "" : " (archived)"}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="submission-barcode">Barcode (optional)</Label>
								<Input
									id="submission-barcode"
									className="font-mono"
									minLength={6}
									maxLength={64}
									value={barcode}
									disabled={busy}
									onChange={(event) => setBarcode(event.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Letters, digits and dashes. The approval fails if it is already in use.
								</p>
							</div>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="submission-description">Description (optional)</Label>
							<Textarea
								id="submission-description"
								rows={2}
								maxLength={500}
								value={description}
								disabled={busy}
								onChange={(event) => setDescription(event.target.value)}
							/>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Proposal</CardTitle>
						<CardDescription>
							The selling price is the figure the administrator is deciding. Costs come from goods
							receipts, never from this form.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<div className="grid gap-1.5 sm:max-w-xs">
							<Label htmlFor="submission-price">Proposed selling price (GHS)</Label>
							<div className="relative">
								<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
									GHS
								</span>
								<Input
									id="submission-price"
									className="pl-10 tabular-nums"
									inputMode="decimal"
									placeholder="0.00"
									value={price}
									disabled={busy}
									onChange={(event) => setPrice(event.target.value)}
								/>
							</div>
							{priceError ? (
								<p role="alert" className="text-xs text-destructive">
									{priceError}
								</p>
							) : parseGhsToMinor(price) !== null ? (
								<p className="text-xs text-muted-foreground">
									{formatGhs(parseGhsToMinor(price) ?? 0)}
								</p>
							) : null}
						</div>

						<div className="grid gap-1.5">
							<Label>Preferred supplier (optional)</Label>
							<SupplierCombobox value={supplier} onSelect={setSupplier} disabled={busy} />
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="submission-note">Note for the approver (optional)</Label>
							<Textarea
								id="submission-note"
								rows={2}
								maxLength={300}
								value={note}
								disabled={busy}
								onChange={(event) => setNote(event.target.value)}
							/>
						</div>
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
					<Button type="button" variant="outline" asChild>
						<Link to="/catalog/products">Cancel</Link>
					</Button>
					<Button type="submit" disabled={busy}>
						{busy ? "Submitting…" : "Submit for approval"}
					</Button>
				</div>
			</form>
		</section>
	)
}

function BackLink() {
	return (
		<Link
			to="/catalog/products"
			className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeftIcon className="size-4" aria-hidden="true" />
			Products
		</Link>
	)
}
