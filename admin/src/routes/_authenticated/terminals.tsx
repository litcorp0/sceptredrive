import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { KeyRoundIcon, MonitorSmartphoneIcon, PlusIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { CopyButton } from "#/components/common/copy-button"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { Enrollment, Terminal } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/terminals")({
	component: TerminalsPage,
})

function TerminalsPage() {
	const { session } = Route.useRouteContext()
	const { activeBranchId, branches } = useBranch()
	const canCreate = hasPermission(session.user.role, "terminal.create")

	const [createOpen, setCreateOpen] = useState(false)
	const [enrollTerminal, setEnrollTerminal] = useState<Terminal | null>(null)
	const [devicesTerminal, setDevicesTerminal] = useState<Terminal | null>(null)

	const terminalsQuery = useQuery({
		queryKey: ["terminals", { branchId: activeBranchId ?? undefined, includeInactive: true }],
		queryFn: () =>
			api.terminals.list({
				branchId: activeBranchId ?? undefined,
				includeInactive: true,
			}),
	})

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
										{terminal.lastSeenAt ? new Date(terminal.lastSeenAt).toLocaleString() : "Never"}
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
				<CreateTerminalDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					defaultBranchId={activeBranchId}
				/>
			) : null}

			{enrollTerminal ? (
				<EnrollmentDialog terminal={enrollTerminal} onClose={() => setEnrollTerminal(null)} />
			) : null}

			{devicesTerminal ? (
				<DevicesDialog terminal={devicesTerminal} onClose={() => setDevicesTerminal(null)} />
			) : null}
		</div>
	)
}

function CreateTerminalDialog({
	open,
	onOpenChange,
	defaultBranchId,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	defaultBranchId: string | null
}) {
	const queryClient = useQueryClient()
	const { branches, canSelectBranch } = useBranch()

	const [name, setName] = useState("")
	const [branchId, setBranchId] = useState(defaultBranchId ?? "")

	useEffect(() => {
		if (open) setBranchId(defaultBranchId ?? branches[0]?.id ?? "")
	}, [open, defaultBranchId, branches])

	const createMutation = useMutation({
		mutationFn: () => api.terminals.create({ branchId, name }),
		onSuccess: async (data) => {
			toast.success(`Terminal ${data.terminal.code} created`, {
				description: "Generate an enrollment code when the POS is ready to connect.",
			})
			await queryClient.invalidateQueries({ queryKey: ["terminals"] })
			onOpenChange(false)
			setName("")
		},
		onError: (error) => toastApiError(error),
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		createMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>New terminal</DialogTitle>
					<DialogDescription>
						The terminal code is allocated automatically from the branch code.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{canSelectBranch ? (
						<div className="grid gap-1.5">
							<Label htmlFor="terminal-branch">Branch</Label>
							<Select value={branchId} onValueChange={setBranchId}>
								<SelectTrigger id="terminal-branch" className="w-full">
									<SelectValue placeholder="Select a branch" />
								</SelectTrigger>
								<SelectContent>
									{branches
										.filter((branch) => branch.isActive)
										.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.code} · {branch.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="terminal-name">Name</Label>
						<Input
							id="terminal-name"
							required
							minLength={2}
							placeholder="Front counter"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending || !branchId}>
							{createMutation.isPending ? "Creating…" : "Create terminal"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function EnrollmentDialog({ terminal, onClose }: { terminal: Terminal; onClose: () => void }) {
	const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!enrollment) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [enrollment])

	const createMutation = useMutation({
		mutationFn: () => api.terminals.createEnrollment(terminal.id),
		onSuccess: (data) => {
			setEnrollment(data.enrollment)
			setNow(Date.now())
		},
		onError: (error) => toastApiError(error),
	})

	const remainingMs = enrollment ? new Date(enrollment.expiresAt).getTime() - now : 0
	const minutes = Math.max(0, Math.floor(remainingMs / 60_000))
	const seconds = Math.max(0, Math.floor((remainingMs % 60_000) / 1000))
	const expired = enrollment !== null && remainingMs <= 0

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Enrollment code</DialogTitle>
					<DialogDescription>
						{terminal.code} · {terminal.name}
					</DialogDescription>
				</DialogHeader>

				{enrollment ? (
					<div className="grid gap-4">
						<div className="rounded-lg border bg-muted/40 p-4 text-center">
							<p className="font-mono text-2xl font-semibold tracking-[0.2em]">{enrollment.code}</p>
							<p className="mt-2 text-xs text-muted-foreground">
								{expired
									? "Expired — generate a new code."
									: `Expires in ${minutes}:${String(seconds).padStart(2, "0")}`}
							</p>
						</div>
						<CopyButton value={enrollment.code} label="Copy code" />
						<p className="text-xs text-muted-foreground">
							Enter this code in the POS app to enroll this terminal. Generating a new code expires
							the previous one; each code works once.
						</p>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Generate a one-time code, then enter it in the POS app on this terminal. The code
						expires after 15 minutes.
					</p>
				)}

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button
						type="button"
						disabled={createMutation.isPending}
						onClick={() => createMutation.mutate()}
					>
						{createMutation.isPending
							? "Generating…"
							: enrollment
								? "Generate new code"
								: "Generate code"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function DevicesDialog({ terminal, onClose }: { terminal: Terminal; onClose: () => void }) {
	const queryClient = useQueryClient()
	const { session } = Route.useRouteContext()
	const canRevoke = hasPermission(session.user.role, "device.revoke")
	const [revokeId, setRevokeId] = useState<string | null>(null)

	const devicesQuery = useQuery({
		queryKey: ["terminals", terminal.id, "devices"],
		queryFn: () => api.terminals.devices(terminal.id),
	})

	const revokeMutation = useMutation({
		mutationFn: (deviceId: string) => api.terminals.revokeDevice(deviceId),
		onSuccess: async () => {
			toast.success("Device revoked")
			setRevokeId(null)
			await queryClient.invalidateQueries({ queryKey: ["terminals", terminal.id, "devices"] })
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
							{devicesQuery.isLoading ? (
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
											{new Date(device.enrolledAt).toLocaleString()}
										</TableCell>
										<TableCell className="text-right">
											{canRevoke && device.status === "ACTIVE" ? (
												<Button
													variant="ghost"
													size="sm"
													className="text-destructive"
													onClick={() => setRevokeId(device.id)}
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

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>

			<ConfirmDialog
				open={revokeId !== null}
				onOpenChange={(open) => !open && setRevokeId(null)}
				title="Revoke this device?"
				description="The POS terminal loses access immediately and must enroll again with a new code."
				confirmLabel="Revoke"
				destructive
				pending={revokeMutation.isPending}
				onConfirm={() => {
					if (revokeId) revokeMutation.mutate(revokeId)
				}}
			/>
		</Dialog>
	)
}
