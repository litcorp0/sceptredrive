import { useEffect, useState } from "react"

/**
 * `prefers-reduced-motion` as a boolean.
 *
 * SSR-safe: the server has no `window`, so it renders the animated default and the effect
 * corrects it on mount, before the first paint completes. One implementation for every chart
 * in this module and the dashboard.
 */
export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	)
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)")
		const onChange = () => setReduced(query.matches)
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [])
	return reduced
}
