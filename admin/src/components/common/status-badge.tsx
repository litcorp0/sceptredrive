import { cn } from "cn"

/** Legacy tone names; mapped onto the semantic variants below. */
type Tone = "green" | "zinc" | "amber" | "red" | "blue"

export type StatusVariant = "ok" | "warn" | "danger" | "info" | "muted"

/**
 * Each variant carries a dot *and* a text label, so state is never conveyed by
 * colour alone (WCAG 2.2 SC 1.4.1). The semantic colour lives on the dot; the
 * label stays ink on the tinted background (≥13:1 measured) because every
 * semantic colour at 12 px lands under the 4.5:1 AA floor as text.
 */
const VARIANTS: Record<StatusVariant, { container: string; dot: string }> = {
	ok: { container: "border-ok/30 bg-ok/10 text-foreground", dot: "bg-ok" },
	warn: { container: "border-warn/30 bg-warn/10 text-foreground", dot: "bg-warn" },
	danger: { container: "border-danger/30 bg-danger/10 text-foreground", dot: "bg-danger" },
	info: { container: "border-info/30 bg-info/10 text-foreground", dot: "bg-info" },
	muted: {
		container: "border-border bg-muted text-muted-foreground",
		dot: "bg-muted-foreground",
	},
}

const TONE_VARIANTS: Record<Tone, StatusVariant> = {
	green: "ok",
	zinc: "muted",
	amber: "warn",
	red: "danger",
	blue: "info",
}

interface StatusBadgeProps {
	children: React.ReactNode
	/** Legacy API, kept so existing callers compile unchanged. */
	tone?: Tone
	variant?: StatusVariant
	className?: string
}

export function StatusBadge({ children, tone, variant, className }: StatusBadgeProps) {
	const resolved = variant ?? TONE_VARIANTS[tone ?? "zinc"]
	const styles = VARIANTS[resolved]

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
				styles.container,
				className,
			)}
		>
			<span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", styles.dot)} />
			{children}
		</span>
	)
}

export function ActiveBadge({ active }: { active: boolean }) {
	return (
		<StatusBadge variant={active ? "ok" : "muted"}>{active ? "Active" : "Inactive"}</StatusBadge>
	)
}

export function RoleBadge({ role }: { role: string }) {
	const variant: StatusVariant = role === "ADMIN" ? "info" : role === "MANAGER" ? "warn" : "muted"
	return <StatusBadge variant={variant}>{role}</StatusBadge>
}
