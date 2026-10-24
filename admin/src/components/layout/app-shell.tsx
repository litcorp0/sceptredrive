import { Outlet, useRouterState } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { BranchSwitcher } from "#/components/layout/branch-switcher"
import { AppSidebar, topbarBreadcrumb } from "#/components/layout/sidebar"
import { ThemeToggle } from "#/components/layout/theme-toggle"
import { UserMenu } from "#/components/layout/user-menu"
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb"
import { SidebarProvider, SidebarTrigger } from "#/components/ui/sidebar"
import type { Session } from "#/lib/auth-client"

export function AppShell({ session }: { session: Session }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const { section, page } = topbarBreadcrumb(pathname)

	return (
		<>
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg"
			>
				Skip to main content
			</a>

			<SidebarProvider
				// Printed statements hide the whole rail: the primitive reserves its width
				// with a sibling gap element, so hiding only the container would leave a
				// 15.5rem blank margin on paper.
				className="[&_[data-slot=sidebar]]:print:hidden"
				style={{ "--sidebar-width": "var(--layout-sidebar-width)" } as CSSProperties}
			>
				<AppSidebar role={session.user.role} />

				<div className="flex min-w-0 flex-1 flex-col">
					<header className="sticky top-0 z-30 flex h-(--layout-topbar-height) items-center gap-3 bg-topbar px-3 text-topbar-foreground print:hidden sm:px-4">
						<SidebarTrigger
							aria-label="Toggle navigation"
							className="-ml-1 size-8 text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground"
						/>

						<Breadcrumb className="hidden min-w-0 sm:block">
							<BreadcrumbList className="flex-nowrap gap-1.5 text-topbar-muted sm:gap-2">
								{section ? (
									<>
										<BreadcrumbItem className="hidden md:inline-flex">
											<span>{section}</span>
										</BreadcrumbItem>
										<BreadcrumbSeparator className="hidden text-topbar-muted md:block" />
									</>
								) : null}
								<BreadcrumbItem className="min-w-0">
									<BreadcrumbPage className="max-w-[18ch] truncate text-topbar-foreground">
										{page}
									</BreadcrumbPage>
								</BreadcrumbItem>
							</BreadcrumbList>
						</Breadcrumb>

						<div className="ml-auto flex items-center gap-1.5 sm:gap-2">
							<BranchSwitcher />
							<ThemeToggle />
							<UserMenu session={session} />
						</div>
					</header>

					<main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6 print:p-0">
						<Outlet />
					</main>
				</div>
			</SidebarProvider>
		</>
	)
}
