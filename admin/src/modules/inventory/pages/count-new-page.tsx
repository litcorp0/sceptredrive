import { formatBranchLabel } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { type FormEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
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
import { toastApiError } from "#/lib/toast"
import { categoryListOptions } from "#/modules/catalog"
import { createCount } from "../api/counts"
import { countKeys } from "../api/keys"

const authenticatedRoute = getRouteApi("/_authenticated")

export function CountNewPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { branches, activeBranchId, isLoading } = useBranch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const selectableBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches])

	const [branchId, setBranchId] = useState<string>(session.user.branchId ?? activeBranchId ?? "")
	const [categoryId, setCategoryId] = useState<string>("all")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const categoriesQuery = useQuery(categoryListOptions({ includeArchived: false }))

	const categories = categoriesQuery.data?.categories ?? []

	const createMutation = useMutation({
		mutationFn: (input: { branchId: string; categoryId?: string; note?: string }) =>
			createCount(input),
		onSuccess: async (data) => {
			toast.success(`Count ${data.count.number} opened`)
			await queryClient.invalidateQueries({ queryKey: countKeys.all })
			await navigate({
				to: "/inventory/counts/$countId",
				params: { countId: data.count.id },
			})
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
		if (!branchId) {
			setFormError("Choose a branch to count.")
			return
		}
		createMutation.mutate({
			branchId,
			...(categoryId !== "all" ? { categoryId } : {}),
			...(note.trim() ? { note: note.trim() } : {}),
		})
	}

	return (
		<section className="mx-auto max-w-2xl">
			<PageHeader
				title="New stock count"
				description="Freeze the branch's level book and record what is physically on the shelf."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/inventory/counts">
							<ChevronLeftIcon className="size-4" aria-hidden="true" />
							Back to counts
						</Link>
					</Button>
				}
			/>

			<form onSubmit={handleSubmit} className="grid gap-5">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="count-branch">Branch</Label>
						<Select value={branchId || undefined} onValueChange={setBranchId}>
							<SelectTrigger id="count-branch">
								<SelectValue placeholder={isLoading ? "Loading…" : "Choose branch"} />
							</SelectTrigger>
							<SelectContent>
								{selectableBranches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{formatBranchLabel(branch)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="count-category">Category filter (optional)</Label>
						<Select value={categoryId} onValueChange={setCategoryId}>
							<SelectTrigger id="count-category">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All categories</SelectItem>
								{categories.map((parent) => (
									<SelectItem key={parent.id} value={parent.id}>
										{parent.name}
									</SelectItem>
								))}
								{categories.flatMap((parent) =>
									parent.children.map((child) => (
										<SelectItem key={child.id} value={child.id}>
											{`${parent.name} / ${child.name}`}
										</SelectItem>
									)),
								)}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="count-note">Note (optional)</Label>
					<Textarea
						id="count-note"
						value={note}
						onChange={(event) => setNote(event.target.value)}
						maxLength={300}
						rows={3}
						placeholder="e.g. Month-end count — aisle A"
					/>
				</div>

				{formError ? (
					<p role="alert" className="text-sm text-destructive">
						{formError}
					</p>
				) : null}

				<div className="flex justify-end gap-2">
					<Button asChild variant="outline">
						<Link to="/inventory/counts">Cancel</Link>
					</Button>
					<Button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending ? "Opening…" : "Open count"}
					</Button>
				</div>
			</form>
		</section>
	)
}
