import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, MessageCircle, Phone } from "lucide-react"
import { SectionHeading } from "#/components/section-heading"
import { partMessage, telHref, waHref } from "#/lib/contact"
import { filterParts, PART_FAMILIES } from "#/lib/parts"
import { buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/parts")({
	validateSearch: (search: Record<string, unknown>): { q?: string } => ({
		q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
	}),
	head: () => ({
		meta: [
			{ title: "Parts index — Sceptre Drive" },
			{
				name: "description",
				content:
					"Engine, brakes, suspension, electrical, filters and body parts. Search the index, then ask the counter to match the exact part.",
			},
		],
	}),
	component: PartsPage,
})

function PartsPage() {
	const site = useSiteContent()
	const { q: searchQuery } = Route.useSearch()
	const q = searchQuery ?? ""
	const navigate = Route.useNavigate()
	const results = filterParts(q)
	const call = telHref(site.site.contactPhone)
	const message = waHref(site.site.whatsapp, partMessage(q || "a part"))
	const query = q.trim()

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow="The parts index"
				title="Find the family. Ask for the part."
				description="This is a guide to what the counter carries — not live stock. Give us the part number and we will confirm the exact match."
			/>

			<div className="mt-10 max-w-2xl">
				<label htmlFor="parts-search" className="sr-only">
					Search the parts index
				</label>
				<input
					id="parts-search"
					type="search"
					value={q}
					onChange={(event) =>
						navigate({ to: "/parts", search: { q: event.target.value }, replace: true })
					}
					placeholder="Try “brake”, “filter” or a code such as BRK"
					className="h-14 w-full rounded-md border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-muted-ink focus:border-brand-ink focus:outline-none md:text-lg"
				/>
				<p className="mt-2 font-mono text-[11px] tracking-[0.12em] text-muted-ink uppercase">
					{results.length} of {PART_FAMILIES.length} families
					{query ? ` match “${query}”` : ""}
				</p>
			</div>

			{results.length === 0 ? (
				<div className="mt-10 max-w-2xl border border-dashed border-line-strong p-6">
					<h2 className="font-display text-xl font-semibold">Nothing in the index matches that.</h2>
					<p className="mt-2 text-sm text-muted-ink">
						The shelf is deeper than the index. Ask the counter — a part can be sourced even when it
						is not listed here.
					</p>
					<div className="mt-5 flex flex-wrap gap-3">
						{message ? (
							<a href={message} target="_blank" rel="noreferrer" className={buttonPrimary}>
								<MessageCircle aria-hidden="true" className="size-4" />
								Ask on WhatsApp
							</a>
						) : null}
						<Link to="/contact" className={buttonSecondary}>
							Contact the counter
						</Link>
					</div>
				</div>
			) : (
				<ul className="mt-10 grid gap-4 md:grid-cols-2">
					{results.map((family) => (
						<li key={family.slug} className="flex flex-col border border-line bg-surface p-6">
							<div className="flex items-baseline justify-between gap-4">
								<p className="eyebrow">{family.code}</p>
								<p className="font-mono text-[11px] text-muted-ink">
									{String(family.examples.length).padStart(2, "0")} lines
								</p>
							</div>
							<h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em]">
								{family.name}
							</h2>
							<p className="mt-2 text-sm leading-relaxed text-muted-ink">{family.summary}</p>
							<p className="mt-4 font-mono text-[11px] tracking-[0.08em] text-ink uppercase">
								{family.examples.join(" · ")}
							</p>
							<div className="mt-auto flex flex-wrap items-center gap-4 pt-6">
								{message ? (
									<a
										href={waHref(site.site.whatsapp, partMessage(family.name)) ?? undefined}
										target="_blank"
										rel="noreferrer"
										className="text-sm font-semibold text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
									>
										Ask about {family.name.toLowerCase()}
									</a>
								) : (
									<Link
										to="/contact"
										className="text-sm font-semibold text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
									>
										Ask the counter
									</Link>
								)}
								<ArrowRight aria-hidden="true" className="size-4 text-brand-ink" />
							</div>
						</li>
					))}
				</ul>
			)}

			<div className="mt-14 flex flex-wrap items-center gap-4 border-t border-line pt-8">
				<p className="text-sm text-muted-ink">
					Have the part number? Call and we will check the shelf.
				</p>
				{call ? (
					<a href={call} className={buttonSecondary}>
						<Phone aria-hidden="true" className="size-4" />
						{site.site.contactPhone}
					</a>
				) : null}
				<Link
					to="/branches"
					className="text-sm font-semibold text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
				>
					See the branches
				</Link>
			</div>
		</section>
	)
}
