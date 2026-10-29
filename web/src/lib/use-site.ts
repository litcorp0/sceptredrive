import type { SiteContent } from "@sceptre/shared"
import { getRouteApi } from "@tanstack/react-router"

const rootRoute = getRouteApi("__root__")

/**
 * The content the root loader resolved. Every page and the chrome read the same
 * object, so the header's site name and a page's copy can never disagree.
 */
export function useSiteContent(): SiteContent {
	return rootRoute.useLoaderData()
}
