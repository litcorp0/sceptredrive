import { formatDateTime } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import type { Device } from "../types"

export function DeviceTable({
	devices,
	isLoading,
	canRevoke,
	onRevoke,
}: {
	devices: Device[]
	isLoading: boolean
	canRevoke: boolean
	onRevoke: (deviceId: string) => void
}) {
	return (
		<div className="rounded-lg border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Fingerprint</TableHead>
						<TableHead className="w-24">Status</TableHead>
						<TableHead className="w-40">Enrolled</TableHead>
						<TableHead className="w-24" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading ? (
						<TableMessage colSpan={4}>Loading devices…</TableMessage>
					) : devices.length === 0 ? (
						<TableMessage colSpan={4}>
							No devices enrolled yet. The POS app enrolls from Phase 6.
						</TableMessage>
					) : (
						devices.map((device) => (
							<TableRow key={device.id}>
								<TableCell className="font-mono text-xs">
									{device.fingerprint.slice(0, 16)}…
								</TableCell>
								<TableCell>
									<StatusBadge tone={device.status === "ACTIVE" ? "green" : "zinc"}>
										{device.status === "ACTIVE" ? "Active" : "Revoked"}
									</StatusBadge>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatDateTime(device.enrolledAt)}
								</TableCell>
								<TableCell className="text-right">
									{canRevoke && device.status === "ACTIVE" ? (
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive"
											onClick={() => onRevoke(device.id)}
										>
											Revoke
										</Button>
									) : null}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	)
}
