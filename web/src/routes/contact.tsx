import { createFileRoute, Link } from "@tanstack/react-router"
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react"
import { SectionHeading } from "#/components/section-heading"
import { ENQUIRY_MESSAGE, mailHref, mapsHref, telHref, waHref } from "#/lib/contact"
import { buttonSecondary } from "#/lib/ui"
import { useSiteContent } from "#/lib/use-site"

export const Route = createFileRoute("/contact")({
	head: () => ({
		meta: [
			{ title: "Contact — Sceptre Drive" },
			{
				name: "description",
				content:
					"Call, message or visit the Sceptre Drive counter. Phone, WhatsApp, email and branch directions for general enquiries.",
			},
		],
	}),
	component: ContactPage,
})

function ContactPage() {
	const site = useSiteContent()
	const identity = site.site
	const branchPhone = site.branches.find((branch) => branch.phone)?.phone ?? ""
	const phone = identity.contactPhone || branchPhone
	const call = telHref(phone)
	const message = waHref(identity.whatsapp, ENQUIRY_MESSAGE)
	const mail = mailHref(identity.contactEmail, "Parts enquiry")

	return (
		<section className="site-container site-section">
			<SectionHeading
				level={1}
				eyebrow="Contact"
				title="Talk to the counter."
				description="No ticket numbers and no call centre. Choose how to reach us for general enquiries, trade accounts or directions. We do not sell online."
			/>

			<div className="mt-10 grid gap-4 md:grid-cols-2">
				{call ? (
					<a
						href={call}
						className="group flex items-start gap-4 border border-line bg-surface p-6 transition-colors hover:bg-brand-tint"
					>
						<Phone aria-hidden="true" className="mt-1 size-5 text-brand-ink" />
						<span>
							<span className="eyebrow">Call</span>
							<span className="mt-2 block font-display text-2xl font-semibold">{phone}</span>
							<span className="mt-1 block text-sm text-muted-ink">
								General enquiries, trade accounts and branch information.
							</span>
						</span>
					</a>
				) : null}

				{message ? (
					<a
						href={message}
						target="_blank"
						rel="noreferrer"
						className="group flex items-start gap-4 border border-line bg-surface p-6 transition-colors hover:bg-brand-tint"
					>
						<MessageCircle aria-hidden="true" className="mt-1 size-5 text-brand-ink" />
						<span>
							<span className="eyebrow">WhatsApp</span>
							<span className="mt-2 block font-display text-2xl font-semibold">
								Message the counter
							</span>
							<span className="mt-1 block text-sm text-muted-ink">
								General enquiries and branch directions.
							</span>
						</span>
					</a>
				) : null}

				{mail ? (
					<a
						href={mail}
						className="group flex items-start gap-4 border border-line bg-surface p-6 transition-colors hover:bg-brand-tint"
					>
						<Mail aria-hidden="true" className="mt-1 size-5 text-brand-ink" />
						<span>
							<span className="eyebrow">Email</span>
							<span className="mt-2 block font-display text-2xl font-semibold">
								{identity.contactEmail}
							</span>
							<span className="mt-1 block text-sm text-muted-ink">
								For trade accounts, documents and general enquiries.
							</span>
						</span>
					</a>
				) : null}

				<Link
					to="/branches"
					className="group flex items-start gap-4 border border-line bg-surface p-6 transition-colors hover:bg-brand-tint"
				>
					<MapPin aria-hidden="true" className="mt-1 size-5 text-brand-ink" />
					<span>
						<span className="eyebrow">Visit</span>
						<span className="mt-2 block font-display text-2xl font-semibold">Find a branch</span>
						<span className="mt-1 block text-sm text-muted-ink">
							Address, hours and directions for every counter.
						</span>
					</span>
				</Link>
			</div>

			{!call && !message && !mail ? (
				<div className="mt-6 border border-dashed border-line-strong p-6 text-sm text-muted-ink">
					The counter's contact details are being updated. Use a branch below for directions.
				</div>
			) : null}

			{site.branches.length > 0 ? (
				<div className="mt-14 border-t border-line pt-8">
					<h2 className="font-display text-xl font-semibold">Branches</h2>
					<ul className="mt-5 grid gap-3 md:grid-cols-2">
						{site.branches.map((branch) => {
							const branchCall = telHref(branch.phone ?? phone)
							const map = mapsHref(branch)
							return (
								<li
									key={branch.code}
									className="flex flex-wrap items-center justify-between gap-3 border border-line p-4"
								>
									<div>
										<p className="text-sm font-semibold text-ink">{branch.name}</p>
										<p className="text-xs text-muted-ink">
											{[branch.address, branch.area, branch.city].filter(Boolean).join(", ")}
										</p>
									</div>
									<div className="flex gap-3">
										{branchCall ? (
											<a
												href={branchCall}
												className="text-xs font-semibold text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
											>
												Call
											</a>
										) : null}
										{map ? (
											<a
												href={map}
												target="_blank"
												rel="noreferrer"
												className="text-xs font-semibold text-ink underline decoration-brand-ink underline-offset-4 hover:decoration-2"
											>
												Directions
											</a>
										) : null}
									</div>
								</li>
							)
						})}
					</ul>
				</div>
			) : null}

			<div className="mt-10 flex flex-wrap gap-3">
				<Link to="/parts" className={buttonSecondary}>
					Browse the parts index
				</Link>
				<Link to="/shop" className={buttonSecondary}>
					About the online shop
				</Link>
			</div>
		</section>
	)
}
