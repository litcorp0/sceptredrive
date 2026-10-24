import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty"

/**
 * The console's "nothing here yet" state: one icon, one sentence about what is
 * missing, and at most one primary action. The card border comes from the
 * surrounding `Card`, never from this component.
 */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: LucideIcon
	title: string
	description: string
	action?: ReactNode
}) {
	return (
		<Empty className="border-0 bg-transparent py-10">
			<EmptyMedia variant="icon">
				<Icon aria-hidden="true" />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{action ? <EmptyContent>{action}</EmptyContent> : null}
		</Empty>
	)
}
