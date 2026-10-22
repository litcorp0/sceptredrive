import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { PaymentDetailDialog } from "#/components/suppliers/payment-detail-dialog"
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { SupplierPaymentDetailView } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function PaymentDetailsPanel({
	supplierId,
	paymentDetails,
	canEdit,
}: {
	supplierId: string
	paymentDetails: SupplierPaymentDetailView[]
	canEdit: boolean
}) {
	const queryClient = useQueryClient()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<SupplierPaymentDetailView | null>(null)

	const updateMutation = useMutation({
		mutationFn: (input: {
			detail: SupplierPaymentDetailView
			patch: { isDefault?: boolean; isActive?: boolean }
		}) => api.suppliers.updatePaymentDetail(supplierId, input.detail.id, input.patch),
		onSuccess: async () => {
			toast.success("Payment detail updated")
			await queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] })
		},
		onError: (error) => toastApiError(error),
	})

	return (
		<Card>
			<CardHeader>
				<CardTitle>Payment details</CardTitle>
				<CardDescription>
					Bank and mobile-money destinations used when paying this supplier.
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
							Add detail
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{paymentDetails.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No payment details yet. Add a bank account or MoMo wallet before paying this supplier.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-24">Method</TableHead>
								<TableHead className="w-36">Label</TableHead>
								<TableHead>Account</TableHead>
								<TableHead className="w-52">Bank / network</TableHead>
								<TableHead className="w-40">Status</TableHead>
								{canEdit ? <TableHead className="w-64 text-right">Actions</TableHead> : null}
							</TableRow>
						</TableHeader>
						<TableBody>
							{paymentDetails.map((detail) => (
								<TableRow key={detail.id} className={detail.isActive ? undefined : "opacity-60"}>
									<TableCell>
										<StatusBadge tone={detail.method === "BANK" ? "blue" : "amber"}>
											{detail.method === "BANK" ? "Bank" : "MoMo"}
										</StatusBadge>
									</TableCell>
									<TableCell className="text-muted-foreground">{detail.label ?? "—"}</TableCell>
									<TableCell>
										<p className="font-mono text-xs">
											{detail.accountNumber ?? detail.accountNumberMasked ?? "—"}
										</p>
										{detail.accountName ? (
											<p className="text-xs text-muted-foreground">{detail.accountName}</p>
										) : null}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{detail.method === "BANK"
											? `${detail.bankName ?? "—"}${detail.bankCode ? ` (${detail.bankCode})` : ""}`
											: `${networkLabel(detail.momoNetwork)} · ${detail.phone ?? "—"}`}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{detail.isDefault ? <StatusBadge tone="green">Default</StatusBadge> : null}
											<ActiveBadge active={detail.isActive} />
										</div>
									</TableCell>
									{canEdit ? (
										<TableCell className="text-right">
											<div className="flex flex-wrap justify-end gap-1">
												{detail.isActive && !detail.isDefault ? (
													<Button
														variant="ghost"
														size="sm"
														disabled={updateMutation.isPending}
														onClick={() =>
															updateMutation.mutate({ detail, patch: { isDefault: true } })
														}
													>
														Make default
													</Button>
												) : null}
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setEditing(detail)
														setDialogOpen(true)
													}}
												>
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													disabled={updateMutation.isPending}
													onClick={() =>
														updateMutation.mutate({
															detail,
															patch: { isActive: !detail.isActive },
														})
													}
												>
													{detail.isActive ? "Deactivate" : "Activate"}
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

			<PaymentDetailDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				supplierId={supplierId}
				detail={editing}
			/>
		</Card>
	)
}

function networkLabel(network: SupplierPaymentDetailView["momoNetwork"]) {
	if (network === "MTN") return "MTN MoMo"
	if (network === "VOD") return "Telecel Cash"
	if (network === "ATL") return "AirtelTigo Money"
	return "—"
}
