import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { StatusBadge } from "#/components/common/status-badge"
import { SupplierProductDialog } from "#/components/suppliers/supplier-product-dialog"
import { Button } from "#/components/ui/button"
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { SupplierProductMapping } from "#/lib/api-types"
import { formatDay, formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

export function SupplierProductsPanel({
	supplierId,
	products,
	canEdit,
}: {
	supplierId: string
	products: SupplierProductMapping[]
	canEdit: boolean
}) {
	const queryClient = useQueryClient()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<SupplierProductMapping | null>(null)
	const [removeTarget, setRemoveTarget] = useState<SupplierProductMapping | null>(null)

	const removeMutation = useMutation({
		mutationFn: (mapping: SupplierProductMapping) =>
			api.suppliers.removeProduct(supplierId, mapping.id),
		onSuccess: async () => {
			toast.success("Supplied product removed")
			await queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] })
			setRemoveTarget(null)
		},
		onError: (error) => toastApiError(error),
	})

	return (
		<Card>
			<CardHeader>
				<CardTitle>Supplied products</CardTitle>
				<CardDescription>
					Mappings with supplier SKUs and the last cost recorded on purchase invoices.
				</CardDescription>
				{canEdit ? (
					<CardAction>
						<Button
							size="sm"
							onClick={() => {
								setEditing(null)
								setDialogOpen(true)
							}}
						>
							<PlusIcon className="size-4" aria-hidden="true" />
							Add product
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{products.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No supplied products yet. Map a product to record its supplier SKU and last cost.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Product</TableHead>
								<TableHead className="w-40">Supplier SKU</TableHead>
								<TableHead className="w-28">Lead time</TableHead>
								<TableHead className="w-44 text-right">Last cost</TableHead>
								<TableHead className="w-28">Preferred</TableHead>
								{canEdit ? <TableHead className="w-32 text-right">Actions</TableHead> : null}
							</TableRow>
						</TableHeader>
						<TableBody>
							{products.map((mapping) => (
								<TableRow key={mapping.id}>
									<TableCell>
										<p className="font-medium">{mapping.productName}</p>
										<p className="font-mono text-xs text-muted-foreground">{mapping.productSku}</p>
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{mapping.supplierSku ?? "—"}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{mapping.leadTimeDays === null ? "—" : `${mapping.leadTimeDays} days`}
									</TableCell>
									<TableCell className="text-right">
										<p className="tabular-nums">{formatGhs(mapping.lastCostMinor)}</p>
										<p className="text-xs text-muted-foreground">
											{mapping.lastCostAt ? formatDay(mapping.lastCostAt) : "No invoice yet"}
										</p>
									</TableCell>
									<TableCell>
										{mapping.isPreferred ? (
											<StatusBadge tone="green">Preferred</StatusBadge>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									{canEdit ? (
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setEditing(mapping)
														setDialogOpen(true)
													}}
												>
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="text-destructive hover:text-destructive"
													onClick={() => setRemoveTarget(mapping)}
												>
													Remove
												</Button>
											</div>
										</TableCell>
									) : null}
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>

			<SupplierProductDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				supplierId={supplierId}
				mapping={editing}
			/>

			<Dialog
				open={removeTarget !== null}
				onOpenChange={(open) => {
					if (!open) setRemoveTarget(null)
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Remove {removeTarget?.productName ?? "mapping"}?</DialogTitle>
						<DialogDescription>
							The mapping stops being offered on purchase invoices. Existing invoice lines and
							last-cost history stay unchanged.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRemoveTarget(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={removeMutation.isPending}
							onClick={() => {
								if (removeTarget) removeMutation.mutate(removeTarget)
							}}
						>
							{removeMutation.isPending ? "Removing…" : "Remove mapping"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}
