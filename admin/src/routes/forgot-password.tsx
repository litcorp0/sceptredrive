import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthShell, FormError } from "#/components/auth/auth-shell"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { authClient } from "#/lib/auth-client"

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
	const [email, setEmail] = useState("")
	const [submitted, setSubmitted] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)
		setSubmitting(true)
		try {
			const { error: requestError } = await authClient.requestPasswordReset({
				email,
				redirectTo: `${window.location.origin}/reset-password`,
			})

			if (requestError?.status === 429) {
				setError("Please wait a moment before requesting another link.")
				return
			}

			// Always show the same confirmation; never reveal whether the email exists.
			setSubmitted(true)
		} catch {
			setError("Unable to send the reset email right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	if (submitted) {
		return (
			<AuthShell
				title="Check your inbox"
				description="If that email is registered, we've sent a link to reset the password. The link expires in one hour."
				footer={
					<Link to="/login" className="text-muted-foreground underline-offset-4 hover:underline">
						Back to sign in
					</Link>
				}
			>
				<p className="text-sm text-muted-foreground">
					Didn't receive anything? Check the address and request another link, or ask an
					administrator to reset your password.
				</p>
			</AuthShell>
		)
	}

	return (
		<AuthShell
			title="Reset your password"
			description="Enter your staff email and we'll send you a reset link."
			footer={
				<Link to="/login" className="text-muted-foreground underline-offset-4 hover:underline">
					Back to sign in
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

				<Button type="submit" disabled={submitting}>
					{submitting ? "Sending…" : "Send reset link"}
				</Button>
			</form>
		</AuthShell>
	)
}
