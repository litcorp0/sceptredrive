import * as React from "react"

/**
 * The console switches to the primitive's mobile Sheet below `lg` (1024 px).
 *
 * The shell's previous hand-rolled sidebar broke at `lg`, and the sidebar
 * primitive defaults to 768 px. Raising the breakpoint to 1024 keeps the nav
 * as a Sheet on tablets in portrait while collapsed icons still appear at `lg`
 * and above, so the two behaviours never both apply at the same width.
 */
export const MOBILE_BREAKPOINT = 1024

export function useIsMobile() {
	const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

	React.useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
		const onChange = () => {
			setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
		}
		mql.addEventListener("change", onChange)
		setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
		return () => mql.removeEventListener("change", onChange)
	}, [])

	return !!isMobile
}
