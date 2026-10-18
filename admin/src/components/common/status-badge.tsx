import { cn } from "cn"

type Tone = "green" | "zinc" | "amber" | "red" | "blue"

const TONES: Record<Tone, string> = {
	green: "border-emerald-200 bg-emerald-50 text-emerald-700",
	zinc: "border-zinc-200 bg-zinc-50 text-zinc-600",
	amber: "border-amber-200 bg-amber-50 text-amber-700",
	red: "border-red-200 bg-red-50 text-red-700",
	blue: "border-blue-200 bg-blue-50 text-blue-700",
}

export function StatusBadge({
	children,
	tone = "zinc",
	className,
}: {
	children: React.ReactNode
	tone?: Tone
	className?: string
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
				TONES[tone],
				className,
			)}
		>
			{children}
		</span>
	)
}

export function ActiveBadge({ active }: { active: boolean }) {
	return (
		<StatusBadge tone={active ? "green" : "zinc"}>{active ? "Active" : "Inactive"}</StatusBadge>
	)
}

export function RoleBadge({ role }: { role: string }) {
	const tone = role === "ADMIN" ? "blue" : role === "MANAGER" ? "amber" : "zinc"
	return <StatusBadge tone={tone}>{role}</StatusBadge>
}
