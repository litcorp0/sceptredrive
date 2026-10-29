import { createFileRoute, Link } from "@tanstack/react-router"
import { SectionHeading } from "#/components/section-heading"
import { mailHref, partMessage, telHref, waHref } from "#/lib/contact"
import { buttonPrimary, buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/shop")({
	head: () => ({
		meta: [
			{ title: "Shop — Sceptre Drive" },
			{
				name: "description",
				content:
					"The Sceptre Drive online parts counter is being switched on. Until then, call or message the counter to order.",
			},
		],
	}),
	component: ShopPage,
})

function ShopPage() {
	const site = useSiteContent()
	const identity = site.site
	const open = identity.shopStatus === "OPEN"
	const call = telHref(identity.contactPhone)
	const message = waHref(identity.whatsapp, partMessage("a part"))
	const notify = mailHref(identity.contactEmail, "Notify me when the shop opens")

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow={open ? "The online counter" : "The online counter · Coming soon"}
				title={open ? "The counter, now online." : "The online counter is coming."}
				description={
					open
						? "Online ordering is being switched on. Until the checkout is live, call or message the counter and we will have the part ready."
						: "We are building the same counter online: the parts index, a real branch stock check and a way to order. Until then, the counter is one call away."
				}
			/>

			<div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
				<div className="border border-line bg-surface p-6 md:p-8">
					<p className="eyebrow eyebrow-brand">What is coming</p>
					<ul className="mt-5 grid gap-4 text-sm leading-relaxed text-muted-ink">
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">The parts index, searchable.</span> The same
							families on this site, with the exact part behind each one.
						</li>
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">A real branch stock check.</span> What is on
							the shelf at the counter you choose, not a warehouse guess.
						</li>
						<li className="border-t border-line pt-4">
							<span className="font-semibold text-ink">Order, then collect.</span> Pay online when
							it is ready. There is no online payment today.
						</li>
					</ul>
					<p className="mt-6 border-t border-line pt-4 text-xs text-muted-ink">
						This phase ships the website, not the checkout. Nothing here takes a payment or promises
						stock.
					</p>
				</div>

				<div className="border border-line bg-paper p-6 md:p-8">
					<p className="eyebrow">Order today</p>
					<h2 className="mt-3 font-display text-2xl font-semibold">The counter is open.</h2>
					<p className="mt-2 text-sm leading-relaxed text-muted-ink">
						Send the part number or a photo of the old part. We will confirm the match and tell you
						where it is.
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
						<Link to="/parts" className={buttonSecondary}>
							Browse parts
						</Link>
					</div>
					{notify ? (
						<a
							href={notify}
							className="mt-6 inline-block font-mono text-[11px] tracking-[0.12em] text-ink uppercase underline decoration-brand-ink underline-offset-4 hover:decoration-2"
						>
							Ask to be told when the shop opens
						</a>
					) : null}
				</div>
			</div>
		</section>
	)
}
