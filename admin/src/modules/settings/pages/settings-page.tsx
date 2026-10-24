import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { settingsKeys } from "../api/keys"
import { settingsListOptions, settingsUpdate } from "../api/settings"
import type { SettingMeta } from "../types"
import { SettingRow } from "../ui/setting-row"

const routeApi = getRouteApi("/_authenticated/settings")

const SETTING_META: SettingMeta[] = [
	{
		key: "auth.requireTwoFactor",
		group: "Security",
		label: "Require two-factor authentication",
		description:
			"Administrators must set up an authenticator app before using the console. Enable 2FA on your own account before turning this on.",
		type: "switch",
	},
	{
		key: "staff.idPrefix",
		group: "Staff IDs",
		label: "Staff ID prefix",
		description: "Prefix for staff IDs, e.g. GA-0001.",
		type: "text",
	},
	{
		key: "staff.idSequence",
		group: "Staff IDs",
		label: "Next staff number",
		description: "The next number to allocate. Changing this affects new accounts only.",
		type: "int",
	},
	{
		key: "catalog.skuPrefix",
		group: "Catalog",
		label: "SKU prefix",
		description: "Prefix for auto-generated product SKUs, e.g. GIK-00001.",
		type: "text",
	},
	{
		key: "catalog.skuSequence",
		group: "Catalog",
		label: "Next SKU number",
		description: "The next number for new products. Saving a suggested SKU advances it.",
		type: "int",
	},
	{
		key: "pricing.taxMode",
		group: "Pricing",
		label: "Tax mode",
		description:
			"Inclusive: entered prices already contain VAT, NHIL, and GETFund. Exclusive: tax is added on top.",
		type: "select",
		options: [
			{ value: "INCLUSIVE", label: "Tax-inclusive prices" },
			{ value: "EXCLUSIVE", label: "Tax-exclusive prices" },
		],
	},
	{
		key: "receipt.header",
		group: "Receipts",
		label: "Receipt header",
		description: "Printed at the top of every receipt. Can differ per branch.",
		type: "text",
	},
	{
		key: "loyalty.earnPointsPerCedi",
		group: "Loyalty",
		label: "Points earned per GHS 1",
		description: "Whole points earned per cedi spent (calculated with a floor per sale).",
		type: "int",
	},
	{
		key: "loyalty.pointsPerCedi",
		group: "Loyalty",
		label: "Points per GHS 1 discount",
		description: "How many points are worth GHS 1 when redeemed.",
		type: "decimal",
	},
	{
		key: "loyalty.expiryMonths",
		group: "Loyalty",
		label: "Points expiry (months)",
		description: "Points expire after this many months.",
		type: "int",
	},
	{
		key: "loyalty.minimumRedeemPoints",
		group: "Loyalty",
		label: "Minimum redemption (points)",
		description: "The smallest redemption accepted at the till and in the console.",
		type: "int",
	},
	{
		key: "credit.repaymentPrefix",
		group: "Credit",
		label: "Repayment receipt prefix",
		description: "Prefix for credit repayment receipts, e.g. REP-00001.",
		type: "text",
	},
	{
		key: "credit.repaymentSequence",
		group: "Credit",
		label: "Next repayment number",
		description: "The next repayment number to allocate. Changing this affects new receipts only.",
		type: "int",
	},
	{
		key: "supplier.codePrefix",
		group: "Suppliers & Payables",
		label: "Supplier code prefix",
		description: "Prefix for supplier codes, e.g. SUP-00001. 1–8 letters or digits.",
		type: "text",
	},
	{
		key: "supplier.codeSequence",
		group: "Suppliers & Payables",
		label: "Next supplier number",
		description:
			"The next supplier number to allocate. It advances only when a supplier is created; gaps are acceptable.",
		type: "int",
	},
	{
		key: "payable.invoicePrefix",
		group: "Suppliers & Payables",
		label: "Purchase invoice prefix",
		description: "Prefix for purchase invoice numbers, e.g. SINV-00001. 1–8 letters or digits.",
		type: "text",
	},
	{
		key: "payable.invoiceSequence",
		group: "Suppliers & Payables",
		label: "Next purchase invoice number",
		description:
			"The next purchase invoice number to allocate. It advances only when an invoice is recorded; gaps are acceptable.",
		type: "int",
	},
	{
		key: "payable.paymentPrefix",
		group: "Suppliers & Payables",
		label: "Supplier payment prefix",
		description: "Prefix for supplier payment numbers, e.g. PAY-00001. 1–8 letters or digits.",
		type: "text",
	},
	{
		key: "payable.paymentSequence",
		group: "Suppliers & Payables",
		label: "Next supplier payment number",
		description:
			"The next supplier payment number to allocate. It advances only when a payment is recorded; gaps are acceptable.",
		type: "int",
	},
]

export function SettingsPage() {
	const { session } = routeApi.useRouteContext()
	const { activeBranchId, activeBranch, canSelectBranch } = useBranch()
	const canUpdate = hasPermission(session.user.role, "settings.update")
	const isAdmin = session.user.role === "ADMIN"

	const queryClient = useQueryClient()

	const settingsQuery = useQuery(settingsListOptions({ branchId: activeBranchId ?? undefined }))

	const updateMutation = useMutation({
		mutationFn: ({
			meta,
			rawValue,
			branchId,
		}: {
			meta: SettingMeta
			rawValue: string
			branchId: string | null
		}) => {
			const parsed =
				meta.type === "text" || meta.type === "select"
					? rawValue
					: meta.type === "switch"
						? rawValue === "true"
						: Number(rawValue)
			if (
				meta.type !== "text" &&
				meta.type !== "select" &&
				meta.type !== "switch" &&
				!Number.isFinite(parsed)
			) {
				throw new Error("Enter a valid number")
			}
			return settingsUpdate({ key: meta.key, value: parsed, branchId })
		},
		onSuccess: async () => {
			toast.success("Setting saved")
			await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
		},
		onError: (error) => {
			if (error instanceof Error && !("status" in error)) {
				toast.error(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const settings = settingsQuery.data?.settings ?? []
	const groups = [...new Set(SETTING_META.map((meta) => meta.group))]

	return (
		<div className="max-w-2xl">
			<PageHeader
				title="Settings"
				description={
					canSelectBranch
						? activeBranch
							? `Values for ${activeBranch.code}. Branch values override global defaults.`
							: "Global defaults. Select a branch to override branch-scoped values."
						: "Values for your branch."
				}
			/>

			{settingsQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading settings…</p>
			) : settingsQuery.isError ? (
				<p className="text-sm text-destructive">Couldn't load settings.</p>
			) : (
				<div className="grid gap-6">
					{groups.map((group) => (
						<div key={group}>
							<h2 className="mb-2 text-sm font-medium text-muted-foreground">{group}</h2>
							<div className="divide-y rounded-lg border bg-card">
								{SETTING_META.filter((meta) => meta.group === group).map((meta) => {
									const setting = settings.find((item) => item.key === meta.key)
									if (!setting) return null
									const branchId = setting.branchScoped ? (activeBranchId ?? null) : null
									return (
										<SettingRow
											key={meta.key}
											meta={meta}
											setting={setting}
											canEdit={
												canUpdate &&
												(setting.branchScoped ? isAdmin || activeBranchId !== null : isAdmin)
											}
											pending={
												updateMutation.isPending && updateMutation.variables?.meta.key === meta.key
											}
											branchScoped={setting.branchScoped}
											globalOnly={!isAdmin && !setting.branchScoped}
											onSave={(rawValue) => {
												updateMutation.mutate({ meta, rawValue, branchId })
											}}
										/>
									)
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
