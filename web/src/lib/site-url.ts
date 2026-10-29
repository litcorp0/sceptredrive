/**
 * Canonical origin for metadata and the sitemap. It is a build-time value
 * because the sitemap's URLs must be absolute; when the real domain exists,
 * set VITE_SITE_URL in the deployment environment and nothing else changes.
 */
export function siteUrl(): string {
	const configured = import.meta.env.VITE_SITE_URL as string | undefined
	return (configured ?? "http://localhost:3004").replace(/\/+$/, "")
}

export function absoluteUrl(path: string): string {
	return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`
}
