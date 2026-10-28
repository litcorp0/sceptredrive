import { Link } from "@tanstack/react-router"
import { CompassIcon } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { Button } from "#/components/ui/button"

/**
 * The console's 404. Mounted by the root route as `notFoundComponent`, so an
 * unknown path or a `notFound()` thrown by a loader gets this page instead of
 * TanStack Router's bare `<p>Not Found</p>`.
 */
export function NotFoundPage() {
	return (
		<main className="flex min-h-svh items-center justify-center bg-canvas px-6 py-12">
			<div className="w-full max-w-md rounded-lg border bg-card p-2">
				<EmptyState
					icon={CompassIcon}
					title="Page not found"
					description="The page you asked for does not exist, or it moved. Check the address or return to the dashboard."
					action={
						<Button asChild>
							<Link to="/">Back to dashboard</Link>
						</Button>
					}
				/>
				<p className="pb-4 text-center font-mono text-xs text-muted-foreground">404</p>
			</div>
		</main>
	)
}
