import { createFileRoute, Link } from "@tanstack/react-router"
import { Photo } from "#/components/photo"
import { SectionHeading } from "#/components/section-heading"
import { partMessage, telHref, waHref } from "#/lib/contact"
import { buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/services")({
	head: () => ({
		meta: [
			{ title: "Services — Sceptre Drive" },
			{
				name: "description",
				content:
					"Counter supply for drivers, mechanics and fleets: part matching, workshop supply, sourcing and trade accounts.",
			},
		],
	}),
	component: ServicesPage,
})

const SERVICES = [
	{
		number: "01",
		title: "Workshop supply",
		body: "A counter account for the parts a workshop fits every week: filters, brakes, belts and the consumables that run out. Give us the numbers you use and we keep them moving.",
	},
	{
		number: "02",
		title: "Fleet & trade",
		body: "Repeat parts for a fleet need a reliable line, not a lucky find. Ask about a trade account and how the counter can hold a regular list for you.",
	},
	{
		number: "03",
		title: "Sourcing",
		body: "If a part is not on the shelf, ask. Our supplier network is how the unusual part arrives without you driving across Accra.",
	},
	{
		number: "04",
		title: "Part matching",
		body: "Bring the old part or the number stamped on it. We match against the catalogue and the shelf, and tell you plainly what is available.",
	},
] as const

function ServicesPage() {
	const site = useSiteContent()
	const call = telHref(site.site.contactPhone)
	const message = waHref(site.site.whatsapp, partMessage("a part for my workshop"))

	return (
		<>
			<section className="site-container site-section">
				<SectionHeading
					level={1}
					eyebrow="Services"
					title="A counter that works for the trade."
					description="Walk in with a part number. Walk out with the right part, or a straight answer about when it can be here."
				/>

				<div className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
					<ol className="grid gap-8">
						{SERVICES.map((service) => (
							<li key={service.number} className="border-t border-line pt-6">
								<div className="flex items-baseline gap-4">
									<span className="font-mono text-xs text-muted-ink">{service.number}</span>
									<h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">
										{service.title}
									</h2>
								</div>
								<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-ink md:text-base">
									{service.body}
								</p>
							</li>
						))}
					</ol>

					<figure className="lg:sticky lg:top-28">
						<Photo
							name="suspension-work"
							alt="A mechanic compressing a suspension spring with a power tool in a workshop"
							width={1200}
							height={1798}
							className="aspect-[4/5] w-full border border-line object-cover"
						/>
						<figcaption className="mt-3 font-mono text-[11px] tracking-[0.12em] text-muted-ink uppercase">
							Workshop supply · Accra
						</figcaption>
					</figure>
				</div>
			</section>

			<section className="border-t border-line bg-surface">
				<div className="site-container site-section grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
					<div>
						<p className="eyebrow eyebrow-brand">Trade account</p>
						<h2 className="mt-3 max-w-2xl font-display text-3xl leading-[1.05] font-semibold tracking-[-0.02em] md:text-4xl">
							Tell us what you fit. We will keep the line.
						</h2>
						<p className="mt-3 max-w-2xl text-sm text-muted-ink md:text-base">
							No forms on this page — a counter conversation is faster. Call or message and ask for
							the trade desk.
						</p>
					</div>
					<div className="flex flex-wrap gap-3">
						{call ? (
							<a href={call} className={buttonSecondary}>
								Call the counter
							</a>
						) : null}
						{message ? (
							<a href={message} target="_blank" rel="noreferrer" className={buttonPrimary}>
								Ask on WhatsApp
							</a>
						) : (
							<Link to="/contact" className={buttonPrimary}>
								Contact us
							</Link>
						)}
					</div>
				</div>
			</section>
		</>
	)
}
