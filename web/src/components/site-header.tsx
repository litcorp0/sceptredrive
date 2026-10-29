import type { SiteIdentity } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { telHref } from "#/lib/contact"
import { SiteLogo } from "./site-logo"

const NAV = [
	{ to: "/parts" as const, label: "Parts" },
	{ to: "/services" as const, label: "Services" },
	{ to: "/branches" as const, label: "Branches" },
	{ to: "/about" as const, label: "About" },
	{ to: "/contact" as const, label: "Contact" },
]

export function SiteHeader({ site }: { site: SiteIdentity }) {
	const call = telHref(site.contactPhone)

	return (
		<>
			{site.announcement ? (
				<div className="bg-fascia text-fascia-foreground">
					<p className="site-container py-2 text-center text-xs tracking-wide md:text-sm">
						{site.announcement}
					</p>
				</div>
			) : null}

			<header className="sticky top-0 z-40 border-b border-line bg-canvas">
				<div className="site-container flex h-(--site-header-height) items-center justify-between gap-6">
					<Link to="/" className="shrink-0" aria-label={`${site.name} — home`}>
						<SiteLogo name={site.name} className="h-9 md:h-10" />
					</Link>

					<nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
						{NAV.map((item) => (
							<Link
								key={item.to}
								to={item.to}
								className="text-sm text-muted-ink underline-offset-4 transition-colors hover:text-ink hover:underline"
								activeProps={{ className: "text-ink font-medium" }}
							>
								{item.label}
							</Link>
						))}
					</nav>

					<div className="hidden items-center gap-3 lg:flex">
						{call ? (
							<a
								href={call}
								className="text-sm font-medium text-ink underline-offset-4 hover:underline"
							>
								Call the counter
							</a>
						) : null}
						<Link
							to="/parts"
							className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg transition-colors hover:bg-ink hover:text-canvas"
						>
							What we stock
						</Link>
					</div>

					<details className="relative lg:hidden">
						<summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md border border-line-strong text-ink [&::-webkit-details-marker]:hidden">
							<span className="sr-only">Open menu</span>
							<Menu aria-hidden="true" className="size-5" />
						</summary>
						<div className="absolute top-13 right-0 w-64 rounded-lg border border-line bg-surface p-2 shadow-pop">
							<nav aria-label="Mobile" className="grid">
								{NAV.map((item) => (
									<Link
										key={item.to}
										to={item.to}
										className="rounded-md px-3 py-3 text-sm text-ink hover:bg-brand-tint"
										activeProps={{ className: "bg-brand-tint font-medium" }}
									>
										{item.label}
									</Link>
								))}
								<Link
									to="/parts"
									className="mt-2 rounded-md bg-brand px-3 py-3 text-center text-sm font-semibold text-brand-fg"
								>
									What we stock
								</Link>
							</nav>
						</div>
					</details>
				</div>
			</header>
		</>
	)
}
