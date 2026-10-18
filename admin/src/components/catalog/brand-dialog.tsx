import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
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
import { ApiError, api } from "#/lib/api"
import type { Brand } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function BrandDialog({
	open,
	onOpenChange,
	brand,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	brand: Brand | null
}) {
	const queryClient = useQueryClient()
	const isEdit = brand !== null

	const [name, setName] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setName(brand?.name ?? "")
		setFormError(null)
	}, [open, brand])

	const saveMutation = useMutation({
		mutationFn: () =>
			isEdit && brand
				? api.catalog.brands.update(brand.id, { name })
				: api.catalog.brands.create({ name }),
		onSuccess: async () => {
			toast.success(isEdit ? "Brand updated" : "Brand created")
			await queryClient.invalidateQueries({ queryKey: ["brands"] })
			onOpenChange(false)
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
		saveMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit brand" : "New brand"}</DialogTitle>
					<DialogDescription>
						Brands group products by manufacturer or supplier label.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="brand-name">Name</Label>
						<Input
							id="brand-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create brand"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
