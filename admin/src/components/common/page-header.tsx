import type { ReactNode } from "react"

interface PageHeaderProps {
	title: string
	description?: string
	actions?: ReactNode
	/** Small label above the title, e.g. the section name. */
	eyebrow?: string
}

/**
 * The one page heading in the console. Title, description and actions are the
 * original props, so no caller changes; `eyebrow` is additive.
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
	return (
		<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0">
				{eyebrow ? (
					<p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
						{eyebrow}
					</p>
				) : null}
				<h1 className="font-display text-2xl tracking-[-0.015em]">{title}</h1>
				{description ? (
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
				) : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</div>
	)
}
