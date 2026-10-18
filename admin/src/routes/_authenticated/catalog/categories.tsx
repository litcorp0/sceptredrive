import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { CategoryDialog } from "#/components/catalog/category-dialog"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { ActiveBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { Category } from "#/lib/api-types"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/catalog/categories")({
	component: CategoriesTab,
})

interface Row {
	category: Category
	depth: number
}

function CategoriesTab() {
	const { session } = Route.useRouteContext()
	const queryClient = useQueryClient()
	const canCreate = hasPermission(session.user.role, "catalog.create")
	const canUpdate = hasPermission(session.user.role, "catalog.update")
	const canArchive = hasPermission(session.user.role, "catalog.archive")

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Category | null>(null)
	const [confirmTarget, setConfirmTarget] = useState<{
		category: Category
		action: "archive" | "reactivate"
	} | null>(null)

	const categoriesQuery = useQuery({
		queryKey: ["categories", { includeArchived: true }],
		queryFn: () => api.catalog.categories.list({ includeArchived: true }),
	})

	const parents = categoriesQuery.data?.categories ?? []
	const rows: Row[] = parents.flatMap((parent) => [
		{ category: parent, depth: 0 },
		...parent.children.map((child) => ({ category: child, depth: 1 })),
	])

	const toggleMutation = useMutation({
		mutationFn: () => {
			if (!confirmTarget) throw new Error("Nothing to confirm")
			const { category, action } = confirmTarget
			return action === "archive"
				? api.catalog.categories.archive(category.id)
				: api.catalog.categories.reactivate(category.id)
		},
		onSuccess: async () => {
			toast.success(
				confirmTarget?.action === "archive" ? "Category archived" : "Category reactivated",
			)
			await queryClient.invalidateQueries({ queryKey: ["categories"] })
			setConfirmTarget(null)
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmTarget(null)
		},
	})

	const showActions = canUpdate || canArchive

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{parents.length} top-level ·{" "}
					{parents.reduce((sum, parent) => sum + parent.children.length, 0)} subcategories
				</p>
				{canCreate ? (
					<Button
						size="sm"
						onClick={() => {
							setEditing(null)
							setDialogOpen(true)
						}}
					>
						<PlusIcon className="size-4" />
						New category
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="w-24">Status</TableHead>
							{showActions ? <TableHead className="w-44" /> : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{categoriesQuery.isLoading ? (
							<TableMessage colSpan={showActions ? 3 : 2}>Loading categories…</TableMessage>
						) : categoriesQuery.isError ? (
							<TableMessage colSpan={showActions ? 3 : 2} tone="error">
								Couldn't load categories.
							</TableMessage>
						) : rows.length === 0 ? (
							<TableMessage colSpan={showActions ? 3 : 2}>
								No categories yet. Create the first one to group products.
							</TableMessage>
						) : (
							rows.map(({ category, depth }) => (
								<TableRow key={category.id}>
									<TableCell
										className={depth > 0 ? "text-muted-foreground" : "font-medium"}
										style={{ paddingLeft: 16 + depth * 28 }}
									>
										{depth > 0 ? <span aria-hidden="true">↳ </span> : null}
										{category.name}
									</TableCell>
									<TableCell>
										<ActiveBadge active={category.isActive} />
									</TableCell>
									{showActions ? (
										<TableCell className="text-right">
											{canUpdate ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setEditing(category)
														setDialogOpen(true)
													}}
												>
													Edit
												</Button>
											) : null}
											{canArchive ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														setConfirmTarget({
															category,
															action: category.isActive ? "archive" : "reactivate",
														})
													}
												>
													{category.isActive ? "Archive" : "Reactivate"}
												</Button>
											) : null}
										</TableCell>
									) : null}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<CategoryDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				category={editing}
				parents={parents}
				hasChildren={
					editing
						? parents.some((parent) => parent.id === editing.id && parent.children.length > 0)
						: false
				}
			/>

			<ConfirmDialog
				open={confirmTarget !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmTarget(null)
				}}
				title={confirmTarget?.action === "archive" ? "Archive category?" : "Reactivate category?"}
				description={
					confirmTarget?.action === "archive"
						? "Archiving is blocked while active subcategories or products still use this category."
						: "The category becomes selectable again for new products."
				}
				confirmLabel={confirmTarget?.action === "archive" ? "Archive" : "Reactivate"}
				destructive={confirmTarget?.action === "archive"}
				pending={toggleMutation.isPending}
				onConfirm={() => toggleMutation.mutate()}
			/>
		</section>
	)
}
