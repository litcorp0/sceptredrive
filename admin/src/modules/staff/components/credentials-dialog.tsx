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
	password: string
	invitationSent: boolean
}

/**
 * The one-time surface for a generated temporary password. It is shown once and never stored;
 * the "Copy" button is the only way it leaves the screen.
 */
export function CredentialsDialog({
	credentials,
	onClose,
}: {
	credentials: Credentials
	onClose: () => void
}) {
	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{credentials.title}</DialogTitle>
					<DialogDescription>
						Share the temporary password with {credentials.email}. It is shown only once
						{credentials.invitationSent ? " and was emailed to them" : ""}. They must change it at
						first sign-in.
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-lg border bg-muted/40 p-4">
					<p className="font-mono text-sm break-all">{credentials.password}</p>
				</div>

				<div className="flex items-center justify-between">
					<CopyButton value={credentials.password} label="Copy password" />
					<Button type="button" onClick={onClose}>
						Done
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
