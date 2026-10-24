import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
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
import { branchListOptions } from "../api/branches"
import { CreateBranchDialog } from "../components/create-branch-dialog"

const authenticatedRoute = getRouteApi("/_authenticated")

export function BranchesPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const canCreate = hasPermission(session.user.role, "branch.create")

	const [createOpen, setCreateOpen] = useState(false)

	const branchesQuery = useQuery(branchListOptions({ includeInactive: true }))

	const branches = branchesQuery.data?.branches ?? []

	return (
		<div>
			<PageHeader
				title="Branches"
				description="Retail stores and warehouses. Codes identify branches everywhere."
				actions={
					canCreate ? (
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<PlusIcon className="size-4" />
							New branch
						</Button>
					) : undefined
				}
			/>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-28">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-32">Type</TableHead>
							<TableHead>City / Area</TableHead>
							<TableHead className="w-24">Status</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{branchesQuery.isLoading ? (
							<TableMessage colSpan={6}>Loading branches…</TableMessage>
						) : branchesQuery.isError ? (
							<TableMessage colSpan={6} tone="error">
								Couldn't load branches.
							</TableMessage>
						) : branches.length === 0 ? (
							<TableMessage colSpan={6}>
								No branches yet. Create the first one to get started.
							</TableMessage>
						) : (
							branches.map((branch) => (
								<TableRow key={branch.id}>
									<TableCell className="font-mono text-xs">{branch.code}</TableCell>
									<TableCell className="font-medium">{branch.name}</TableCell>
									<TableCell>
										<StatusBadge tone={branch.type === "WAREHOUSE" ? "amber" : "zinc"}>
											{branch.type === "WAREHOUSE" ? "Warehouse" : "Retail"}
										</StatusBadge>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{[branch.city, branch.area].filter(Boolean).join(" · ")}
									</TableCell>
									<TableCell>
										<ActiveBadge active={branch.isActive} />
									</TableCell>
									<TableCell>
										<Button variant="ghost" size="sm" asChild>
											<Link to="/branches/$id" params={{ id: branch.id }}>
												View
											</Link>
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{canCreate ? <CreateBranchDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
		</div>
	)
}
