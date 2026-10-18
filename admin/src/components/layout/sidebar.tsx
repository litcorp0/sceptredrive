import type { Permission, Role } from "@gikautos/shared"
import { can, ROLES } from "@gikautos/shared"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import {
	Building2,
	LayoutDashboard,
	type LucideIcon,
	MonitorSmartphone,
	ScrollText,
	Settings2,
	Users,
} from "lucide-react"

/** Better Auth types additional fields loosely; narrow to the known roles. */
function toRole(value: string): Role | null {
	return (ROLES as readonly string[]).includes(value) ? (value as Role) : null
}

interface NavItem {
	to: "/" | "/branches" | "/terminals" | "/staff" | "/audit" | "/settings"
	label: string
	icon: LucideIcon
	permission?: Permission
}

const NAV_ITEMS: NavItem[] = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/branches", label: "Branches", icon: Building2, permission: "branch.read" },
	{ to: "/terminals", label: "Terminals", icon: MonitorSmartphone, permission: "terminal.read" },
	{ to: "/staff", label: "Staff", icon: Users, permission: "staff.read" },
	{ to: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
	{ to: "/settings", label: "Settings", icon: Settings2, permission: "settings.read" },
]

export function SidebarNav({
	role: roleValue,
	onNavigate,
}: {
	role: string
	onNavigate?: () => void
}) {
	const role = toRole(roleValue)
	const items = NAV_ITEMS.filter(
		(item) => !item.permission || (role !== null && can(role, item.permission)),
	)

	return (
		<nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					onClick={onNavigate}
					activeOptions={{ exact: item.to === "/" }}
					className={cn(
						"flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors",
						"hover:bg-accent hover:text-accent-foreground",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
					)}
					activeProps={{
						className: "bg-accent font-medium text-accent-foreground",
					}}
				>
					<item.icon className="size-4 shrink-0" aria-hidden="true" />
					{item.label}
				</Link>
			))}
		</nav>
	)
}

export function SidebarBrand() {
	return (
		<div className="flex h-14 items-center gap-2.5 border-b px-4">
			<div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
				GA
			</div>
			<div className="min-w-0">
				<p className="truncate text-sm font-semibold leading-none">GikAutos</p>
				<p className="mt-1 text-xs leading-none text-muted-foreground">Admin console</p>
			</div>
		</div>
	)
}
