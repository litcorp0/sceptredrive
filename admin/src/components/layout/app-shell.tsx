import { Outlet } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { BranchSwitcher } from "#/components/layout/branch-switcher"
import { AppSidebar } from "#/components/layout/sidebar"
import { UserMenu } from "#/components/layout/user-menu"
import { SidebarProvider, SidebarTrigger } from "#/components/ui/sidebar"
import type { Session } from "#/lib/auth-client"

export function AppShell({ session }: { session: Session }) {
	return (
		<SidebarProvider style={{ "--sidebar-width": "var(--layout-sidebar-width)" } as CSSProperties}>
			<AppSidebar role={session.user.role} />

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-30 flex h-(--layout-topbar-height) items-center gap-3 bg-topbar px-4 text-topbar-foreground print:hidden">
					<SidebarTrigger aria-label="Toggle navigation" className="-ml-1" />

					<div className="ml-auto flex items-center gap-2">
						<BranchSwitcher />
						<UserMenu session={session} />
					</div>
				</header>

				<main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6 print:p-0">
					<Outlet />
				</main>
			</div>
		</SidebarProvider>
	)
}
