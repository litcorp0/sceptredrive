import { useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "#/components/ui/button"

/** Seconds between automatic retries, and how many the page makes on its own. */
const RETRY_SECONDS = 8
const AUTO_RETRIES = 4

/**
 * Shown when the API could not be reached while checking the session.
 *
 * Deliberately not a login screen: the cookie is still valid, so asking for a password would be
 * wrong and, on a cold API, impossible anyway.
 *
 * The page retries itself. The API runs on Render, whose free instances take about a minute to
 * wake (P20-D16); a dead end with a button asked a signed-in user to solve that for us. Four
 * automatic attempts over ~32 seconds cover most wake-ups, and the button stays for the rest.
 */
export function SessionUnavailablePage({ reset }: { reset?: () => void }) {
	const router = useRouter()
	const [seconds, setSeconds] = useState(RETRY_SECONDS)
	const [attempts, setAttempts] = useState(0)

	function retry() {
		setSeconds(RETRY_SECONDS)
		setAttempts((current) => current + 1)
		if (reset) reset()
		else void router.invalidate()
	}

	useEffect(() => {
		if (attempts >= AUTO_RETRIES) return
		const timer = setTimeout(() => {
			if (seconds <= 1) {
				retry()
				return
			}
			setSeconds((current) => current - 1)
		}, 1_000)
		return () => clearTimeout(timer)
		// `retry` is stable enough for a countdown; the effect is keyed by the clock only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seconds, attempts])

	const retrying = attempts < AUTO_RETRIES

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-lg font-semibold">Waking the server</h1>
			<p className="text-sm text-muted-foreground">
				Your session could not be checked because the API has not answered yet. You are still signed
				in — this is the server starting up, not a logout.
			</p>
			<output className="text-xs text-muted-foreground">
				{retrying
					? `Trying again in ${seconds}s. A cold API can take up to a minute.`
					: "The server is taking longer than usual. Try again in a moment."}
			</output>
			<Button type="button" onClick={retry}>
				Try now
			</Button>
		</main>
	)
}
