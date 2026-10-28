import {
	can,
	formatCount,
	PERMISSIONS,
	type Permission,
	ROLE_PERMISSIONS,
	type Role,
} from "@sceptre/shared"
import { getRouteApi } from "@tanstack/react-router"
import { CheckIcon, MinusIcon } from "lucide-react"
import { PageHeader } from "#/components/common/page-header"
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { hasPermission } from "#/lib/role"

const routeApi = getRouteApi("/_authenticated")

/** The three roles the matrix has columns for. Editing is deliberately not offered. */
const ROLE_COLUMNS: ReadonlyArray<{ role: Role; label: string }> = [
	{ role: "ADMIN", label: "Administrator" },
	{ role: "MANAGER", label: "Manager" },
	{ role: "CASHIER", label: "Cashier" },
]

/** Permission namespaces in the words the console uses elsewhere. */
const PREFIX_LABELS: Record<string, string> = {
	approval: "Approvals",
	analytics: "Analytics",
	audit: "Audit log",
	branch: "Branches",
	catalog: "Catalog",
	conflict: "POS conflicts",
	credit: "Credit",
	customer: "Customers",
	device: "Devices",
	evat: "E-VAT",
	inventory: "Inventory",
	loyalty: "Loyalty",
	payable: "Payables",
	pos: "Point of sale",
	price: "Pricing",
	procurement: "Procurement",
	settings: "Settings",
	staff: "Staff",
	supplier: "Suppliers",
	terminal: "Terminals",
}

function prefixOf(permission: Permission): string {
	return permission.split(".", 1)[0] ?? permission
}

function groupLabel(prefix: string): string {
	const label = PREFIX_LABELS[prefix]
	if (label) return label
	const spaced = prefix.replace(/[-_]+/g, " ").trim()
	return spaced === "" ? prefix : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

interface PermissionGroup {
	prefix: string
	label: string
	permissions: Permission[]
}

/**
 * Grouped by namespace, alphabetical by the group's display name so the same permission is in
 * the same place on every visit. A namespace this map does not name is still shown, labelled
 * from its own name.
 */
function groupPermissions(): PermissionGroup[] {
	const groups = new Map<string, PermissionGroup>()

	for (const permission of PERMISSIONS) {
		const prefix = prefixOf(permission)
		const existing = groups.get(prefix)
		if (existing) {
			existing.permissions.push(permission)
			continue
		}
		groups.set(prefix, {
			prefix,
			label: groupLabel(prefix),
			permissions: [permission],
		})
	}

	return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * What each role can do, read-only.
 *
 * Every cell comes from `ROLE_PERMISSIONS`/`can` in `@sceptre/shared` — the same constant the
 * API's middleware consults — so the screen cannot disagree with the server. There is no editing
 * (a fixed three-role matrix is the design): a screen that could edit this would be a lie about
 * the permission model. No fetch means no loading or error state; the only state is permission.
 */
export function PermissionsPage() {
	const { session } = routeApi.useRouteContext()

	if (!hasPermission(session.user.role, "staff.read")) {
		return (
			<div>
				<PageHeader title="Permissions" />
				<p className="text-sm text-muted-foreground">
					Your role cannot view the staff directory, so it cannot view this matrix either.
				</p>
			</div>
		)
	}

	const groups = groupPermissions()

	return (
		<div className="grid gap-5">
			<PageHeader
				eyebrow="Staff"
				title="Permissions"
				description="What each role can do. Every cell is generated from the same shared table the API's middleware enforces; the API decides, and the console's own checks are cosmetic."
			/>

			<p className="max-w-3xl text-sm text-muted-foreground">
				A tick means the role holds the permission. The console uses this table to hide what a role
				cannot do, but hiding is a convenience: every route still enforces its own permission
				server-side, so a hidden control is not a security boundary.
			</p>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableCaption>
						{formatCount(PERMISSIONS.length)} permissions · Administrator{" "}
						{formatCount(ROLE_PERMISSIONS.ADMIN.length)} · Manager{" "}
						{formatCount(ROLE_PERMISSIONS.MANAGER.length)} · Cashier{" "}
						{formatCount(ROLE_PERMISSIONS.CASHIER.length)}
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Permission</TableHead>
							{ROLE_COLUMNS.map((column) => (
								<TableHead key={column.role} scope="col" className="w-28 text-center">
									{column.label}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					{groups.map((group) => (
						<TableBody key={group.prefix}>
							<TableRow className="bg-muted/40 hover:bg-muted/40">
								<th
									scope="colgroup"
									colSpan={ROLE_COLUMNS.length + 1}
									className="px-2 py-1.5 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase"
								>
									{group.label}
								</th>
							</TableRow>
							{group.permissions.map((permission) => (
								<TableRow key={permission} data-permission={permission}>
									<th scope="row" className="px-2 py-2 text-left font-mono text-xs font-normal">
										{permission}
									</th>
									{ROLE_COLUMNS.map((column) => (
										<TableCell key={column.role} className="text-center">
											<AllowedCell allowed={can(column.role, permission)} />
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					))}
				</Table>
			</div>
		</div>
	)
}

/** A tick or a dash, never colour alone: each carries its own accessible name. */
function AllowedCell({ allowed }: { allowed: boolean }) {
	return allowed ? (
		<span role="img" aria-label="Allowed">
			<CheckIcon aria-hidden="true" className="mx-auto size-4 text-ok" />
		</span>
	) : (
		<span role="img" aria-label="Not allowed">
			<MinusIcon aria-hidden="true" className="mx-auto size-4 text-muted-foreground" />
		</span>
	)
}
