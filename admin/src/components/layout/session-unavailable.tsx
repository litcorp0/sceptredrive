import { useRouter } from "@tanstack/react-router"
import { Button } from "#/components/ui/button"

/**
 * Shown when the API could not be reached while checking the session.
 *
 * Deliberately not a login screen: the cookie is still valid, so asking for a password would be
 * wrong and, on a cold API, impossible anyway. "Try again" re-runs the guard.
 */
export function SessionUnavailablePage({ reset }: { reset?: () => void }) {
	const router = useRouter()

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-lg font-semibold">Cannot reach the server</h1>
			<p className="text-sm text-muted-foreground">
				Your session could not be checked, so this page did not load. You are still signed in — this
				is the API being unreachable, not a logout.
			</p>
			<p className="text-xs text-muted-foreground">
				A cold or restarting API can take up to a minute to answer.
			</p>
			<Button
				type="button"
				onClick={() => {
					if (reset) reset()
					else void router.invalidate()
				}}
			>
				Try again
			</Button>
		</main>
	)
}
