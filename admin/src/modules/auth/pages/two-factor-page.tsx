import { getRouteApi, Link, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import QRCode from "react-qr-code"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { authClient } from "#/lib/auth-client"
import { AuthShell, FormError } from "../components/auth-shell"

const routeApi = getRouteApi("/two-factor")

type SetupStep = "password" | "scan" | "code"

export function TwoFactorPage() {
	const { session, policy } = routeApi.useRouteContext()
	const { redirect: redirectTo } = routeApi.useSearch()
	const router = useRouter()
	const navigate = routeApi.useNavigate()

	const isSetup = session !== null

	const [step, setStep] = useState<SetupStep>(isSetup ? "password" : "code")
	const [password, setPassword] = useState("")
	const [totpUri, setTotpUri] = useState<string | null>(null)
	const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
	const [code, setCode] = useState("")
	const [useBackupCode, setUseBackupCode] = useState(false)
	const [trustDevice, setTrustDevice] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function finish() {
		await router.invalidate()
		if (redirectTo) {
			router.history.push(redirectTo)
		} else {
			await navigate({ to: "/" })
		}
	}

	async function handleEnable(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)
		setSubmitting(true)
		try {
			const { data, error: enableError } = await authClient.twoFactor.enable({ password })

			if (enableError || !data) {
				setError(
					enableError?.status === 429
						? "Too many attempts. Please wait a moment and try again."
						: "That password isn't correct. Please try again.",
				)
				return
			}

			if (data.method === "totp") {
				setTotpUri(data.totpURI)
				setBackupCodes(data.backupCodes)
			}
			setStep("scan")
		} catch {
			setError("Unable to start two-factor setup right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	function handleCodeChange(value: string) {
		if (useBackupCode) {
			// Backup codes are generated with mixed case (`a-zA-Z0-9`, 10 chars,
			// formatted xxxxx-xxxxx) and verified with an exact string match.
			// Uppercasing them made every code containing a lowercase letter fail.
			const cleaned = value.replace(/\s+/g, "")
			setCode(
				cleaned.length === 10 && !cleaned.includes("-")
					? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`
					: cleaned,
			)
			return
		}
		setCode(value.replace(/\D/g, "").slice(0, 6))
	}

	async function handleVerify(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		setError(null)
		setSubmitting(true)
		try {
			const result = useBackupCode
				? await authClient.twoFactor.verifyBackupCode({ code })
				: await authClient.twoFactor.verifyTotp({
						code,
						trustDevice: isSetup ? false : trustDevice,
					})

			if (result.error) {
				const errorCode = (result.error as { code?: string }).code
				if (errorCode === "INVALID_TWO_FACTOR_COOKIE") {
					setError("Your sign-in attempt expired. Please sign in again.")
					return
				}
				if (result.error.status === 429) {
					setError("Too many attempts. The account is temporarily locked; try again later.")
					return
				}
				setError(
					useBackupCode
						? "That backup code isn't valid. Backup codes work only once."
						: "That code isn't valid. Check your authenticator app and try again.",
				)
				return
			}

			await finish()
		} catch {
			setError("Unable to verify right now. Please try again.")
		} finally {
			setSubmitting(false)
		}
	}

	if (isSetup && step === "password") {
		return (
			<AuthShell
				title="Set up two-factor authentication"
				description="Administrator accounts require an authenticator app before you can continue."
			>
				<form method="post" onSubmit={handleEnable} className="grid gap-4">
					<FormError message={error} />

					<div className="grid gap-1.5">
						<Label htmlFor="current-password">Confirm your password</Label>
						<Input
							id="current-password"
							name="current-password"
							type="password"
							autoComplete="current-password"
							required
							autoFocus
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</div>

					<Button type="submit" disabled={submitting}>
						{submitting ? "Starting…" : "Continue"}
					</Button>
				</form>
			</AuthShell>
		)
	}

	if (isSetup && step === "scan") {
		const secret = totpUri ? new URL(totpUri).searchParams.get("secret") : null

		return (
			<AuthShell
				title="Scan this QR code"
				description="Use an authenticator app (Google Authenticator, Authy, 1Password) to scan the code."
			>
				<div className="grid gap-5">
					<div className="flex justify-center rounded-lg border bg-white p-4">
						{totpUri ? <QRCode value={totpUri} size={168} /> : null}
					</div>

					{secret ? (
						<details className="text-sm">
							<summary className="cursor-pointer text-muted-foreground">
								Can't scan? Show the manual key
							</summary>
							<p className="mt-2 break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
								{secret}
							</p>
						</details>
					) : null}

					{backupCodes && backupCodes.length > 0 ? (
						<div className="rounded-lg border p-3">
							<p className="text-sm font-medium">Backup codes</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Save these somewhere safe. Each code works once if you lose your phone.
							</p>
							<div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
								{backupCodes.map((backupCode) => (
									<span key={backupCode}>{backupCode}</span>
								))}
							</div>
							<div className="mt-3 flex gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										void navigator.clipboard.writeText(backupCodes.join("\n"))
									}}
								>
									Copy
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										const blob = new Blob(
											[`Sceptre Drive backup codes\n\n${backupCodes.join("\n")}\n`],
											{ type: "text/plain" },
										)
										const url = URL.createObjectURL(blob)
										const anchor = document.createElement("a")
										anchor.href = url
										anchor.download = "sceptre-drive-backup-codes.txt"
										anchor.click()
										URL.revokeObjectURL(url)
									}}
								>
									Download
								</Button>
							</div>
						</div>
					) : null}

					<Button type="button" onClick={() => setStep("code")}>
						I've saved my backup codes
					</Button>
				</div>
			</AuthShell>
		)
	}

	return (
		<AuthShell
			title={isSetup ? "Enter the code from your app" : "Two-factor verification"}
			description={
				useBackupCode
					? "Enter one of your saved backup codes. Codes are case-sensitive."
					: "Enter the 6-digit code from your authenticator app."
			}
			footer={
				!isSetup ? (
					<Link to="/login" className="text-muted-foreground underline-offset-4 hover:underline">
						Back to sign in
					</Link>
				) : policy.requireTwoFactor ? undefined : (
					<Link to="/" className="text-muted-foreground underline-offset-4 hover:underline">
						Not now — return to the console
					</Link>
				)
			}
		>
			<form method="post" onSubmit={handleVerify} className="grid gap-4">
				<FormError message={error} />

				<div className="grid gap-1.5">
					<Label htmlFor="code">{useBackupCode ? "Backup code" : "Verification code"}</Label>
					<Input
						id="code"
						name="code"
						inputMode={useBackupCode ? "text" : "numeric"}
						autoComplete="one-time-code"
						autoFocus
						required
						placeholder={useBackupCode ? "xxxxx-xxxxx" : "000000"}
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						value={code}
						onChange={(event) => handleCodeChange(event.target.value)}
					/>
				</div>

				{!isSetup ? (
					<label className="flex items-center gap-2 text-sm text-muted-foreground">
						<input
							type="checkbox"
							className="size-4 accent-primary"
							checked={trustDevice}
							onChange={(event) => setTrustDevice(event.target.checked)}
						/>
						Remember this device for 30 days
					</label>
				) : null}

				<Button type="submit" disabled={submitting || code.length === 0}>
					{submitting ? "Verifying…" : "Verify"}
				</Button>

				{isSetup ? (
					<p className="text-xs text-muted-foreground">
						Backup codes recover a future sign-in; enter the 6-digit code from your app to finish
						setup.
					</p>
				) : (
					<button
						type="button"
						className="text-sm text-muted-foreground underline-offset-4 hover:underline"
						onClick={() => {
							setUseBackupCode((value) => !value)
							setCode("")
							setError(null)
						}}
					>
						{useBackupCode ? "Use an authenticator code instead" : "Use a backup code instead"}
					</button>
				)}
			</form>
		</AuthShell>
	)
}
