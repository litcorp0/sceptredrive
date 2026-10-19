import { formatGhanaPhone } from "@gikautos/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { CreditEntryDialog } from "#/components/customers/credit-entry-dialog"
import { CreditLedgerTable } from "#/components/customers/credit-ledger-table"
import { CreditProfileDialog } from "#/components/customers/credit-profile-dialog"
import { CustomerFormDialog } from "#/components/customers/customer-form-dialog"
import {
	AnonymizeCustomerDialog,
	ArchiveCustomerDialog,
	ReactivateCustomerButton,
} from "#/components/customers/customer-lifecycle-dialogs"
import { RepaymentDialog } from "#/components/customers/repayment-dialog"
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { api } from "#/lib/api"
import type { CustomerListRow } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"

export const Route = createFileRoute("/_authenticated/customers/$id/")({
	component: CustomerProfilePage,
})

function CustomerProfilePage() {
	const { id } = Route.useParams()
	const { session } = Route.useRouteContext()
	const { branches, activeBranchId, canSelectBranch } = useBranch()
	const canEdit = hasPermission(session.user.role, "customer.update")
	const canManageCredit = hasPermission(session.user.role, "credit.profile.manage")
	const canRecordRepayment = hasPermission(session.user.role, "credit.repayment")
	const canAdjust = hasPermission(session.user.role, "credit.adjust")
	const canOverride = hasPermission(session.user.role, "credit.override")
	const canArchive = hasPermission(session.user.role, "customer.archive")
	const canAnonymize = hasPermission(session.user.role, "customer.anonymize")

	const [tab, setTab] = useState("overview")
	const [editOpen, setEditOpen] = useState(false)
	const [creditDialogOpen, setCreditDialogOpen] = useState(false)
	const [repaymentOpen, setRepaymentOpen] = useState(false)
	const [entryOpen, setEntryOpen] = useState(false)
	const [archiveOpen, setArchiveOpen] = useState(false)
	const [anonymizeOpen, setAnonymizeOpen] = useState(false)
	const [creditBranchId, setCreditBranchId] = useState<string | null>(null)

	const customerQuery = useQuery({
		queryKey: ["customer", id],
		queryFn: () => api.customers.get(id),
	})
	const profilesQuery = useQuery({
		queryKey: ["credit-profiles", id],
		queryFn: () => api.credit.profiles.list({ customerId: id }),
	})

	const detail = customerQuery.data
	const customer = detail?.customer
	const profiles = profilesQuery.data?.profiles ?? []

	if (customerQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading customer…</p>
	}

	if (customerQuery.isError || !customer) {
		return <p className="text-sm text-destructive">Couldn't load this customer.</p>
	}

	const effectiveBranchId =
		creditBranchId ?? activeBranchId ?? profiles[0]?.branchId ?? branches[0]?.id ?? null
	const selectedBranch = branches.find((branch) => branch.id === effectiveBranchId) ?? null
	const selectedProfile = profiles.find((profile) => profile.branchId === effectiveBranchId) ?? null
	const balanceMinor = selectedProfile?.balanceMinor ?? null

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Link
						to="/customers"
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
						Customers
					</Link>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<h2 className="text-lg font-semibold tracking-tight">{customer.name}</h2>
						{customerStatus(customer)}
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						{customer.phone ? formatGhanaPhone(customer.phone) : "No phone"}
						{customer.email ? ` · ${customer.email}` : ""}
						{customer.address ? ` · ${customer.address}` : ""}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="outline" asChild>
						<Link to="/customers/$id/statement" params={{ id }}>
							Statement
						</Link>
					</Button>
					{canEdit && !customer.anonymizedAt ? (
						<Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
							Edit details
						</Button>
					) : null}
					{!customer.anonymizedAt && canArchive && customer.status === "ACTIVE" ? (
						<Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
							Archive
						</Button>
					) : null}
					{!customer.anonymizedAt && canArchive && customer.status === "ARCHIVED" ? (
						<ReactivateCustomerButton customer={customer} />
					) : null}
					{!customer.anonymizedAt && canAnonymize ? (
						<Button
							size="sm"
							variant="outline"
							className="text-destructive hover:text-destructive"
							onClick={() => setAnonymizeOpen(true)}
						>
							Anonymize
						</Button>
					) : null}
				</div>
			</div>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList aria-label="Customer sections">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="credit">Credit</TabsTrigger>
					<TabsTrigger value="ledger">Ledger</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>Details</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-2 text-sm">
							<DetailsRow label="Status">{customerStatus(customer)}</DetailsRow>
							<DetailsRow label="Phone">
								{customer.phone ? formatGhanaPhone(customer.phone) : "—"}
							</DetailsRow>
							<DetailsRow label="Email">{customer.email ?? "—"}</DetailsRow>
							<DetailsRow label="Address">{customer.address ?? "—"}</DetailsRow>
							<DetailsRow label="Created">
								{new Date(customer.createdAt).toLocaleDateString("en-GH")} at{" "}
								{customer.createdBranchName}
							</DetailsRow>
							<DetailsRow label="Customer ID">
								<span className="font-mono text-xs">{customer.id}</span>
							</DetailsRow>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Loyalty</CardTitle>
							<CardDescription>Points balance across every branch.</CardDescription>
						</CardHeader>
						<CardContent>
							{detail.loyalty ? (
								<>
									<p className="text-2xl font-semibold tabular-nums">
										{detail.loyalty.balancePoints}
									</p>
									<p className="text-xs text-muted-foreground">points</p>
								</>
							) : (
								<p className="text-sm text-muted-foreground">No loyalty account yet.</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="credit" className="mt-4 grid gap-4">
					{canSelectBranch ? (
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Branch</span>
							<Select
								value={effectiveBranchId ?? ""}
								onValueChange={(value) => setCreditBranchId(value)}
							>
								<SelectTrigger className="w-56" aria-label="Credit branch">
									<SelectValue placeholder="Select a branch" />
								</SelectTrigger>
								<SelectContent>
									{branches.map((branch) => (
										<SelectItem key={branch.id} value={branch.id}>
											{branch.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Branch:{" "}
							<span className="font-medium text-foreground">{selectedBranch?.name ?? "—"}</span>
						</p>
					)}

					<Card>
						<CardHeader>
							<CardTitle>{selectedBranch ? selectedBranch.name : "Branch credit"}</CardTitle>
							<CardDescription>
								Credit limit and terms apply per branch; the balance always follows the ledger.
							</CardDescription>
							<CardAction>
								<div className="flex flex-wrap items-center justify-end gap-2">
									{canRecordRepayment && effectiveBranchId ? (
										<Button size="sm" onClick={() => setRepaymentOpen(true)}>
											Record repayment
										</Button>
									) : null}
									{canAdjust && effectiveBranchId ? (
										<Button size="sm" variant="outline" onClick={() => setEntryOpen(true)}>
											New entry
										</Button>
									) : null}
									{canManageCredit && effectiveBranchId ? (
										<Button size="sm" variant="outline" onClick={() => setCreditDialogOpen(true)}>
											{selectedProfile ? "Credit settings" : "Set up credit"}
										</Button>
									) : null}
								</div>
							</CardAction>
						</CardHeader>
						<CardContent className="grid gap-4">
							{profilesQuery.isLoading ? (
								<p className="text-sm text-muted-foreground">Loading credit…</p>
							) : selectedProfile ? (
								<>
									<div className="grid gap-4 sm:grid-cols-3">
										<Metric
											label="Current balance"
											value={
												balanceMinor === null
													? "—"
													: balanceMinor < 0
														? formatGhs(-balanceMinor)
														: formatGhs(balanceMinor)
											}
											caption={
												balanceMinor === null
													? undefined
													: balanceMinor > 0
														? "owed by the customer"
														: balanceMinor < 0
															? "customer credit"
															: "settled"
											}
										/>
										<Metric
											label="Credit limit"
											value={formatGhs(selectedProfile.limitMinor)}
											caption={
												balanceMinor !== null && balanceMinor > selectedProfile.limitMinor
													? "balance is over the limit"
													: undefined
											}
										/>
										<Metric
											label="Payment terms"
											value={
												selectedProfile.paymentTermDays === 0
													? "Due on sale"
													: `NET ${selectedProfile.paymentTermDays} days`
											}
										/>
									</div>
									{selectedProfile.hold ? (
										<StatusBadge tone="red">On hold — new charges need an override</StatusBadge>
									) : null}
									{selectedProfile.notes ? (
										<p className="text-sm text-muted-foreground">{selectedProfile.notes}</p>
									) : null}
								</>
							) : (
								<p className="text-sm text-muted-foreground">
									No credit profile at this branch yet. Saving credit settings creates one.
								</p>
							)}
						</CardContent>
					</Card>

					{canSelectBranch && profiles.length > 1 ? (
						<Card>
							<CardHeader>
								<CardTitle>All branch profiles</CardTitle>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Branch</TableHead>
											<TableHead className="text-right">Limit</TableHead>
											<TableHead>Terms</TableHead>
											<TableHead className="text-right">Balance</TableHead>
											<TableHead>Status</TableHead>
											<TableHead className="w-20" />
										</TableRow>
									</TableHeader>
									<TableBody>
										{profiles.map((profile) => (
											<TableRow key={profile.id}>
												<TableCell className="font-medium">
													{profile.branchName}
													<span className="ml-2 font-mono text-xs text-muted-foreground">
														{profile.branchCode}
													</span>
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatGhs(profile.limitMinor)}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{profile.paymentTermDays === 0
														? "Due on sale"
														: `NET ${profile.paymentTermDays}`}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{profile.balanceMinor < 0
														? `${formatGhs(-profile.balanceMinor)} credit`
														: formatGhs(profile.balanceMinor)}
												</TableCell>
												<TableCell>
													{profile.hold ? (
														<StatusBadge tone="red">On hold</StatusBadge>
													) : (
														<ActiveBadge active />
													)}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														disabled={profile.branchId === effectiveBranchId}
														onClick={() => setCreditBranchId(profile.branchId)}
													>
														View
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					) : null}
				</TabsContent>

				<TabsContent value="ledger" className="mt-4">
					<CreditLedgerTable
						customerId={id}
						branchId={effectiveBranchId}
						currentBalanceMinor={selectedProfile?.balanceMinor ?? null}
					/>
				</TabsContent>
			</Tabs>

			<CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
			<CreditProfileDialog
				open={creditDialogOpen}
				onOpenChange={setCreditDialogOpen}
				customerId={id}
				branchId={effectiveBranchId}
				branchName={selectedBranch?.name ?? null}
				profile={selectedProfile}
			/>
			<RepaymentDialog
				open={repaymentOpen}
				onOpenChange={setRepaymentOpen}
				customerId={id}
				branchId={effectiveBranchId}
				branchName={selectedBranch?.name ?? null}
				currentBalanceMinor={selectedProfile?.balanceMinor ?? null}
				receivedBy={session.user.name}
			/>
			<CreditEntryDialog
				open={entryOpen}
				onOpenChange={setEntryOpen}
				customerId={id}
				branchId={effectiveBranchId}
				branchName={selectedBranch?.name ?? null}
				currentBalanceMinor={selectedProfile?.balanceMinor ?? null}
				limitMinor={selectedProfile?.limitMinor ?? null}
				canOverride={canOverride}
			/>
			<ArchiveCustomerDialog open={archiveOpen} onOpenChange={setArchiveOpen} customer={customer} />
			<AnonymizeCustomerDialog
				open={anonymizeOpen}
				onOpenChange={setAnonymizeOpen}
				customer={customer}
				profiles={profiles}
				loyaltyPoints={detail.loyalty?.balancePoints ?? null}
			/>
		</div>
	)
}

function customerStatus(customer: CustomerListRow) {
	if (customer.anonymizedAt) return <StatusBadge tone="zinc">Anonymized</StatusBadge>
	if (customer.status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}

function DetailsRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-4">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right">{children}</span>
		</div>
	)
}

function Metric({
	label,
	value,
	caption,
}: {
	label: string
	value: string
	caption?: string | undefined
}) {
	return (
		<div className="grid gap-1">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-lg font-semibold tabular-nums">{value}</span>
			{caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
		</div>
	)
}
