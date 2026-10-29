import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, MapPin, ScanBarcode, Users } from "lucide-react"
import { CounterTicket } from "#/components/counter-ticket"
import { Photo } from "#/components/photo"
import { SectionHeading } from "#/components/section-heading"
import { ENQUIRY_MESSAGE, telHref, waHref } from "#/lib/contact"
import { PART_FAMILIES } from "#/lib/parts"
import { buttonOnFascia, buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [
			{ title: "Sceptre Drive — auto spare parts in Ghana" },
			{
				name: "description",
				content:
					"Lubricants, batteries, belts, filters, spark plugs and light bulbs for drivers, workshops and fleets across Ghana. Find a branch and visit the counter.",
			},
		],
	}),
	component: HomePage,
})

const STEPS = [
	{
		number: "01",
		title: "Bring the part number",
		body: "The number on the old part is the fastest match. No number? Bring the part itself, or tell us the car and the symptom.",
	},
	{
		number: "02",
		title: "We match it at the counter",
		body: "A counter checks the number against the shelf and the catalogue, and tells you what is here and what has to be sourced.",
	},
	{
		number: "03",
		title: "Collect, fit, keep the receipt",
		body: "Take it with you or have it fitted. Every sale is recorded, so the next visit starts from what you actually bought.",
	},
] as const

const REASONS = [
	{
		icon: ScanBarcode,
		title: "Every part is traced",
		body: "Parts are recorded against a sale and a branch. A counter can look up what you bought instead of guessing.",
	},
	{
		icon: MapPin,
		title: "Branches, not a call centre",
		body: "Retail counters and a warehouse behind them, so a part can move between locations without leaving the business.",
	},
	{
		icon: Users,
		title: "Built for drivers and workshops",
		body: "Walk-in customers, mechanics and fleets use the same counter. Trade accounts are available for repeat work.",
	},
] as const

function HomePage() {
	const site = useSiteContent()
	const identity = site.site
	const call = telHref(identity.contactPhone)
	const message = waHref(identity.whatsapp, ENQUIRY_MESSAGE)
	const primaryBranch = site.branches[0]

	return (
		<>
			<section className="site-container grid items-center gap-12 pt-12 pb-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20 lg:pb-24">
				<div>
					<p className="eyebrow eyebrow-brand site-rise">Auto spare parts · Ghana</p>
					<h1 className="site-rise mt-4 max-w-2xl font-display text-5xl leading-[0.95] font-semibold tracking-[-0.03em] text-balance [animation-delay:80ms] md:text-7xl">
						{identity.heroHeading}
					</h1>
					<svg viewBox="0 0 320 12" className="site-draw mt-6 h-2 w-56 md:w-80" aria-hidden="true">
						<path
							d="M2 9C80 3 180 2 318 6"
							fill="none"
							stroke="var(--brand)"
							strokeWidth="3"
							strokeLinecap="round"
						/>
					</svg>
					<p className="site-rise mt-6 max-w-xl text-lg leading-relaxed text-muted-ink [animation-delay:160ms]">
						{identity.heroBody}
					</p>
					<div className="site-rise mt-8 flex flex-wrap gap-3 [animation-delay:240ms]">
						<Link to="/parts" className={buttonPrimary}>
							See the range
						</Link>
						<Link to="/branches" className={buttonSecondary}>
							Visit a branch
						</Link>
					</div>
					<p className="site-rise mt-8 font-mono text-[11px] tracking-[0.14em] text-muted-ink uppercase [animation-delay:320ms]">
						Genuine · OEM-matched · Aftermarket
					</p>
				</div>

				<div className="flex justify-center lg:justify-end">
					<CounterTicket families={PART_FAMILIES} branchName={primaryBranch?.name} />
				</div>
			</section>

			<section className="border-t border-line">
				<div className="site-container site-section">
					<div className="flex flex-wrap items-end justify-between gap-6">
						<SectionHeading
							eyebrow="The ranges"
							title="Six families. One counter."
							description="Search the ranges, then visit a branch to check availability. The shelf is deeper than this page."
						/>
						<Link to="/parts" className={buttonSecondary}>
							See the full range
							<ArrowRight aria-hidden="true" className="size-4" />
						</Link>
					</div>

					<ul className="mt-10 border-t border-line">
						{PART_FAMILIES.map((family) => (
							<li key={family.slug}>
								<Link
									to="/parts"
									search={{ q: family.name }}
									className="part-row group grid grid-cols-[auto_1fr_auto] items-baseline gap-4 border-b border-line py-5"
								>
									<span className="font-mono text-[11px] text-muted-ink">{family.code}</span>
									<span>
										<span className="block font-display text-2xl font-semibold tracking-[-0.02em] md:text-3xl">
											{family.name}
										</span>
										<span className="mt-1 block text-sm text-muted-ink">
											{family.examples.join(" · ")}
										</span>
									</span>
									<ArrowRight
										aria-hidden="true"
										className="size-5 text-brand-ink transition-transform group-hover:translate-x-1"
									/>
								</Link>
							</li>
						))}
					</ul>
				</div>
			</section>

			<section className="site-container site-section">
				<SectionHeading
					eyebrow="At the counter"
					title="A real sequence, not a slogan."
					description="What happens between walking in and driving out."
				/>
				<ol className="mt-10 grid gap-8 md:grid-cols-3">
					{STEPS.map((step) => (
						<li key={step.number} className="border-t-2 border-brand pt-5">
							<p className="font-mono text-xs text-muted-ink">{step.number}</p>
							<h3 className="mt-2 font-display text-xl font-semibold">{step.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-ink">{step.body}</p>
						</li>
					))}
				</ol>
			</section>

			<section className="site-container pb-16 lg:pb-24">
				<figure className="relative overflow-hidden border border-line">
					<Photo
						name="workshop-bench"
						alt="A workshop bench with tools, a tool chest and a car raised behind it"
						width={1600}
						height={1069}
						className="h-[20rem] w-full object-cover md:h-[27rem]"
					/>
					<figcaption className="absolute inset-x-0 bottom-0 bg-fascia/90 p-5 text-fascia-foreground md:p-7">
						<p className="eyebrow text-fascia-foreground/60">Workshop & fleet supply</p>
						<p className="mt-2 max-w-2xl font-display text-xl font-semibold md:text-2xl">
							Workshop and fleet supply, from the counter.
						</p>
					</figcaption>
				</figure>
			</section>

			<section className="border-t border-line bg-surface">
				<div className="site-container site-section">
					<SectionHeading
						eyebrow="Why Sceptre Drive"
						title="Parts with a paper trail."
						description="The business is built on a till, a ledger and a counter — the website is just the front of it."
					/>
					<div className="mt-10 grid gap-6 md:grid-cols-3">
						{REASONS.map((reason) => (
							<article key={reason.title} className="border border-line bg-paper p-6">
								<reason.icon aria-hidden="true" className="size-6 text-brand-ink" />
								<h3 className="mt-4 font-display text-lg font-semibold">{reason.title}</h3>
								<p className="mt-2 text-sm leading-relaxed text-muted-ink">{reason.body}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="site-container site-section">
				<div className="flex flex-wrap items-end justify-between gap-6">
					<SectionHeading
						eyebrow="Find us"
						title="The counter is the product."
						description="Address, hours and a map for every retail branch."
					/>
					<Link to="/branches" className={buttonSecondary}>
						All branches
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</div>
				<div className="mt-10 grid gap-4 md:grid-cols-2">
					{site.branches.length === 0 ? (
						<div className="border border-dashed border-line-strong p-6 text-sm text-muted-ink">
							Branch details are being updated.{" "}
							<Link
								to="/contact"
								className="text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
							>
								Contact the counter
							</Link>{" "}
							for the nearest location.
						</div>
					) : (
						site.branches.slice(0, 2).map((branch) => (
							<Link
								key={branch.code}
								to="/branches"
								className="group border border-line bg-surface p-6 transition-colors hover:bg-brand-tint"
							>
								<p className="eyebrow">{branch.code}</p>
								<p className="mt-3 font-display text-2xl font-semibold">{branch.name}</p>
								<p className="mt-1 text-sm text-muted-ink">
									{[branch.area, branch.city].filter(Boolean).join(", ")}
								</p>
								<p className="mt-4 font-mono text-[11px] tracking-[0.12em] text-brand-ink uppercase">
									{branch.hours ?? "Call for hours"}
								</p>
							</Link>
						))
					)}
				</div>
			</section>

			<section className="bg-fascia text-fascia-foreground">
				<div className="site-container grid gap-8 py-16 md:grid-cols-[1fr_auto] md:items-end md:py-20">
					<div>
						<p className="eyebrow text-fascia-foreground/60">At the counter</p>
						<h2 className="mt-3 max-w-2xl font-display text-4xl leading-[1.02] font-semibold tracking-[-0.03em] text-balance md:text-5xl">
							Find the counter nearest you.
						</h2>
						<p className="mt-3 max-w-xl text-sm leading-relaxed text-fascia-foreground/70">
							We do not sell online. Visit a branch or contact us for general enquiries.
						</p>
					</div>
					<div className="flex flex-wrap gap-3">
						{call ? (
							<a
								href={call}
								className="inline-flex h-12 items-center rounded-md border border-white/25 px-6 text-sm font-semibold text-fascia-foreground transition-colors hover:bg-white/10"
							>
								Call the counter
							</a>
						) : null}
						{message ? (
							<a
								href={message}
								target="_blank"
								rel="noreferrer"
								className="inline-flex h-12 items-center rounded-md border border-white/25 px-6 text-sm font-semibold text-fascia-foreground transition-colors hover:bg-white/10"
							>
								WhatsApp
							</a>
						) : null}
						<Link to="/contact" className={buttonOnFascia}>
							Contact us
						</Link>
					</div>
				</div>
			</section>
		</>
	)
}
