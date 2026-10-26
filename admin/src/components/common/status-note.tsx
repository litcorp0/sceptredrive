import { cn } from "cn"
import type { ReactNode } from "react"

export type StatusNoteTone = "info" | "ok" | "warn" | "danger"

const TONES: Record<StatusNoteTone, { container: string; dot: string }> = {
	info: { container: "border-info/30 bg-info/10", dot: "bg-info" },
	ok: { container: "border-ok/30 bg-ok/10", dot: "bg-ok" },
	warn: { container: "border-warn/30 bg-warn/10", dot: "bg-warn" },
	danger: { container: "border-danger/30 bg-danger/10", dot: "bg-danger" },
}

/**
 * One notice or error bar for the console.
 *
 * State is carried by the dot and the words, never by colour alone (WCAG 2.2 SC 1.4.1). The
 * live-region role follows the tone: a `danger` note is an alert, everything else is a status.
 * `title` is optional because most notes are a sentence; a `children` link stays in reading
 * order after it.
 */
export function StatusNote({
	tone = "info",
	title,
	children,
	className,
}: {
	tone?: StatusNoteTone
	title?: string
	children: ReactNode
	className?: string
}) {
	const styles = TONES[tone]
	return (
		<div
			role={tone === "danger" ? "alert" : "status"}
			className={cn(
				"flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-foreground",
				styles.container,
				className,
			)}
		>
			<span
				aria-hidden="true"
				className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", styles.dot)}
			/>
			<div className="min-w-0">
				{title ? <p className="font-medium">{title}</p> : null}
				<div className={cn(title ? "mt-0.5 text-muted-foreground" : undefined)}>{children}</div>
			</div>
		</div>
	)
}
