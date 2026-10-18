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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError, api } from "#/lib/api"
import type { Category } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

const TOP_LEVEL = "top-level"

export function CategoryDialog({
	open,
	onOpenChange,
	category,
	parents,
	hasChildren = false,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	category: Category | null
	/** Top-level, active categories selectable as a parent. */
	parents: Category[]
	/** Editing a category that has subcategories locks the parent selector. */
	hasChildren?: boolean
}) {
	const queryClient = useQueryClient()
	const isEdit = category !== null

	const [name, setName] = useState("")
	const [parentId, setParentId] = useState(TOP_LEVEL)
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setName(category?.name ?? "")
		setParentId(category?.parentId ?? TOP_LEVEL)
		setFormError(null)
	}, [open, category])

	const parentOptions = parents.filter(
		(item) => item.id !== category?.id && item.isActive && item.parentId === null,
	)

	const saveMutation = useMutation({
		mutationFn: () => {
			const payload = { name, parentId: parentId === TOP_LEVEL ? null : parentId }
			return isEdit && category
				? api.catalog.categories.update(category.id, payload)
				: api.catalog.categories.create(payload)
		},
		onSuccess: async () => {
			toast.success(isEdit ? "Category updated" : "Category created")
			await queryClient.invalidateQueries({ queryKey: ["categories"] })
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
					<DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
					<DialogDescription>
						Categories are two levels: a subcategory files under one top-level category.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="category-name">Name</Label>
						<Input
							id="category-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="category-parent">Files under</Label>
						<Select value={parentId} onValueChange={setParentId} disabled={hasChildren}>
							<SelectTrigger id="category-parent" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={TOP_LEVEL}>None (top-level category)</SelectItem>
								{parentOptions.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{hasChildren ? (
							<p className="text-xs text-muted-foreground">
								This category has subcategories, so it stays top-level.
							</p>
						) : null}
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
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create category"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
