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
import { archiveUnit, reactivateUnit, unitListOptions } from "../api/catalog"
import { catalogKeys } from "../api/keys"
import { UnitDialog } from "../components/unit-dialog"
import type { Uom } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

export function UnitsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const queryClient = useQueryClient()
	const canCreate = hasPermission(session.user.role, "catalog.create")
	const canUpdate = hasPermission(session.user.role, "catalog.update")
	const canArchive = hasPermission(session.user.role, "catalog.archive")

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Uom | null>(null)
	const [confirmTarget, setConfirmTarget] = useState<{
		unit: Uom
		action: "archive" | "reactivate"
	} | null>(null)

	const unitsQuery = useQuery(unitListOptions({ includeArchived: true }))

	const units = unitsQuery.data?.uoms ?? []
	const showActions = canUpdate || canArchive

	const toggleMutation = useMutation({
		mutationFn: () => {
			if (!confirmTarget) throw new Error("Nothing to confirm")
			const { unit, action } = confirmTarget
			return action === "archive" ? archiveUnit(unit.id) : reactivateUnit(unit.id)
		},
		onSuccess: async () => {
			toast.success(confirmTarget?.action === "archive" ? "Unit archived" : "Unit reactivated")
			await queryClient.invalidateQueries({ queryKey: catalogKeys.uoms })
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
				<p className="text-sm text-muted-foreground">{units.length} units</p>
				{canCreate ? (
					<Button
						size="sm"
						onClick={() => {
							setEditing(null)
							setDialogOpen(true)
						}}
					>
						<PlusIcon className="size-4" />
						New unit
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-24">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-24">Status</TableHead>
							{showActions ? <TableHead className="w-44" /> : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{unitsQuery.isLoading ? (
							<TableMessage colSpan={showActions ? 4 : 3}>Loading units…</TableMessage>
						) : unitsQuery.isError ? (
							<TableMessage colSpan={showActions ? 4 : 3} tone="error">
								Couldn't load units.
							</TableMessage>
						) : units.length === 0 ? (
							<TableMessage colSpan={showActions ? 4 : 3}>
								No units yet. Add how you sell: piece, set, pair, box, litre.
							</TableMessage>
						) : (
							units.map((unit) => (
								<TableRow key={unit.id}>
									<TableCell className="font-mono text-xs">{unit.code}</TableCell>
									<TableCell className="font-medium">{unit.name}</TableCell>
									<TableCell>
										<ActiveBadge active={unit.isActive} />
									</TableCell>
									{showActions ? (
										<TableCell className="text-right">
											{canUpdate ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setEditing(unit)
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
															unit,
															action: unit.isActive ? "archive" : "reactivate",
														})
													}
												>
													{unit.isActive ? "Archive" : "Reactivate"}
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

			<UnitDialog open={dialogOpen} onOpenChange={setDialogOpen} unit={editing} />

			<ConfirmDialog
				open={confirmTarget !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmTarget(null)
				}}
				title={confirmTarget?.action === "archive" ? "Archive unit?" : "Reactivate unit?"}
				description={
					confirmTarget?.action === "archive"
						? "Archiving is blocked while active products still use this unit."
						: "The unit becomes selectable again for new products."
				}
				confirmLabel={confirmTarget?.action === "archive" ? "Archive" : "Reactivate"}
				destructive={confirmTarget?.action === "archive"}
				pending={toggleMutation.isPending}
				onConfirm={() => toggleMutation.mutate()}
			/>
		</section>
	)
}
