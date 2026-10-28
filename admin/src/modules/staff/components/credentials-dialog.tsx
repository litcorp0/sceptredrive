import { CopyButton } from "#/components/common/copy-button"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"

export interface Credentials {
	title: string
	email: string
	staffId?: string | null
	password?: string | null
	pin?: string | null
	invitationSent: boolean
}

function CredentialRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<div className="rounded-md border bg-muted/40 px-3 py-2">
				<p className="font-mono text-sm break-all">{value}</p>
			</div>
			<CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
		</div>
	)
}

/**
 * The one-time surface for generated credentials. It is shown once and never stored; the
 * "Copy" buttons are the only way they leave the screen. A password reset shows only the
 * password; a PIN reset shows only the PIN; account creation shows both.
 */
export function CredentialsDialog({
	credentials,
	onClose,
}: {
	credentials: Credentials
	onClose: () => void
}) {
	const changes = [
		credentials.password ? "temporary password" : null,
		credentials.pin ? "temporary PIN" : null,
	].filter(Boolean)

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{credentials.title}</DialogTitle>
					<DialogDescription>
						Share these credentials with {credentials.email}. They are shown only once
						{credentials.invitationSent ? " and were emailed" : ""}.
						{changes.length > 0
							? ` The recipient must change the ${changes.join(" and ")} at first use.`
							: ""}
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-3">
					{credentials.staffId ? (
						<CredentialRow label="Staff ID" value={credentials.staffId} />
					) : null}
					{credentials.password ? (
						<CredentialRow label="Temporary password" value={credentials.password} />
					) : null}
					{credentials.pin ? <CredentialRow label="Temporary PIN" value={credentials.pin} /> : null}
				</div>

				<div className="flex justify-end">
					<Button type="button" onClick={onClose}>
						Done
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
