import type { ReactNode } from "react"

export function AuthShell({
	title,
	description,
	children,
	footer,
}: {
	title: string
	description?: string
	children: ReactNode
	footer?: ReactNode
}) {
	return (
		<div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex items-center gap-2.5">
					<div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
						GA
					</div>
					<div>
						<p className="text-sm font-semibold leading-none">Sceptre Drive</p>
						<p className="mt-1 text-xs text-muted-foreground">Admin console</p>
					</div>
				</div>

				<div className="rounded-lg border bg-card p-6 shadow-xs">
					<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
					{description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
					<div className="mt-5">{children}</div>
				</div>

				{footer ? <div className="mt-4 text-center text-sm">{footer}</div> : null}
			</div>
		</div>
	)
}

export function FormError({ message }: { message: string | null }) {
	if (!message) return null
	return (
		<p
			role="alert"
			className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
		>
			{message}
		</p>
	)
}
