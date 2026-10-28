import { formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { hasPermission } from "#/lib/role"
import { branchDetailOptions } from "../api/branches"
import { EditBranchForm } from "../components/edit-branch-form"

const authenticatedRoute = getRouteApi("/_authenticated")
const branchRoute = getRouteApi("/_authenticated/branches/$id")

export function BranchDetailPage() {
	const { id } = branchRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()

	const canDeactivate = hasPermission(session.user.role, "branch.deactivate")
	const isAdmin = session.user.role === "ADMIN"

	const branchQuery = useQuery(branchDetailOptions(id))

	const branch = branchQuery.data?.branch

	if (branchQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading branch…</p>
	}
	if (branchQuery.isError || !branch) {
		return (
			<div className="text-sm text-muted-foreground">
				<p>Branch not found or not visible to you.</p>
				<Button variant="outline" size="sm" className="mt-3" asChild>
					<Link to="/branches">Back to branches</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="">
			<Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
				<Link to="/branches">
					<ArrowLeftIcon className="size-4" />
					Branches
				</Link>
			</Button>

			<PageHeader
				title={branch.name}
				description={`${branch.name} (${branch.code}) · ${branch.type === "WAREHOUSE" ? "Warehouse" : "Retail"}`}
				actions={<ActiveBadge active={branch.isActive} />}
			/>

			<EditBranchForm branch={branch} isAdmin={isAdmin} canDeactivate={canDeactivate} />

			<p className="mt-3 text-xs text-muted-foreground">
				Created {formatDateTime(branch.createdAt)} · Updated {formatDateTime(branch.updatedAt)}
			</p>
		</div>
	)
}
