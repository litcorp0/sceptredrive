import { formatBasisPoints } from "@sceptre/shared"
import { cn } from "cn"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"

interface DeltaBadgeProps {
	deltaBp: number | null
	/** What is compared, for screen readers: "revenue", "sales". */
	subject: string
	className?: string
}

/**
 * A period-over-period change.
 *
 * Direction is carried by a glyph and an explicit sign, not by colour alone (WCAG 1.4.1);
 * colour only reinforces it. `null` means "there is no previous period", which is not the
 * same statement as "no change", so it renders a dash with an explanation.
 */
export function DeltaBadge({ deltaBp, subject, className }: DeltaBadgeProps) {
	if (deltaBp === null) {
		return (
			<span
				className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
				title={`No comparable ${subject} in the previous period`}
			>
				<Minus aria-hidden="true" className="size-3" />—
				<span className="sr-only">no previous {subject} to compare</span>
			</span>
		)
	}

	const positive = deltaBp > 0
	const negative = deltaBp < 0
	const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 text-xs font-medium tabular-nums",
				positive && "text-ok",
				negative && "text-danger",
				!positive && !negative && "text-muted-foreground",
				className,
			)}
		>
			<Icon aria-hidden="true" className="size-3" />
			{formatBasisPoints(deltaBp)}
			<span className="sr-only"> {subject} compared with the previous period</span>
		</span>
	)
}
