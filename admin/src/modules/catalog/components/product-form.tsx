import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SparklesIcon } from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { toast } from "sonner"
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
import { formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { settingsListOptions } from "#/modules/settings"
import { catalogKeys } from "../api/keys"
import {
	createProduct,
	suggestBarcodeOptions,
	suggestProductSku,
	updateProduct,
} from "../api/products"
import type { Brand, CategoryTreeNode, ProductRow, TaxCategory, TaxMode, Uom } from "../types"
import { TaxPreview } from "./tax-preview"

const NO_BRAND = "none"

export interface ProductFormValues {
	sku: string
	name: string
	description: string
	categoryId: string
	brandId: string
	uomId: string
	taxCategory: TaxCategory
	basePrice: string
	/** Optional fallback cost; a goods receipt's average always wins (P20-D12). */
	costPrice: string
}

const EMPTY_VALUES: ProductFormValues = {
	sku: "",
	name: "",
	description: "",
	categoryId: "",
	brandId: NO_BRAND,
	uomId: "",
	taxCategory: "STANDARD",
	basePrice: "",
	costPrice: "",
}

function valuesFromProduct(product: ProductRow): ProductFormValues {
	return {
		sku: product.sku,
		name: product.name,
		description: product.description ?? "",
		categoryId: product.categoryId,
		brandId: product.brandId ?? NO_BRAND,
		uomId: product.uomId,
		taxCategory: product.taxCategory,
		basePrice: formatMinorPlain(product.basePriceMinor),
		costPrice: product.costPriceMinor > 0 ? formatMinorPlain(product.costPriceMinor) : "",
	}
}

export function ProductForm({
	mode,
	initialProduct = null,
	categories,
	brands,
	units,
	readOnly = false,
	descriptionEditable = false,
	barcodeEditor,
	createBarcodes,
	onSaved,
}: {
	mode: "create" | "edit"
	initialProduct?: ProductRow | null
	categories: CategoryTreeNode[]
	brands: Brand[]
	units: Uom[]
	readOnly?: boolean
	/**
	 * 17-02: a branch manager may fix a description even though the identity and
	 * commercial fields stay read-only. The API enforces the same split.
	 */
	descriptionEditable?: boolean
	barcodeEditor?: ReactNode
	/** Barcodes submitted with a create (the API takes them in one call). */
	createBarcodes?: string[]
	onSaved?: (product: ProductRow) => void
}) {
	const queryClient = useQueryClient()
	const isEdit = mode === "edit"

	// The tax mode is a settings value, not a form value: the form reads it so the price labels
	// and the tax preview agree with what the API will charge.
	const settingsQuery = useQuery(settingsListOptions({}))
	const taxMode =
		(settingsQuery.data?.settings.find((setting) => setting.key === "pricing.taxMode")?.value as
			| TaxMode
			| undefined) ?? "INCLUSIVE"

	const [values, setValues] = useState<ProductFormValues>(EMPTY_VALUES)
	const [formError, setFormError] = useState<string | null>(null)
	const [priceError, setPriceError] = useState<string | null>(null)
	const [suggesting, setSuggesting] = useState(false)

	// What a product saved with no barcode will be given. A peek, not an allocation:
	// the code is assigned inside the create transaction (P20-D11).
	const barcodeHint = useQuery({
		...suggestBarcodeOptions(),
		enabled: !isEdit && !readOnly && (createBarcodes?.length ?? 0) === 0,
	})

	useEffect(() => {
		setValues(initialProduct ? valuesFromProduct(initialProduct) : EMPTY_VALUES)
		setFormError(null)
		setPriceError(null)
	}, [initialProduct])

	useEffect(() => {
		if (isEdit || readOnly) return
		let cancelled = false
		void suggestProductSku()
			.then((suggestion) => {
				if (cancelled) return
				setValues((current) => (current.sku ? current : { ...current, sku: suggestion.sku }))
			})
			.catch(() => undefined)
		return () => {
			cancelled = true
		}
	}, [isEdit, readOnly])

	function update<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
		setValues((current) => ({ ...current, [key]: value }))
	}

	async function handleSuggest() {
		setSuggesting(true)
		try {
			const suggestion = await suggestProductSku()
			update("sku", suggestion.sku)
		} catch (error) {
			toastApiError(error)
		} finally {
			setSuggesting(false)
		}
	}

	const saveMutation = useMutation({
		mutationFn: () => {
			const basePriceMinor = parseGhsToMinor(values.basePrice)
			if (basePriceMinor === null) {
				setPriceError("Enter a valid amount, e.g. 95.00")
				throw new Error("invalid price")
			}

			// Empty is "no fallback"; a typed 0.00 is the same thing to the server, so the
			// field can be cleared without inventing a cost.
			const costPriceMinor =
				values.costPrice.trim() === "" ? undefined : parseGhsToMinor(values.costPrice)
			if (costPriceMinor === null) {
				setFormError("Enter a valid cost, e.g. 72.50")
				throw new Error("invalid cost")
			}

			const payload = {
				sku: values.sku.trim() || undefined,
				name: values.name.trim(),
				description: values.description.trim() || undefined,
				categoryId: values.categoryId,
				brandId: values.brandId === NO_BRAND ? null : values.brandId,
				uomId: values.uomId,
				basePriceMinor,
				costPriceMinor,
				taxCategory: values.taxCategory,
			}

			if (isEdit && initialProduct) {
				return updateProduct(initialProduct.id, payload)
			}
			return createProduct({ ...payload, barcodes: createBarcodes })
		},
		onSuccess: async (data) => {
			toast.success(isEdit ? "Product saved" : "Product created")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.products })
			if (isEdit && initialProduct) {
				await queryClient.invalidateQueries({
					queryKey: catalogKeys.productDetail(initialProduct.id),
				})
			}
			onSaved?.(data.product)
		},
		onError: (error) => {
			if (error instanceof Error && !("status" in error)) {
				if (error.message === "invalid price" || error.message === "invalid cost") return
				setFormError(error.message)
				return
			}
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
		setPriceError(null)
		saveMutation.mutate()
	}

	const basePriceMinor = parseGhsToMinor(values.basePrice)
	const disabled = readOnly || saveMutation.isPending
	// Only the description survives a read-only form for a manager.
	const descriptionDisabled = saveMutation.isPending || (readOnly && !descriptionEditable)

	const categoryOptions = categories.flatMap((parent) => [
		{ id: parent.id, label: parent.name, active: parent.isActive },
		...parent.children.map((child) => ({
			id: child.id,
			label: `${parent.name} / ${child.name}`,
			active: child.isActive,
		})),
	])

	return (
		<form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div className="rounded-lg border bg-card p-4">
				<div className="grid gap-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="product-sku">SKU</Label>
							<div className="flex gap-2">
								<Input
									id="product-sku"
									required
									minLength={2}
									maxLength={32}
									className="font-mono"
									placeholder="SDP-00001"
									value={values.sku}
									disabled={disabled}
									onChange={(event) => update("sku", event.target.value.toUpperCase())}
								/>
								{!isEdit && !readOnly ? (
									<Button
										type="button"
										variant="outline"
										disabled={suggesting}
										onClick={handleSuggest}
									>
										<SparklesIcon className="size-4" />
										{suggesting ? "…" : "Suggest"}
									</Button>
								) : null}
							</div>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="product-name">Name</Label>
							<Input
								id="product-name"
								required
								minLength={2}
								maxLength={120}
								value={values.name}
								disabled={disabled}
								onChange={(event) => update("name", event.target.value)}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="product-category">Category</Label>
							<Select
								value={values.categoryId}
								onValueChange={(value) => update("categoryId", value)}
								disabled={disabled}
							>
								<SelectTrigger id="product-category" className="w-full">
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
							<Label htmlFor="product-brand">Brand</Label>
							<Select
								value={values.brandId}
								onValueChange={(value) => update("brandId", value)}
								disabled={disabled}
							>
								<SelectTrigger id="product-brand" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_BRAND}>No brand</SelectItem>
									{brands.map((brand) => (
										<SelectItem key={brand.id} value={brand.id} disabled={!brand.isActive}>
											{brand.name}
											{brand.isActive ? "" : " (archived)"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="product-unit">Unit</Label>
							<Select
								value={values.uomId}
								onValueChange={(value) => update("uomId", value)}
								disabled={disabled}
							>
								<SelectTrigger id="product-unit" className="w-full">
									<SelectValue placeholder="Pick a unit" />
								</SelectTrigger>
								<SelectContent>
									{units.map((unit) => (
										<SelectItem key={unit.id} value={unit.id} disabled={!unit.isActive}>
											{`${unit.code} · ${unit.name}`}
											{unit.isActive ? "" : " (archived)"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="product-tax">Tax category</Label>
							<Select
								value={values.taxCategory}
								onValueChange={(value) => update("taxCategory", value as TaxCategory)}
								disabled={disabled}
							>
								<SelectTrigger id="product-tax" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="STANDARD">Standard (VAT 20% total)</SelectItem>
									<SelectItem value="ZERO_RATED">Zero-rated (0%)</SelectItem>
									<SelectItem value="EXEMPT">Exempt (0%)</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/*
					 * The cost here is a **fallback**, not the authority (P20-D12). Sales are costed
					 * from the branch's moving average, which only a goods receipt sets
					 * (`costForSale`); this field covers the products whose stock never arrived through
					 * one — an opening count, or a part carried since before the system — so their
					 * margin is not reported as "uncosted" forever. A receipt still wins.
					 */}
					<div className="grid gap-1.5 sm:max-w-xs">
						<Label htmlFor="product-cost-price">
							Cost price
							<span className="ml-1 text-xs font-normal text-muted-foreground">optional</span>
						</Label>
						<div className="relative">
							<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
								GHS
							</span>
							<Input
								id="product-cost-price"
								className="pl-10 tabular-nums"
								inputMode="decimal"
								placeholder="0.00"
								value={values.costPrice}
								disabled={disabled}
								onChange={(event) => update("costPrice", event.target.value)}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Used for margin until a goods receipt sets this branch&apos;s average. The receipt
							always wins.
						</p>
					</div>

					<div className="grid gap-1.5 sm:max-w-xs">
						<Label htmlFor="product-base-price">
							Base selling price{taxMode === "INCLUSIVE" ? " (tax included)" : ""}
						</Label>
						<div className="relative">
							<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
								GHS
							</span>
							<Input
								id="product-base-price"
								required
								className="pl-10 tabular-nums"
								value={values.basePrice}
								disabled={disabled}
								onChange={(event) => update("basePrice", event.target.value)}
							/>
						</div>
						{priceError ? (
							<p role="alert" className="text-xs text-destructive">
								{priceError}
							</p>
						) : null}
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="product-description">Description</Label>
						<Textarea
							id="product-description"
							rows={2}
							maxLength={500}
							value={values.description}
							disabled={descriptionDisabled}
							onChange={(event) => update("description", event.target.value)}
						/>
					</div>

					{barcodeEditor}
					{!isEdit && !readOnly && (createBarcodes?.length ?? 0) === 0 && barcodeHint.data ? (
						<p className="text-xs text-muted-foreground" data-testid="barcode-hint">
							Saved without a barcode, this product gets{" "}
							<span className="font-mono">{barcodeHint.data.barcode}</span>.
						</p>
					) : null}

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					{readOnly && !descriptionEditable ? (
						<p className="text-sm text-muted-foreground">
							This product is archived, or you may not edit it. Reactivate it to make changes.
						</p>
					) : (
						<div className="flex justify-end">
							<Button type="submit" disabled={disabled && !descriptionEditable}>
								{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create product"}
							</Button>
						</div>
					)}
				</div>
			</div>

			<div className="lg:sticky lg:top-20 lg:self-start">
				<TaxPreview
					priceMinor={basePriceMinor}
					taxCategory={values.taxCategory}
					taxMode={taxMode}
				/>
			</div>
		</form>
	)
}
