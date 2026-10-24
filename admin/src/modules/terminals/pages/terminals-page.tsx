import { formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { KeyRoundIcon, MonitorSmartphoneIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge } from "#/components/common/status-badge"
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
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { terminalListOptions } from "../api/terminals"
import { DevicesDialog } from "../components/devices-dialog"
import { EnrollmentDialog } from "../components/enrollment-dialog"
import { TerminalFormDialog } from "../components/terminal-form-dialog"
import type { Terminal } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

export function TerminalsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, branches } = useBranch()
	const canCreate = hasPermission(session.user.role, "terminal.create")
	const canRevoke = hasPermission(session.user.role, "device.revoke")

	const [createOpen, setCreateOpen] = useState(false)
	const [enrollTerminal, setEnrollTerminal] = useState<Terminal | null>(null)
	const [devicesTerminal, setDevicesTerminal] = useState<Terminal | null>(null)

	const terminalsQuery = useQuery(
		terminalListOptions({
			branchId: activeBranchId ?? undefined,
			includeInactive: true,
		}),
	)

	const terminals = terminalsQuery.data?.terminals ?? []
	const branchCode = (branchId: string) =>
		branches.find((branch) => branch.id === branchId)?.code ?? "—"

	return (
		<div>
			<PageHeader
				title="Terminals"
				description="POS terminals per branch. Enrollment codes connect the desktop app."
				actions={
					canCreate ? (
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<PlusIcon className="size-4" />
							New terminal
						</Button>
					) : undefined
				}
			/>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-32">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-28">Branch</TableHead>
							<TableHead className="w-24">Status</TableHead>
							<TableHead className="w-40">Last seen</TableHead>
							<TableHead className="w-64" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{terminalsQuery.isLoading ? (
							<TableMessage colSpan={6}>Loading terminals…</TableMessage>
						) : terminalsQuery.isError ? (
							<TableMessage colSpan={6} tone="error">
								Couldn't load terminals.
							</TableMessage>
						) : terminals.length === 0 ? (
							<TableMessage colSpan={6}>
								No terminals yet. Create one, then generate an enrollment code for the POS.
							</TableMessage>
						) : (
							terminals.map((terminal) => (
								<TableRow key={terminal.id}>
									<TableCell className="font-mono text-xs">{terminal.code}</TableCell>
									<TableCell className="font-medium">{terminal.name}</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{branchCode(terminal.branchId)}
									</TableCell>
									<TableCell>
										<ActiveBadge active={terminal.isActive} />
									</TableCell>
									<TableCell className="text-muted-foreground">
										{terminal.lastSeenAt ? formatDateTime(terminal.lastSeenAt) : "Never"}
									</TableCell>
									<TableCell className="text-right">
										<Button variant="outline" size="sm" onClick={() => setEnrollTerminal(terminal)}>
											<KeyRoundIcon className="size-3.5" />
											Enrollment
										</Button>{" "}
										<Button
											variant="outline"
											size="sm"
											onClick={() => setDevicesTerminal(terminal)}
										>
											<MonitorSmartphoneIcon className="size-3.5" />
											Devices
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{canCreate ? (
				<TerminalFormDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					defaultBranchId={activeBranchId}
				/>
			) : null}

			{enrollTerminal ? (
				<EnrollmentDialog terminal={enrollTerminal} onClose={() => setEnrollTerminal(null)} />
			) : null}

			{devicesTerminal ? (
				<DevicesDialog
					terminal={devicesTerminal}
					canRevoke={canRevoke}
					onClose={() => setDevicesTerminal(null)}
				/>
			) : null}
		</div>
	)
}
