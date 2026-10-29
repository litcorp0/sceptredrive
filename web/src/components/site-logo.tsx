import { cn } from "#/lib/utils"

/**
 * The supplied lockup. `inverse` is the off-white wordmark for charcoal
 * surfaces; the asset is produced from the same master by
 * `bun run brand:assets`.
 */
export function SiteLogo({
	name,
	inverse = false,
	className,
}: {
	name: string
	inverse?: boolean
	className?: string
}) {
	return (
		<img
			src={inverse ? "/logo-inverse.png" : "/logo.png"}
			alt={name}
			className={cn("block w-auto", className)}
			draggable={false}
			decoding="async"
		/>
	)
}
