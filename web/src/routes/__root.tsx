import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { NotFoundPage } from "#/components/not-found"
import { SiteFooter } from "#/components/site-footer"
import { SiteHeader } from "#/components/site-header"
import { serializeJsonLd, siteJsonLd } from "#/lib/json-ld"
import { getSiteContent } from "#/lib/site.functions"
import { absoluteUrl } from "#/lib/site-url"
import { useSiteContent } from "#/lib/use-site"
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools"
import appCss from "../styles.css?url"

interface MyRouterContext {
	queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	// The content is resolved once on the server and shared by the chrome and
	// every page. `getSiteContent` never throws: an API outage returns the
	// bundled fallback, so the shell always renders.
	loader: () => getSiteContent(),
	head: ({ loaderData }) => {
		const name = loaderData?.site.name ?? "Sceptre Drive"
		const description =
			loaderData?.site.tagline ?? "Genuine and aftermarket automotive spare parts across Ghana."

		return {
			meta: [
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				{ title: `${name} — auto spare parts in Ghana` },
				{ name: "description", content: description },
				{ property: "og:site_name", content: name },
				{ property: "og:title", content: `${name} — auto spare parts in Ghana` },
				{ property: "og:description", content: description },
				{ property: "og:type", content: "website" },
				{ property: "og:image", content: absoluteUrl("/og.png") },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:image", content: absoluteUrl("/og.png") },
			],
			links: [
				{ rel: "stylesheet", href: appCss },
				{ rel: "icon", type: "image/png", href: "/logo-icon.png" },
				{ rel: "apple-touch-icon", href: "/logo-icon.png" },
			],
		}
	},
	shellComponent: RootDocument,
	component: SiteLayout,
	notFoundComponent: NotFoundPage,
})

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
							TanStackQueryDevtools,
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	)
}

function SiteLayout() {
	const site = useSiteContent()

	return (
		<>
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-canvas"
			>
				Skip to content
			</a>
			<SiteHeader site={site.site} />
			<main id="main" tabIndex={-1}>
				<Outlet />
			</main>
			<SiteFooter site={site} />
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd(site)) }}
			/>
		</>
	)
}
