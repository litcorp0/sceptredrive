import { Link } from "@tanstack/react-router"
import { buttonSecondary } from "#/lib/ui"

export function NotFoundPage() {
	return (
		<section className="site-container flex min-h-[60svh] flex-col justify-center py-20">
			<p className="eyebrow eyebrow-brand">404 · Not found</p>
			<h1 className="mt-3 max-w-xl font-display text-4xl leading-[1.05] font-semibold tracking-[-0.02em] md:text-5xl">
				That page is not on the shelf.
			</h1>
			<p className="mt-4 max-w-xl text-base text-muted-ink md:text-lg">
				The link may have moved. Start with the parts index, or find the nearest counter.
			</p>
			<div className="mt-8 flex flex-wrap gap-3">
				<Link to="/parts" className={buttonSecondary}>
					Browse parts
				</Link>
				<Link to="/branches" className={buttonSecondary}>
					Visit a branch
				</Link>
			</div>
		</section>
	)
}
