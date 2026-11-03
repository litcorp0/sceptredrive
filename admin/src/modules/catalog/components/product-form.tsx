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
import { createProduct, suggestProductSku, updateProduct } from "../api/products"
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

			const payload = {
				sku: values.sku.trim() || undefined,
				name: values.name.trim(),
				description: values.description.trim() || undefined,
				categoryId: values.categoryId,
				brandId: values.brandId === NO_BRAND ? null : values.brandId,
				uomId: values.uomId,
				basePriceMinor,
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
				if (error.message === "invalid price") return
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
					 * No cost field: the catalogue cost follows the latest goods receipt (P11-D13), and a
					 * branch average can also come from an opening-stock adjustment (17-05).
					 * The read-only line lives on the product detail page, beside the price history;
					 * a form field here would be a second, editable source of truth and the API
					 * rejects it (`productUpdateSchema` is strict).
					 */}
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
