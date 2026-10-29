import { createFileRoute, Link } from "@tanstack/react-router"
import { Photo } from "#/components/photo"
import { SectionHeading } from "#/components/section-heading"
import { buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/about")({
	head: () => ({
		meta: [
			{ title: "About — Sceptre Drive" },
			{
				name: "description",
				content:
					"Sceptre Drive supplies genuine, OEM-matched and aftermarket automotive spare parts across Ghana, with every sale recorded.",
			},
		],
	}),
	component: AboutPage,
})

const STANDARDS = [
	{
		title: "Recorded",
		body: "Every sale is written down against a branch and a receipt, so a part can be traced back to what was actually sold.",
	},
	{
		title: "Matched",
		body: "A part number is checked against the catalogue and the shelf before it leaves the counter.",
	},
	{
		title: "Connected",
		body: "Retail counters share one stock and credit picture with the warehouse behind them.",
	},
] as const

function AboutPage() {
	const site = useSiteContent()
	const paragraphs = site.site.aboutBody
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")

	return (
		<>
			<section className="site-container site-section">
				<SectionHeading
					level={1}
					eyebrow="About"
					title="A parts business, run like one."
					description={site.site.tagline}
				/>

				<div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
					<div className="max-w-2xl text-base leading-relaxed text-ink">
						{paragraphs.map((paragraph) => (
							<p
								key={paragraph}
								className="mb-4 text-base leading-relaxed text-muted-ink md:text-lg"
							>
								{paragraph}
							</p>
						))}
						<p className="mt-6 text-sm text-muted-ink">
							The counter is the product: a person who knows the catalogue, a shelf that is counted,
							and a receipt that can be found again.
						</p>
					</div>
					<figure>
						<Photo
							name="engine-block"
							alt="A stripped car engine block on a workshop stand"
							width={1200}
							height={899}
							className="aspect-[4/3] w-full border border-line object-cover"
						/>
						<figcaption className="mt-3 font-mono text-[11px] tracking-[0.12em] text-muted-ink uppercase">
							Engine & drivetrain · counter stock
						</figcaption>
					</figure>
				</div>
			</section>

			<section className="border-t border-line bg-surface">
				<div className="site-container site-section">
					<SectionHeading eyebrow="How we work" title="Three things we will not skip." />
					<div className="mt-10 grid gap-6 md:grid-cols-3">
						{STANDARDS.map((standard) => (
							<article key={standard.title} className="border-t-2 border-brand pt-5">
								<h2 className="font-display text-lg font-semibold">{standard.title}</h2>
								<p className="mt-2 text-sm leading-relaxed text-muted-ink">{standard.body}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="site-container site-section">
				<div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
					<p className="max-w-xl text-base text-muted-ink">
						Looking for a part, or a branch near you? The counter is one call away.
					</p>
					<div className="flex flex-wrap gap-3">
						<Link to="/parts" className={buttonSecondary}>
							Browse parts
						</Link>
						<Link to="/contact" className={buttonSecondary}>
							Contact us
						</Link>
					</div>
				</div>
			</section>
		</>
	)
}
