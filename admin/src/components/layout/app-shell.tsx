import { Outlet } from "@tanstack/react-router"
import { MenuIcon } from "lucide-react"
import { useState } from "react"
import { BranchSwitcher } from "#/components/layout/branch-switcher"
import { SidebarBrand, SidebarNav } from "#/components/layout/sidebar"
import { UserMenu } from "#/components/layout/user-menu"
import { Button } from "#/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "#/components/ui/sheet"
import type { Session } from "#/lib/auth-client"

export function AppShell({ session }: { session: Session }) {
	const [mobileOpen, setMobileOpen] = useState(false)

	return (
		<div className="flex min-h-svh">
			<aside className="sticky top-0 hidden h-svh w-58 shrink-0 flex-col border-r bg-sidebar lg:flex">
				<SidebarBrand />
				<div className="min-h-0 flex-1 overflow-y-auto">
					<SidebarNav role={session.user.role} />
				</div>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
					<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open menu">
								<MenuIcon />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-64 p-0">
							<SheetTitle className="sr-only">Navigation</SheetTitle>
							<SidebarBrand />
							<SidebarNav role={session.user.role} onNavigate={() => setMobileOpen(false)} />
						</SheetContent>
					</Sheet>

					<BranchSwitcher />

					<div className="ml-auto">
						<UserMenu session={session} />
					</div>
				</header>

				<main className="min-w-0 flex-1 p-4 md:p-6">
					<Outlet />
				</main>
			</div>
		</div>
	)
}
