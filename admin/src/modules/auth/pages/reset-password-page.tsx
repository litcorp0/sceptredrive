import { getRouteApi, Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { authClient } from "#/lib/auth-client"
import { AuthShell, FormError } from "../components/auth-shell"

const routeApi = getRouteApi("/reset-password")

export function ResetPasswordPage() {
	const { token } = routeApi.useSearch()

	const [password, setPassword] = useState("")
	const [confirm, setConfirm] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [done, setDone] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)

		if (!token) {
			setError("This reset link is invalid or has expired.")
			return
		}
		if (password.length < 12) {
			setError("Your new password must be at least 12 characters.")
			return
		}
		if (password !== confirm) {
			setError("The passwords do not match.")
			return
		}

		setSubmitting(true)
		try {
			const { error: resetError } = await authClient.resetPassword({
				newPassword: password,
				token,
			})

			if (resetError) {
				setError("This reset link is invalid or has expired.")
				return
			}

			setDone(true)
		} catch {
			setError("Unable to reset the password right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	if (done) {
		return (
			<AuthShell
				title="Password updated"
				description="Your password has been changed. Sign in with your new password to continue."
				footer={
					<Link to="/login" className="text-muted-foreground underline-offset-4 hover:underline">
						Sign in
					</Link>
				}
			>
				<Button asChild className="w-full">
					<Link to="/login">Go to sign in</Link>
				</Button>
			</AuthShell>
		)
	}

	return (
		<AuthShell
			title="Choose a new password"
			description="Your new password must be at least 12 characters."
			footer={
				<Link
					to="/forgot-password"
					className="text-muted-foreground underline-offset-4 hover:underline"
				>
					Request a new link
				</Link>
			}
		>
			<form method="post" onSubmit={handleSubmit} className="grid gap-4">
				<FormError message={error} />

				<div className="grid gap-1.5">
					<Label htmlFor="new-password">New password</Label>
					<Input
						id="new-password"
						name="new-password"
						type="password"
						autoComplete="new-password"
						required
						minLength={12}
						autoFocus
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="confirm-password">Confirm new password</Label>
					<Input
						id="confirm-password"
						name="confirm-password"
						type="password"
						autoComplete="new-password"
						required
						minLength={12}
						value={confirm}
						onChange={(event) => setConfirm(event.target.value)}
					/>
				</div>

				<Button type="submit" disabled={submitting || !token}>
					{submitting ? "Saving…" : "Set new password"}
				</Button>
			</form>
		</AuthShell>
	)
}
