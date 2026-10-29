import { createFileRoute, Link } from "@tanstack/react-router"
import { SectionHeading } from "#/components/section-heading"
import { telHref } from "#/lib/contact"
import { PART_FAMILIES } from "#/lib/parts"
import { buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/services")({
	head: () => ({
		meta: [
			{ title: "Services — Sceptre Drive" },
			{
				name: "description",
				content:
					"Counter supply for drivers, mechanics and fleets: lubricants, batteries, belts, filters, spark plugs and light bulbs.",
			},
		],
	}),
	component: ServicesPage,
})

const SERVICES = [
	{
		number: "01",
		title: "Counter supply",
		body: "The ranges a workshop fits every week: lubricants, batteries, belts, filters, spark plugs and light bulbs. Give us the vehicle and the service, and the counter finds the grade or size.",
	},
	{
		number: "02",
		title: "Trade accounts",
		body: "Repeat supply for workshops and fleets needs a reliable line, not a lucky find. Trade accounts are available for regular work.",
	},
	{
		number: "03",
		title: "Sourcing",
		body: "If a range is not on the shelf, the counter can order it through the supplier network. That is a counter conversation, not an online order.",
	},
	{
		number: "04",
		title: "Range advice",
		body: "Bring the old part or the numbers printed on it. The counter matches the range and tells you plainly what is available.",
	},
] as const

function ServicesPage() {
	const site = useSiteContent()
	const call = telHref(site.site.contactPhone)

	return (
		<>
			<section className="site-container site-section">
				<SectionHeading
					level={1}
					eyebrow="Services"
					title="A counter that works for the trade."
					description="We supply six ranges to drivers, workshops and fleets. Buying happens at the counter — this site is here to show you what we stock and where to find us."
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

					<aside className="border border-line bg-surface p-6 lg:sticky lg:top-28">
						<p className="eyebrow eyebrow-brand">What we stock</p>
						<ul className="mt-5 border-y border-dashed border-line-strong/60">
							{PART_FAMILIES.map((family) => (
								<li
									key={family.slug}
									className="flex items-baseline gap-3 border-b border-dashed border-line py-2 last:border-b-0"
								>
									<span className="font-mono text-[11px] text-muted-ink">{family.code}</span>
									<span className="flex-1 text-sm">{family.name}</span>
								</li>
							))}
						</ul>
						<p className="mt-5 text-xs leading-relaxed text-muted-ink">
							Six ranges, at the counter. No online basket, no online payment.
						</p>
					</aside>
				</div>
			</section>

			<section className="border-t border-line bg-surface">
				<div className="site-container site-section grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
					<div>
						<p className="eyebrow eyebrow-brand">Trade accounts</p>
						<h2 className="mt-3 max-w-2xl font-display text-3xl leading-[1.05] font-semibold tracking-[-0.02em] md:text-4xl">
							Tell us what you fit. We will keep the line.
						</h2>
						<p className="mt-3 max-w-2xl text-sm text-muted-ink md:text-base">
							Trade accounts are available for workshops and fleets. A counter conversation is
							faster than a form.
						</p>
					</div>
					<div className="flex flex-wrap gap-3">
						{call ? (
							<a href={call} className={buttonSecondary}>
								Call the counter
							</a>
						) : null}
						<Link to="/contact" className={buttonPrimary}>
							Contact us
						</Link>
					</div>
				</div>
			</section>
		</>
	)
}
