import { createFileRoute, Link } from "@tanstack/react-router"
import { MapPin, Phone } from "lucide-react"
import { SectionHeading } from "#/components/section-heading"
import { mapsHref, telHref } from "#/lib/contact"
import { buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/branches")({
	head: () => ({
		meta: [
			{ title: "Branches — Sceptre Drive" },
			{
				name: "description",
				content:
					"Find a Sceptre Drive parts counter: address, opening hours, phone and directions for every retail branch.",
			},
		],
	}),
	component: BranchesPage,
})

function BranchesPage() {
	const site = useSiteContent()
	const identity = site.site

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow="Find us"
				title="A counter near the road."
				description="Every branch is a parts counter. Address, hours and a phone number — no call centre in between."
			/>

			{site.branches.length === 0 ? (
				<div className="mt-10 max-w-2xl border border-dashed border-line-strong p-6">
					<h2 className="font-display text-xl font-semibold">Branch details are being updated.</h2>
					<p className="mt-2 text-sm text-muted-ink">
						Call or message the counter and we will point you to the nearest branch.
					</p>
					<Link to="/contact" className={`${buttonSecondary} mt-5`}>
						Contact the counter
					</Link>
				</div>
			) : (
				<ul className="mt-10 grid gap-4 md:grid-cols-2">
					{site.branches.map((branch) => {
						const call = telHref(branch.phone ?? identity.contactPhone)
						const map = mapsHref(branch)

						return (
							<li key={branch.code} className="flex flex-col border border-line bg-surface p-6">
								<p className="eyebrow">{branch.code}</p>
								<h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em]">
									{branch.name}
								</h2>
								<p className="mt-1 text-sm text-muted-ink">
									{[branch.area, branch.city].filter(Boolean).join(", ")}
								</p>

								<dl className="mt-6 grid gap-3 text-sm">
									<div className="flex gap-3">
										<dt className="w-14 shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted-ink uppercase">
											Address
										</dt>
										<dd className="text-ink">
											{branch.address ?? "Ask the counter for directions"}
										</dd>
									</div>
									<div className="flex gap-3">
										<dt className="w-14 shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted-ink uppercase">
											Hours
										</dt>
										<dd className="text-ink">{branch.hours ?? "Call for opening hours"}</dd>
									</div>
									<div className="flex gap-3">
										<dt className="w-14 shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted-ink uppercase">
											Phone
										</dt>
										<dd className="text-ink">
											{call ? (
												<a href={call} className="underline-offset-4 hover:underline">
													{branch.phone ?? identity.contactPhone}
												</a>
											) : (
												"Ask the counter"
											)}
										</dd>
									</div>
								</dl>

								<div className="mt-auto flex flex-wrap gap-3 pt-6">
									{call ? (
										<a href={call} className={buttonSecondary}>
											<Phone aria-hidden="true" className="size-4" />
											Call
										</a>
									) : null}
									{map ? (
										<a href={map} target="_blank" rel="noreferrer" className={buttonSecondary}>
											<MapPin aria-hidden="true" className="size-4" />
											Directions
										</a>
									) : null}
								</div>
							</li>
						)
					})}
				</ul>
			)}

			<p className="mt-10 max-w-2xl border-t border-line pt-6 text-xs leading-relaxed text-muted-ink">
				Warehouse stock is not a walk-in counter. If a part needs collecting from the warehouse, the
				counter will arrange it with you.
			</p>
		</section>
	)
}
