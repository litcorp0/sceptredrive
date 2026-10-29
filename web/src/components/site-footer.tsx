import type { SiteContent } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { mailHref, telHref, waHref } from "#/lib/contact"
import { SiteLogo } from "./site-logo"

const LINKS = [
	{ to: "/parts" as const, label: "Parts" },
	{ to: "/services" as const, label: "Services" },
	{ to: "/branches" as const, label: "Branches" },
	{ to: "/about" as const, label: "About" },
	{ to: "/contact" as const, label: "Contact" },
	{ to: "/shop" as const, label: "Shop" },
]

export function SiteFooter({ site }: { site: SiteContent }) {
	const identity = site.site
	const call = telHref(identity.contactPhone)
	const message = waHref(identity.whatsapp, "Hello Sceptre Drive, I'd like help with a part.")
	const mail = mailHref(identity.contactEmail, "Parts enquiry")
	const social = [
		{ href: identity.social.instagram, label: "Instagram" },
		{ href: identity.social.facebook, label: "Facebook" },
		{ href: identity.social.tiktok, label: "TikTok" },
	].filter((item) => item.href !== "")

	return (
		<footer className="bg-fascia text-fascia-foreground">
			<div className="site-container grid gap-12 py-14 md:grid-cols-[1.4fr_1fr_1fr] md:py-16">
				<div className="max-w-sm">
					<SiteLogo name={identity.name} inverse className="h-9" />
					<p className="mt-5 text-sm leading-relaxed text-fascia-foreground/70">
						{identity.tagline}
					</p>
					<p className="mt-4 font-mono text-[11px] tracking-[0.12em] text-fascia-foreground/50 uppercase">
						Online presence · no online sales
					</p>
				</div>

				<div>
					<p className="eyebrow text-fascia-foreground/50">Explore</p>
					<ul className="mt-4 grid gap-2">
						{LINKS.map((item) => (
							<li key={item.to}>
								<Link
									to={item.to}
									className="text-sm text-fascia-foreground/80 underline-offset-4 hover:text-fascia-foreground hover:underline"
								>
									{item.label}
								</Link>
							</li>
						))}
					</ul>
				</div>

				<div>
					<p className="eyebrow text-fascia-foreground/50">At the counter</p>
					<ul className="mt-4 grid gap-2 text-sm">
						{call ? (
							<li>
								<a href={call} className="underline-offset-4 hover:underline">
									{identity.contactPhone}
								</a>
							</li>
						) : null}
						{message ? (
							<li>
								<a
									href={message}
									className="underline-offset-4 hover:underline"
									target="_blank"
									rel="noreferrer"
								>
									WhatsApp
								</a>
							</li>
						) : null}
						{mail ? (
							<li>
								<a href={mail} className="underline-offset-4 hover:underline">
									{identity.contactEmail}
								</a>
							</li>
						) : null}
						{!call && !message && !mail ? (
							<li className="text-fascia-foreground/60">
								<Link to="/contact" className="underline-offset-4 hover:underline">
									Contact the counter
								</Link>
							</li>
						) : null}
					</ul>
					{social.length > 0 ? (
						<ul className="mt-5 flex gap-4">
							{social.map((item) => (
								<li key={item.label}>
									<a
										href={item.href}
										className="text-sm text-fascia-foreground/80 underline-offset-4 hover:text-fascia-foreground hover:underline"
										target="_blank"
										rel="noreferrer"
									>
										{item.label}
									</a>
								</li>
							))}
						</ul>
					) : null}
				</div>
			</div>

			<div className="border-t border-white/10">
				<div className="site-container flex flex-col gap-2 py-5 text-xs text-fascia-foreground/50 sm:flex-row sm:items-center sm:justify-between">
					<p>
						© {new Date().getFullYear()} {identity.name}. Parts for the road.
					</p>
					<p className="font-mono tracking-wide">
						{site.branches.length} {site.branches.length === 1 ? "branch" : "branches"} · Ghana
					</p>
				</div>
			</div>
		</footer>
	)
}
