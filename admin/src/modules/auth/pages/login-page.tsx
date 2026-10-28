import { getRouteApi, Link, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { authClient } from "#/lib/auth-client"
import { AuthShell, FormError } from "../components/auth-shell"

const routeApi = getRouteApi("/login")

export function LoginPage() {
	const navigate = routeApi.useNavigate()
	const router = useRouter()
	const { redirect: redirectTo } = routeApi.useSearch()

	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)
		setSubmitting(true)
		try {
			const { error: signInError } = await authClient.signIn.email({ email, password })

			if (signInError) {
				setError(
					signInError.status === 429
						? "Too many attempts. Please wait a moment and try again."
						: "Invalid email or password.",
				)
				return
			}

			await router.invalidate()
			if (redirectTo) {
				router.history.push(redirectTo)
			} else {
				await navigate({ to: "/" })
			}
		} catch {
			setError("Unable to sign in right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<AuthShell
			title="Sign in"
			description="Use your Sceptre Drive staff account to continue."
			footer={
				<Link
					to="/forgot-password"
					className="text-muted-foreground underline-offset-4 hover:underline"
				>
					Forgot your password?
				</Link>
			}
		>
			<form method="post" onSubmit={handleSubmit} className="grid gap-4">
				<FormError message={error} />

				<div className="grid gap-1.5">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						autoComplete="username"
						required
						autoFocus
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</div>

				<Button type="submit" disabled={submitting}>
					{submitting ? "Signing in…" : "Sign in"}
				</Button>
			</form>
		</AuthShell>
	)
}
