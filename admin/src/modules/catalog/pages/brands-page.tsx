import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { archiveBrand, brandListOptions, reactivateBrand } from "../api/catalog"
import { catalogKeys } from "../api/keys"
import { BrandDialog } from "../components/brand-dialog"
import type { Brand } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

export function BrandsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const queryClient = useQueryClient()
	const canCreate = hasPermission(session.user.role, "catalog.create")
	const canUpdate = hasPermission(session.user.role, "catalog.update")
	const canArchive = hasPermission(session.user.role, "catalog.archive")

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Brand | null>(null)
	const [confirmTarget, setConfirmTarget] = useState<{
		brand: Brand
		action: "archive" | "reactivate"
	} | null>(null)

	const brandsQuery = useQuery(brandListOptions({ includeArchived: true }))

	const brands = brandsQuery.data?.brands ?? []
	const showActions = canUpdate || canArchive

	const toggleMutation = useMutation({
		mutationFn: () => {
			if (!confirmTarget) throw new Error("Nothing to confirm")
			const { brand, action } = confirmTarget
			return action === "archive" ? archiveBrand(brand.id) : reactivateBrand(brand.id)
		},
		onSuccess: async () => {
			toast.success(confirmTarget?.action === "archive" ? "Brand archived" : "Brand reactivated")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.brands })
			setConfirmTarget(null)
		},
		onError: (error) => {
			toastApiError(error)
			setConfirmTarget(null)
		},
	})

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">{brands.length} brands</p>
				{canCreate ? (
					<Button
						size="sm"
						onClick={() => {
							setEditing(null)
							setDialogOpen(true)
						}}
					>
						<PlusIcon className="size-4" />
						New brand
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
						{brandsQuery.isLoading ? (
							<TableMessage colSpan={showActions ? 3 : 2}>Loading brands…</TableMessage>
						) : brandsQuery.isError ? (
							<TableMessage colSpan={showActions ? 3 : 2} tone="error">
								Couldn't load brands.
							</TableMessage>
						) : brands.length === 0 ? (
							<TableMessage colSpan={showActions ? 3 : 2}>
								No brands yet. Create the first one to label products.
							</TableMessage>
						) : (
							brands.map((brand) => (
								<TableRow key={brand.id}>
									<TableCell className="font-medium">{brand.name}</TableCell>
									<TableCell>
										<ActiveBadge active={brand.isActive} />
									</TableCell>
									{showActions ? (
										<TableCell className="text-right">
											{canUpdate ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setEditing(brand)
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
															brand,
															action: brand.isActive ? "archive" : "reactivate",
														})
													}
												>
													{brand.isActive ? "Archive" : "Reactivate"}
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

			<BrandDialog open={dialogOpen} onOpenChange={setDialogOpen} brand={editing} />

			<ConfirmDialog
				open={confirmTarget !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmTarget(null)
				}}
				title={confirmTarget?.action === "archive" ? "Archive brand?" : "Reactivate brand?"}
				description={
					confirmTarget?.action === "archive"
						? "Archiving is blocked while active products still use this brand."
						: "The brand becomes selectable again for new products."
				}
				confirmLabel={confirmTarget?.action === "archive" ? "Archive" : "Reactivate"}
				destructive={confirmTarget?.action === "archive"}
				pending={toggleMutation.isPending}
				onConfirm={() => toggleMutation.mutate()}
			/>
		</section>
	)
}
