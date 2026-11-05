import type { FlagKey, Permission } from "@sceptre/shared"
import { can } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { cn } from "cn"
import {
	BadgeCheck,
	Building2,
	ChartLine,
	ClipboardList,
	Gift,
	Inbox,
	LayoutDashboard,
	type LucideIcon,
	MonitorSmartphone,
	Package,
	ReceiptText,
	ScrollText,
	Settings2,
	ShieldCheck,
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
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "#/components/ui/sidebar"
import { useBranch } from "#/lib/branch-context"
import { useFlagValues } from "#/lib/flags"
import { toRole } from "#/lib/role"
import { approvalSummaryOptions } from "#/modules/approvals"

/** Route paths the console shell links to. Presentation only — no new routes. */
type NavPath =
	| "/"
	| "/analytics"
	| "/approvals"
	| "/pos"
	| "/operations"
	| "/branches"
	| "/terminals"
	| "/staff"
	| "/staff/permissions"
	| "/customers"
	| "/loyalty"
	| "/catalog"
	| "/procurement"
	| "/inventory"
	| "/suppliers"
	| "/evat"
	| "/audit"
	| "/settings"

interface NavItem {
	to: NavPath
	label: string
	icon: LucideIcon
	permission?: Permission
	/** An entry a feature flag can hide without a deploy (P14-D41). */
	flag?: FlagKey
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
		items: [
			{ to: "/", label: "Dashboard", icon: LayoutDashboard },
			{
				to: "/analytics",
				label: "Analytics",
				icon: ChartLine,
				permission: "analytics.read",
			},
		],
	},
	{
		label: "Operations",
		items: [
			{ to: "/approvals", label: "Approvals", icon: Inbox, permission: "approval.read" },
			{
				to: "/pos",
				label: "POS oversight",
				icon: ReceiptText,
				permission: "pos.oversight.read",
			},
			{
				to: "/operations",
				label: "Branch operations",
				icon: LayoutDashboard,
				permission: "approval.read",
			},
			{ to: "/catalog", label: "Catalog", icon: Package, permission: "catalog.read" },
			{
				to: "/procurement",
				label: "Procurement",
				icon: ClipboardList,
				permission: "procurement.read",
			},
			{ to: "/inventory", label: "Inventory", icon: Warehouse, permission: "inventory.read" },
			// Transfers and Reconciliation are tabs of this section, not separate rail
			// entries (P20-D6): one route path, one highlight, and the two pages are
			// where a payables reader already looks.
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
			{
				to: "/staff/permissions",
				label: "Permissions",
				icon: ShieldCheck,
				permission: "staff.read",
			},
		],
	},
	{
		label: "System",
		items: [
			{ to: "/evat", label: "E-VAT", icon: BadgeCheck, permission: "evat.read" },
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

/** Section names from the navigation table, so the two can never drift. */
const SECTION_LABELS: ReadonlyMap<string, string> = new Map(
	NAV_GROUPS.flatMap((group) => group.items)
		.filter((item) => item.to !== "/")
		.map((item) => [item.to.slice(1), item.label] as const),
)

/** Path segments that name a page rather than a section. */
const PAGE_LABELS: ReadonlyMap<string, string> = new Map([
	["products", "Products"],
	["transfers", "Transfers"],
	["counts", "Counts"],
	["receipts", "Receipts"],
	["stock", "Stock"],
	["movements", "Movements"],
	["adjustments", "Adjustments"],
	["brands", "Brands"],
	["categories", "Categories"],
	["units", "Units"],
	["invoices", "Invoices"],
	["payments", "Payments"],
	["aging", "Aging"],
	["reconciliation", "Reconciliation"],
	["statement", "Statement"],
	["orders", "Orders"],
	["write-offs", "Write-offs"],
	["over-limit", "Over limit"],
	["replenishment", "Replenishment"],
	["sales", "Sales"],
	["refunds", "Refunds"],
	["shifts", "Shifts"],
	["conflicts", "Conflicts"],
	["permissions", "Permissions"],
	["submit", "Submit"],
	["new", "New"],
	["edit", "Edit"],
])

/**
 * Decode a path segment. A malformed escape must never throw while the shell
 * renders, so undecodable segments are shown verbatim.
 */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

/**
 * Identifier shapes only: a UUID, an all-digit id, a ULID, or a long hex key.
 * Descriptive slugs are deliberately not matched, so "inventory-reconciliation"
 * still reads as a page.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	/^\d+$/,
	/^[0-9A-HJKMNP-TV-Z]{26}$/i,
	/^[0-9a-f]{24,}$/i,
]

/** A detail-page segment carries no meaning for a human reader. */
function isIdentifier(segment: string): boolean {
	return IDENTIFIER_PATTERNS.some((pattern) => pattern.test(segment))
}

function humanise(segment: string): string {
	// Callers pass an already-decoded path segment; decoding again would turn
	// "/50%2525off" into "50%off".
	const spaced = segment.replace(/[-_]+/g, " ").trim()
	if (spaced === "") return segment
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function segmentLabel(segment: string): string {
	return PAGE_LABELS.get(segment) ?? SECTION_LABELS.get(segment) ?? humanise(segment)
}

/**
 * Section › page for the topbar, at most two levels. The section comes from the
 * navigation table; the page is the last meaningful segment (or two, for
 * "Products · New"). Identifier segments are dropped rather than relabelled, so
 * `/branches/<uuid>` reads "Branches" instead of "Branches › Branches".
 */
export function topbarBreadcrumb(pathname: string): { section: string | null; page: string } {
	const segments = pathname
		.split("/")
		.filter(Boolean)
		.map((segment) => decodeSegment(segment))

	const first = segments[0] ?? ""
	if (first === "") return { section: null, page: "Dashboard" }

	const section = segmentLabel(first)
	const trail = segments.slice(1).filter((segment) => !isIdentifier(segment))
	if (trail.length === 0) return { section: null, page: section }

	const labels = [...new Set(trail.slice(-2).map((segment) => segmentLabel(segment)))]
	const page = labels.join(" · ")

	// A page that repeats the section adds nothing to the crumb.
	return page === section ? { section: null, page } : { section, page }
}

/**
 * The one navigation entry a path belongs to: the deepest `to` that is a prefix
 * of it. `/` matches only itself, so the dashboard does not claim every page.
 */
export function deepestNavPath(paths: readonly NavPath[], pathname: string): NavPath | null {
	let best: NavPath | null = null
	for (const path of paths) {
		const matches =
			path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`)
		if (!matches) continue
		if (best === null || path.length > best.length) best = path
	}
	return best
}

function visibleGroups(roleValue: string, flags: Record<FlagKey, boolean>): NavGroup[] {
	const role = toRole(roleValue)

	return NAV_GROUPS.map((group) => ({
		label: group.label,
		items: group.items.filter(
			(item) =>
				(!item.permission || (role !== null && can(role, item.permission))) &&
				(!item.flag || flags[item.flag]),
		),
	})).filter((group) => group.items.length > 0)
}

/**
 * The pending-approval count beside the Approvals item.
 *
 * The query is mounted by this component, which is rendered only inside the
 * permission-filtered nav item — a role without `approval.read` never asks. A 60-second
 * `staleTime` and no `refetchInterval` (P12-D36): the number changes when a manager
 * submits a form, not every five seconds.
 *
 * The visible number is hidden from assistive technology and repeated as the badge's
 * accessible name, because a bare number in a navigation list is not a label.
 */
function ApprovalBadge() {
	const { activeBranchId } = useBranch()
	const { data } = useQuery({ ...approvalSummaryOptions(activeBranchId), staleTime: 60_000 })
	const pending = data?.pending ?? 0

	if (pending === 0) return null

	return (
		<SidebarMenuBadge role="status" aria-label={`${pending} pending approvals`}>
			<span aria-hidden="true">{pending}</span>
		</SidebarMenuBadge>
	)
}

/**
 * The console navigation. Mounted by `AppShell` inside `SidebarProvider`; the
 * primitive renders it as a fixed rail at `lg` and above and as a Sheet below.
 */
export function AppSidebar({ role }: { role: string }) {
	const { isMobile, setOpenMobile } = useSidebar()
	const roleValue = toRole(role)
	const canReadSettings = roleValue !== null && can(roleValue, "settings.read")
	const groups = visibleGroups(role, useFlagValues(canReadSettings))
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	// Exactly one entry is the current page: the deepest one whose path matches.
	// Prefix matching alone lit both "Staff" and "Permissions" on /staff/permissions,
	// and both "Suppliers" and "Transfers" before transfers became a tab (P20-D6).
	const activePath = deepestNavPath(
		groups.flatMap((group) => group.items.map((item) => item.to)),
		pathname,
	)

	return (
		<Sidebar collapsible="icon" className="print:hidden">
			<SidebarHeader className="gap-0 p-0">
				<div className="flex h-(--layout-topbar-height) items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
					<div className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
						<img
							src="/logo.png"
							alt="Sceptre Drive"
							className="block h-9 w-auto"
							draggable={false}
							decoding="async"
						/>
						<p className="truncate text-[10px] leading-none font-medium tracking-[0.14em] text-muted-foreground uppercase">
							Admin console
						</p>
					</div>
					<span className="hidden items-center gap-2 group-data-[collapsible=icon]:flex">
						<span
							aria-hidden="true"
							className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink font-display text-xs font-semibold tracking-normal text-canvas"
						>
							SD
						</span>
						<span className="sr-only">Sceptre Drive</span>
					</span>
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
												/*
												 * No tooltip in the mobile drawer: the label is already visible, and
												 * a tooltip opens on keyboard focus, which makes it the first layer
												 * to receive Escape — so the drawer would need two presses to close.
												 * The tooltip exists for the icon-collapsed desktop rail.
												 */
												tooltip={isMobile ? undefined : item.label}
												className={cn(
													"relative text-sidebar-foreground/80 hover:text-sidebar-foreground",
													// The only brand orange in the sidebar: a 2px rail on the active item.
													"before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0 before:transition-opacity before:duration-150 before:content-['']",
													"data-[active=true]:before:opacity-100",
												)}
											>
												<Link
													to={item.to}
													data-active={activePath === item.to ? "true" : undefined}
													aria-current={activePath === item.to ? "page" : undefined}
													onClick={() => {
														if (isMobile) setOpenMobile(false)
													}}
												>
													<item.icon aria-hidden="true" />
													<span>{item.label}</span>
												</Link>
											</SidebarMenuButton>
											{item.to === "/approvals" ? <ApprovalBadge /> : null}
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
