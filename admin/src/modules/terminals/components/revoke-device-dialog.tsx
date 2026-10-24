import { ConfirmDialog } from "#/components/common/confirm-dialog"

/**
 * Revoking a device ends that device's access only; the terminal itself stays active and can
 * enroll a new device with a fresh one-time code.
 */
export function RevokeDeviceDialog({
	open,
	onOpenChange,
	pending,
	onConfirm,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	pending: boolean
	onConfirm: () => void
}) {
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Revoke this device?"
			description="The POS terminal loses access immediately and must enroll again with a new code."
			confirmLabel="Revoke"
			destructive
			pending={pending}
			onConfirm={onConfirm}
		/>
	)
}
