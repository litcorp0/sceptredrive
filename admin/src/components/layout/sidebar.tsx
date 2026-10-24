import type { Permission } from "@sceptre/shared"
import { can } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import {
	Building2,
	Gift,
	LayoutDashboard,
	type LucideIcon,
	MonitorSmartphone,
	Package,
	ScrollText,
	Settings2,
	Truck,
	Users,
	Warehouse,
} from "lucide-react"
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "#/components/ui/sidebar"
import { toRole } from "#/lib/role"

/** Route paths the console shell links to. Presentation only — no new routes. */
type NavPath =
	| "/"
	| "/branches"
	| "/terminals"
	| "/staff"
	| "/customers"
	| "/loyalty"
	| "/catalog"
	| "/inventory"
	| "/suppliers"
	| "/audit"
	| "/settings"

interface NavItem {
	to: NavPath
	label: string
	icon: LucideIcon
	permission?: Permission
}

interface NavGroup {
	label: string
	items: NavItem[]
}

/**
 * The single navigation table. The sidebar renders it, and the topbar
 * breadcrumb takes its section label from it, so the two can never drift.
 */
export const NAV_GROUPS: NavGroup[] = [
	{
		label: "Overview",
		items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
	},
	{
		label: "Operations",
		items: [
			{ to: "/catalog", label: "Catalog", icon: Package, permission: "catalog.read" },
			{ to: "/inventory", label: "Inventory", icon: Warehouse, permission: "inventory.read" },
			{ to: "/suppliers", label: "Suppliers", icon: Truck, permission: "supplier.read" },
			{ to: "/customers", label: "Customers", icon: Users, permission: "customer.read" },
			{ to: "/loyalty", label: "Loyalty", icon: Gift, permission: "loyalty.read" },
		],
	},
	{
		label: "Organisation",
		items: [
			{ to: "/branches", label: "Branches", icon: Building2, permission: "branch.read" },
			{
				to: "/terminals",
				label: "Terminals",
				icon: MonitorSmartphone,
				permission: "terminal.read",
			},
			{ to: "/staff", label: "Staff", icon: Users, permission: "staff.read" },
		],
	},
	{
		label: "System",
		items: [
			{ to: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
			{ to: "/settings", label: "Settings", icon: Settings2, permission: "settings.read" },
		],
	},
]

/** Build label shown in the sidebar footer. */
const APP_VERSION = `${import.meta.env.VITE_APP_VERSION ?? "0.1.0"}`

const ROLE_LABELS: Record<string, string> = {
	ADMIN: "Administrator",
	MANAGER: "Manager",
	CASHIER: "Cashier",
}

function humanise(segment: string): string {
	const spaced = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim()
	if (spaced === "") return segment
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A detail-page segment carries no meaning for a human reader. */
function isIdentifier(segment: string): boolean {
	return (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
		/^\d+$/.test(segment) ||
		/^[0-9a-z]{20,}$/i.test(segment)
	)
}

/**
 * Section › page for the topbar. The section comes from the navigation table;
 * the page is the last path segment, humanised.
 */
export function topbarBreadcrumb(pathname: string): { section: string | null; page: string } {
	const segments = pathname.split("/").filter(Boolean)
	if (segments.length === 0) return { section: null, page: "Dashboard" }

	const first = segments[0]
	const navLabel = NAV_GROUPS.flatMap((group) => group.items).find(
		(item) => item.to === `/${first}`,
	)?.label
	const section = navLabel ?? humanise(first)
	if (segments.length === 1) return { section: null, page: section }

	const last = segments[segments.length - 1]
	const page =
		isIdentifier(last) && segments.length > 1 ? segments[segments.length - 2] : segments.at(-1)

	return { section, page: humanise(page ?? section) }
}

function visibleGroups(roleValue: string): NavGroup[] {
	const role = toRole(roleValue)

	return NAV_GROUPS.map((group) => ({
		label: group.label,
		items: group.items.filter(
			(item) => !item.permission || (role !== null && can(role, item.permission)),
		),
	})).filter((group) => group.items.length > 0)
}

/**
 * The console navigation. Mounted by `AppShell` inside `SidebarProvider`; the
 * primitive renders it as a fixed rail at `lg` and above and as a Sheet below.
 */
export function AppSidebar({ role }: { role: string }) {
	const { isMobile, setOpenMobile } = useSidebar()
	const groups = visibleGroups(role)

	return (
		<Sidebar collapsible="icon" className="print:hidden">
			<SidebarHeader className="gap-0 p-0">
				<div className="flex h-(--layout-topbar-height) items-center gap-2.5 px-4 group-data-[collapsible=icon]:px-1.5">
					<span
						aria-hidden="true"
						className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink font-display text-xs font-semibold tracking-normal text-canvas"
					>
						SD
					</span>
					<div className="min-w-0 group-data-[collapsible=icon]:hidden">
						<p className="truncate font-display text-sm leading-none font-semibold">
							Sceptre Drive
						</p>
						<p className="mt-1 truncate text-xs leading-none text-muted-foreground">
							Admin console
						</p>
					</div>
				</div>
			</SidebarHeader>

			<SidebarContent>
				<nav aria-label="Main" className="flex flex-col">
					{groups.map((group) => (
						<SidebarGroup key={group.label}>
							<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									{group.items.map((item) => (
										<SidebarMenuItem key={item.to}>
											<SidebarMenuButton
												asChild
												tooltip={item.label}
												className={cn(
													"relative text-sidebar-foreground/80 hover:text-sidebar-foreground",
													// The only brand orange in the sidebar: a 2px rail on the active item.
													"before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0 before:transition-opacity before:duration-150 before:content-['']",
													"data-[active=true]:before:opacity-100",
												)}
											>
												<Link
													to={item.to}
													activeOptions={{ exact: item.to === "/" }}
													activeProps={{ "data-active": "true", "aria-current": "page" }}
													onClick={() => {
														if (isMobile) setOpenMobile(false)
													}}
												>
													<item.icon aria-hidden="true" />
													<span>{item.label}</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					))}
				</nav>
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border">
				<div className="flex flex-col gap-1 px-2 py-1 group-data-[collapsible=icon]:hidden">
					<p className="text-xs font-medium">
						{ROLE_LABELS[role] ?? humanise(role)}
						<span className="text-muted-foreground"> · signed in</span>
					</p>
					<p className="font-mono text-[11px] text-muted-foreground">v{APP_VERSION}</p>
				</div>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	)
}
