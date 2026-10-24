import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { toastApiError } from "#/lib/toast"
import { terminalKeys } from "../api/keys"
import { revokeDevice, terminalDevicesOptions } from "../api/terminals"
import type { Terminal } from "../types"
import { DeviceTable } from "./device-table"
import { RevokeDeviceDialog } from "./revoke-device-dialog"

export function DevicesDialog({
	terminal,
	canRevoke,
	onClose,
}: {
	terminal: Terminal
	canRevoke: boolean
	onClose: () => void
}) {
	const queryClient = useQueryClient()
	const [revokeId, setRevokeId] = useState<string | null>(null)

	const devicesQuery = useQuery(terminalDevicesOptions(terminal.id))

	const revokeMutation = useMutation({
		mutationFn: (deviceId: string) => revokeDevice(deviceId),
		onSuccess: async () => {
			toast.success("Device revoked")
			setRevokeId(null)
			await queryClient.invalidateQueries({
				queryKey: terminalKeys.devices(terminal.id),
			})
		},
		onError: (error) => {
			setRevokeId(null)
			toastApiError(error)
		},
	})

	const devices = devicesQuery.data?.devices ?? []

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Devices</DialogTitle>
					<DialogDescription>
						{terminal.code} · {terminal.name}
					</DialogDescription>
				</DialogHeader>

				<DeviceTable
					devices={devices}
					isLoading={devicesQuery.isLoading}
					canRevoke={canRevoke}
					onRevoke={setRevokeId}
				/>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>

			<RevokeDeviceDialog
				open={revokeId !== null}
				onOpenChange={(open) => !open && setRevokeId(null)}
				pending={revokeMutation.isPending}
				onConfirm={() => {
					if (revokeId) revokeMutation.mutate(revokeId)
				}}
			/>
		</Dialog>
	)
}
