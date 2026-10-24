import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthShell, FormError } from "#/components/auth/auth-shell"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { authClient } from "#/lib/auth-client"
import { getAuthPolicy } from "#/lib/auth-policy"
import { getSession } from "#/lib/session.functions"

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async () => {
		const session = await getSession()
		if (!session) return

		if (session.user.mustChangePassword === true) {
			throw redirect({ to: "/change-password" })
		}
		if (session.user.role === "ADMIN" && session.user.twoFactorEnabled !== true) {
			const policy = await getAuthPolicy()
			if (policy.requireTwoFactor) {
				throw redirect({ to: "/two-factor", search: { setup: "1" } })
			}
		}
		throw redirect({ to: "/" })
	},
	component: LoginPage,
})

function LoginPage() {
	const navigate = Route.useNavigate()
	const router = useRouter()
	const { redirect: redirectTo } = Route.useSearch()

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
			const { data, error: signInError } = await authClient.signIn.email({ email, password })

			if (signInError) {
				setError(
					signInError.status === 429
						? "Too many attempts. Please wait a moment and try again."
						: "Invalid email or password.",
				)
				return
			}

			// The two-factor plugin returns { twoFactorRedirect: true, twoFactorMethods }
			// at runtime; the client's inferred response type is incomplete.
			if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true) {
				await navigate({ to: "/two-factor", search: { redirect: redirectTo } })
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
			description="Use your GikAutos staff account to continue."
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
