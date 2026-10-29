import { createFileRoute, Link } from "@tanstack/react-router"
import { SectionHeading } from "#/components/section-heading"
import { filterParts, PART_FAMILIES } from "#/lib/parts"
import { buttonSecondary } from "#/lib/ui"

export const Route = createFileRoute("/parts")({
	validateSearch: (search: Record<string, unknown>): { q?: string } => ({
		q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
	}),
	head: () => ({
		meta: [
			{ title: "What we stock — Sceptre Drive" },
			{
				name: "description",
				content:
					"Lubricants, batteries, belts, filters, spark plugs and light bulbs. The ranges Sceptre Drive carries at its counters.",
			},
		],
	}),
	component: PartsPage,
})

function PartsPage() {
	const { q: searchQuery } = Route.useSearch()
	const q = searchQuery ?? ""
	const navigate = Route.useNavigate()
	const results = filterParts(q)
	const query = q.trim()

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow="What we stock"
				title="The ranges we carry."
				description="Lubricants, batteries, belts, filters, spark plugs and light bulbs. This is a guide to the ranges, not live stock — visit a branch for availability."
			/>

			<div className="mt-10 max-w-2xl">
				<label htmlFor="parts-search" className="sr-only">
					Search the ranges
				</label>
				<input
					id="parts-search"
					type="search"
					value={q}
					onChange={(event) =>
						navigate({ to: "/parts", search: { q: event.target.value }, replace: true })
					}
					placeholder="Try “battery”, “filter” or a code such as BAT"
					className="h-14 w-full rounded-md border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-muted-ink focus:border-brand-ink focus:outline-none md:text-lg"
				/>
				<p className="mt-2 font-mono text-[11px] tracking-[0.12em] text-muted-ink uppercase">
					{results.length} of {PART_FAMILIES.length} ranges
					{query ? ` match “${query}”` : ""}
				</p>
			</div>

			{results.length === 0 ? (
				<div className="mt-10 max-w-2xl border border-dashed border-line-strong p-6">
					<h2 className="font-display text-xl font-semibold">No range matches that.</h2>
					<p className="mt-2 text-sm text-muted-ink">
						Try a broader term such as “filter”, “battery” or “bulb”.
					</p>
					<Link to="/parts" className={`${buttonSecondary} mt-5`}>
						Clear the search
					</Link>
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
						</li>
					))}
				</ul>
			)}

			<div className="mt-14 flex flex-wrap items-center gap-4 border-t border-line pt-8">
				<p className="text-sm text-muted-ink">
					This site does not take orders. Parts are supplied at the counter.
				</p>
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
