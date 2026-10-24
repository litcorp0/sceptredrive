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
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { createUnit, updateUnit } from "../api/catalog"
import { catalogKeys } from "../api/keys"
import type { Uom } from "../types"

export function UnitDialog({
	open,
	onOpenChange,
	unit,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	unit: Uom | null
}) {
	const queryClient = useQueryClient()
	const isEdit = unit !== null

	const [code, setCode] = useState("")
	const [name, setName] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setCode(unit?.code ?? "")
		setName(unit?.name ?? "")
		setFormError(null)
	}, [open, unit])

	const saveMutation = useMutation({
		mutationFn: () => (isEdit && unit ? updateUnit(unit.id, { name }) : createUnit({ code, name })),
		onSuccess: async () => {
			toast.success(isEdit ? "Unit updated" : "Unit created")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.uoms })
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
					<DialogTitle>{isEdit ? "Edit unit" : "New unit"}</DialogTitle>
					<DialogDescription>
						Units describe how a product is sold: piece, set, pair, box, litre.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="unit-code">Code</Label>
							<Input
								id="unit-code"
								required
								minLength={2}
								maxLength={8}
								className="font-mono"
								placeholder="PCS"
								value={code}
								disabled={isEdit}
								onChange={(event) => setCode(event.target.value.toUpperCase())}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="unit-name">Name</Label>
							<Input
								id="unit-name"
								required
								minLength={2}
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
					</div>
					{isEdit ? (
						<p className="text-xs text-muted-foreground">
							Codes stay fixed after creation so reports keep matching.
						</p>
					) : null}

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
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create unit"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
