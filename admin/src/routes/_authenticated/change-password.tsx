import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { FormError } from "#/components/auth/auth-shell"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { ApiError, api } from "#/lib/api"

export const Route = createFileRoute("/_authenticated/change-password")({
	component: ChangePasswordPage,
})

function ChangePasswordPage() {
	const { session } = Route.useRouteContext()
	const router = useRouter()
	const navigate = Route.useNavigate()

	const forced = session.user.mustChangePassword === true

	const [currentPassword, setCurrentPassword] = useState("")
	const [newPassword, setNewPassword] = useState("")
	const [confirm, setConfirm] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [reauthRequired, setReauthRequired] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)
		setReauthRequired(false)

		if (newPassword.length < 12) {
			setError("Your new password must be at least 12 characters.")
			return
		}
		if (newPassword !== confirm) {
			setError("The passwords do not match.")
			return
		}
		if (newPassword === currentPassword) {
			setError("The new password must be different from the current one.")
			return
		}

		setSubmitting(true)
		try {
			await api.staff.changeOwnPassword({ currentPassword, newPassword })
			await router.invalidate()
			await navigate({ to: "/" })
		} catch (submitError) {
			if (submitError instanceof ApiError) {
				if (submitError.code === "REAUTH_REQUIRED") {
					setReauthRequired(true)
					return
				}
				if (submitError.code === "INVALID_PASSWORD") {
					setError("The current password is incorrect.")
					return
				}
				setError(submitError.message)
				return
			}
			setError("Unable to change the password right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-6">
			<div className="rounded-lg border bg-card p-6 shadow-xs">
				<h1 className="text-lg font-semibold tracking-tight">
					{forced ? "Choose a new password" : "Change your password"}
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{forced
						? "Your account was created with a temporary password. Choose a new one to continue."
						: "Your new password must be at least 12 characters."}
				</p>

				<form method="post" onSubmit={handleSubmit} className="mt-5 grid gap-4">
					<FormError message={error} />

					{reauthRequired ? (
						<div role="alert" className="rounded-md border px-3 py-2 text-sm">
							For security, please sign in again before changing your password.{" "}
							<Link to="/login" className="font-medium underline underline-offset-4">
								Sign in
							</Link>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="current-password">
							{forced ? "Temporary password" : "Current password"}
						</Label>
						<Input
							id="current-password"
							name="current-password"
							type="password"
							autoComplete="current-password"
							required
							autoFocus
							value={currentPassword}
							onChange={(event) => setCurrentPassword(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="new-password">New password</Label>
						<Input
							id="new-password"
							name="new-password"
							type="password"
							autoComplete="new-password"
							required
							minLength={12}
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
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

					<Button type="submit" disabled={submitting}>
						{submitting ? "Saving…" : "Save new password"}
					</Button>
				</form>
			</div>
		</div>
	)
}
