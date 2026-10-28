import { FLAG_DEFAULTS } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
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
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { settingsListOptions } from "#/modules/settings"
import { supplierKeys } from "../api/keys"
import { updateSupplierPaymentDetail } from "../api/suppliers"
import type { SupplierPaymentDetailView } from "../types"
import { momoNetworkLabel, paymentAccountDisplay } from "../utils/payment-detail"
import { PaymentDetailDialog } from "./payment-detail-dialog"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * The saved bank and mobile-money destinations, and what Paystack knows about each.
 *
 * `recipientReady` is the server's answer, never a guess: a detail with no recipient is not
 * broken, it simply has not been used yet. A transfer from a row is fixed to that supplier and
 * that destination, so the destination cannot silently change under the instruction (P14-D27).
 */
export function PaymentDetailsPanel({
	supplierId,
	paymentDetails,
	canEdit,
}: {
	supplierId: string
	paymentDetails: SupplierPaymentDetailView[]
	canEdit: boolean
}) {
	const { session } = authenticatedRoute.useRouteContext()
	const queryClient = useQueryClient()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<SupplierPaymentDetailView | null>(null)

	const canTransfer = hasPermission(session.user.role, "payable.transfer")
	const settingsQuery = useQuery({ ...settingsListOptions(), enabled: canTransfer })
	const flagRow = settingsQuery.data?.settings.find(
		(setting) => setting.key === "flag.supplierTransfers",
	)
	const transfersEnabled =
		typeof flagRow?.value === "boolean" ? flagRow.value : FLAG_DEFAULTS["flag.supplierTransfers"]

	const updateMutation = useMutation({
		mutationFn: (input: {
			detail: SupplierPaymentDetailView
			patch: { isDefault?: boolean; isActive?: boolean }
		}) => updateSupplierPaymentDetail(supplierId, input.detail.id, input.patch),
		onSuccess: async () => {
			toast.success("Payment detail updated")
			await queryClient.invalidateQueries({ queryKey: supplierKeys.byId(supplierId) })
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
								<TableHead className="w-44">Paystack recipient</TableHead>
								<TableHead className="w-40">Status</TableHead>
								{canEdit || (canTransfer && transfersEnabled) ? (
									<TableHead className="w-72 text-right">Actions</TableHead>
								) : null}
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
										<p className="font-mono text-xs">{paymentAccountDisplay(detail)}</p>
										{detail.accountName ? (
											<p className="text-xs text-muted-foreground">{detail.accountName}</p>
										) : null}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{detail.method === "BANK"
											? `${detail.bankName ?? "—"}${detail.bankCode ? ` (${detail.bankCode})` : ""}`
											: `${momoNetworkLabel(detail.momoNetwork)} · ${detail.phone ?? "—"}`}
									</TableCell>
									<TableCell>
										<StatusBadge variant={detail.recipientReady ? "ok" : "muted"}>
											{detail.recipientReady ? "Paystack ready" : "Created on first transfer"}
										</StatusBadge>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{detail.isDefault ? <StatusBadge tone="green">Default</StatusBadge> : null}
											<ActiveBadge active={detail.isActive} />
										</div>
									</TableCell>
									{canEdit || (canTransfer && transfersEnabled) ? (
										<TableCell className="text-right">
											<div className="flex flex-wrap justify-end gap-1">
												{canTransfer && transfersEnabled && detail.isActive ? (
													<Button asChild variant="outline" size="sm">
														<Link
															to="/suppliers/transfers"
															search={{
																supplierId,
																paymentDetailId: detail.id,
																dialog: "transfer",
															}}
														>
															Transfer
														</Link>
													</Button>
												) : null}
												{canEdit ? (
													<>
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
													</>
												) : null}
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
