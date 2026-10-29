import { createFileRoute, Link } from "@tanstack/react-router"
import { SectionHeading } from "#/components/section-heading"
import { ENQUIRY_MESSAGE, telHref, waHref } from "#/lib/contact"
import { PART_FAMILIES } from "#/lib/parts"
import { buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/shop")({
	head: () => ({
		meta: [
			{ title: "Online shop — Sceptre Drive" },
			{
				name: "description",
				content:
					"Sceptre Drive's website is an online presence, not an online shop. See the ranges we stock and find a branch; there is no online checkout.",
			},
		],
	}),
	component: ShopPage,
})

function ShopPage() {
	const site = useSiteContent()
	const identity = site.site
	const call = telHref(identity.contactPhone)
	const message = waHref(identity.whatsapp, ENQUIRY_MESSAGE)
	const comingSoon = identity.shopStatus === "COMING_SOON"

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow="Online shop"
				title="No online sales — for now."
				description="This website is our online presence. We do not take orders or payments here. Use it to see the ranges we stock, find a branch and get in touch."
			/>

			<div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
				<div className="border border-line bg-surface p-6 md:p-8">
					<p className="eyebrow eyebrow-brand">What this site is for</p>
					<ul className="mt-5 grid gap-4 text-sm leading-relaxed text-muted-ink">
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">The ranges.</span> Lubricants, batteries,
							belts, filters, spark plugs and light bulbs — the six ranges the counter carries.
						</li>
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">The branches.</span> Address, hours and
							directions for every retail counter.
						</li>
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">The counter.</span> Call, message or email
							for general enquiries and trade accounts.
						</li>
					</ul>
					<div className="mt-6 flex flex-wrap gap-3">
						<Link to="/parts" className={buttonSecondary}>
							See the ranges
						</Link>
						<Link to="/branches" className={buttonSecondary}>
							Find a branch
						</Link>
					</div>
				</div>

				<div className="border border-line bg-paper p-6 md:p-8">
					<p className="eyebrow">Buying parts</p>
					<h2 className="mt-3 font-display text-2xl font-semibold">
						{comingSoon ? "Online ordering is not available yet." : "Buy at the counter."}
					</h2>
					<p className="mt-2 text-sm leading-relaxed text-muted-ink">
						There is no basket, checkout or online payment on this site. Parts are supplied at the
						counter, and the counter is the fastest way to check a range.
					</p>
					<div className="mt-6 flex flex-wrap gap-3">
						{call ? (
							<a href={call} className={buttonPrimary}>
								Call the counter
							</a>
						) : null}
						{message ? (
							<a href={message} target="_blank" rel="noreferrer" className={buttonSecondary}>
								WhatsApp
							</a>
						) : null}
						<Link to="/contact" className={buttonSecondary}>
							Contact us
						</Link>
					</div>
					<p className="mt-6 font-mono text-[11px] tracking-[0.12em] text-muted-ink uppercase">
						{PART_FAMILIES.length} ranges · {site.branches.length}{" "}
						{site.branches.length === 1 ? "branch" : "branches"}
					</p>
				</div>
			</div>
		</section>
	)
}
