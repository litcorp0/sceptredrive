import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { getContext } from "./integrations/tanstack-query/root-provider"
import { routeTree } from "./routeTree.gen"

/** Readable search params (?setup=1) instead of the default JSON-encoded form. */
function stringifySearch(search: Record<string, unknown>): string {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(search)) {
		if (value === undefined || value === null || value === "") continue
		params.set(key, String(value))
	}
	const query = params.toString()
	return query ? `?${query}` : ""
}

function parseSearch(searchStr: string): Record<string, unknown> {
	const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr)
	const search: Record<string, unknown> = {}
	for (const [key, value] of params.entries()) search[key] = value
	return search
}

export function getRouter() {
	const context = getContext()

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		parseSearch,
		stringifySearch,
	})

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

	return router
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
