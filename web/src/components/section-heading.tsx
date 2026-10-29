export function SectionHeading({
	eyebrow,
	title,
	description,
	level = 2,
}: {
	eyebrow: string
	title: string
	description?: string
	/** A page's top heading is an `h1`; a section inside a page is an `h2`. */
	level?: 1 | 2
}) {
	const Heading = level === 1 ? "h1" : "h2"

	return (
		<div className="max-w-2xl">
			<p className="eyebrow eyebrow-brand">{eyebrow}</p>
			<Heading className="mt-3 font-display text-3xl leading-[1.05] font-semibold tracking-[-0.02em] text-balance md:text-4xl">
				{title}
			</Heading>
			{description ? (
				<p className="mt-4 text-base text-muted-ink md:text-lg">{description}</p>
			) : null}
		</div>
	)
}
