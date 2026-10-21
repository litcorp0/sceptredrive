import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { api } from "#/lib/api"
import type { ResolvedSetting, SettingKey } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/settings")({
	component: SettingsPage,
})

interface SettingMeta {
	key: SettingKey
	group: string
	label: string
	description: string
	type: "text" | "int" | "decimal" | "select"
	options?: Array<{ value: string; label: string }>
}

const SETTING_META: SettingMeta[] = [
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

function SettingsPage() {
	const { session } = Route.useRouteContext()
	const { activeBranchId, activeBranch, canSelectBranch } = useBranch()
	const canUpdate = hasPermission(session.user.role, "settings.update")
	const isAdmin = session.user.role === "ADMIN"

	const settingsQuery = useQuery({
		queryKey: ["settings", { branchId: activeBranchId ?? undefined }],
		queryFn: () => api.settings.list({ branchId: activeBranchId ?? undefined }),
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
									return (
										<SettingRow
											key={meta.key}
											meta={meta}
											setting={setting}
											canEdit={
												canUpdate &&
												(setting.branchScoped ? isAdmin || activeBranchId !== null : isAdmin)
											}
											branchId={setting.branchScoped ? (activeBranchId ?? null) : null}
											branchScoped={setting.branchScoped}
											globalOnly={!isAdmin && !setting.branchScoped}
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

function SettingRow({
	meta,
	setting,
	canEdit,
	branchId,
	branchScoped,
	globalOnly,
}: {
	meta: SettingMeta
	setting: ResolvedSetting
	canEdit: boolean
	branchId: string | null
	branchScoped: boolean
	globalOnly: boolean
}) {
	const queryClient = useQueryClient()
	const [value, setValue] = useState("")

	useEffect(() => {
		setValue(String(setting.value))
	}, [setting.value])

	const dirty = value !== String(setting.value)

	const updateMutation = useMutation({
		mutationFn: () => {
			const parsed = meta.type === "text" || meta.type === "select" ? value : Number(value)
			if (meta.type !== "text" && meta.type !== "select" && !Number.isFinite(parsed)) {
				throw new Error("Enter a valid number")
			}
			return api.settings.update({ key: meta.key, value: parsed, branchId })
		},
		onSuccess: async () => {
			toast.success("Setting saved")
			await queryClient.invalidateQueries({ queryKey: ["settings"] })
		},
		onError: (error) => {
			if (error instanceof Error && !("status" in error)) {
				toast.error(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!dirty) return
		updateMutation.mutate()
	}

	const sourceLabel =
		setting.source === "branch" ? "Branch" : setting.source === "global" ? "Global" : "Default"

	return (
		<form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3 p-4">
			<div className="min-w-52 flex-1">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium">{meta.label}</p>
					<StatusBadge tone={setting.source === "branch" ? "blue" : "zinc"}>
						{sourceLabel}
					</StatusBadge>
				</div>
				<p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
			</div>

			<div className="flex items-center gap-2">
				{meta.type === "select" ? (
					<Select value={value} onValueChange={(next) => setValue(next)} disabled={!canEdit}>
						<SelectTrigger className="h-8 w-44" aria-label={meta.label}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(meta.options ?? []).map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<Input
						type={meta.type === "text" ? "text" : "number"}
						step={meta.type === "decimal" ? "any" : undefined}
						className="h-8 w-40"
						value={value}
						disabled={!canEdit}
						onChange={(event) => setValue(event.target.value)}
						aria-label={meta.label}
					/>
				)}
				<Button type="submit" size="sm" disabled={!canEdit || !dirty || updateMutation.isPending}>
					{updateMutation.isPending ? "Saving…" : "Save"}
				</Button>
			</div>

			{globalOnly ? (
				<p className="w-full text-xs text-amber-600">Only administrators can change this value.</p>
			) : null}
			{branchScoped && !globalOnly && !canEdit && setting.source === "default" ? (
				<p className="w-full text-xs text-muted-foreground">
					Currently using the built-in default.
				</p>
			) : null}
		</form>
	)
}
