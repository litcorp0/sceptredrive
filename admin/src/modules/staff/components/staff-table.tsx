import { MoreHorizontalIcon } from "lucide-react"
import { Pagination } from "#/components/common/pagination"
import { ActiveBadge, RoleBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import type { Staff } from "../types"
import { PinStatusBadge } from "./pin-status-badge"

interface StaffTableProps {
	staff: Staff[]
	total: number
	limit: number
	offset: number
	isLoading: boolean
	isError: boolean
	/** Rendered branch code for a member, or "Global" for an admin account. */
	branchCode: (branchId: string | null) => string
	currentUserId: string
	canUpdate: boolean
	canResetPassword: boolean
	canResetPinFor: (member: Staff) => boolean
	onOffsetChange: (offset: number) => void
	onEdit: (member: Staff) => void
	onResetPassword: (member: Staff) => void
	onSetPin: (member: Staff) => void
	onToggleActive: (member: Staff) => void
}

/**
 * The staff list. Presentational: it receives rows and callbacks and never fetches, so the page
 * stays the single owner of the query and of which actions a role may take.
 */
export function StaffTable({
	staff,
	total,
	limit,
	offset,
	isLoading,
	isError,
	branchCode,
	currentUserId,
	canUpdate,
	canResetPassword,
	canResetPinFor,
	onOffsetChange,
	onEdit,
	onResetPassword,
	onSetPin,
	onToggleActive,
}: StaffTableProps) {
	return (
		<div className="rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-24">Staff ID</TableHead>
						<TableHead>Name</TableHead>
						<TableHead>Email</TableHead>
						<TableHead className="w-28">Role</TableHead>
						<TableHead className="w-24">Branch</TableHead>
						<TableHead className="w-24">PIN</TableHead>
						<TableHead className="w-32">Status</TableHead>
						<TableHead className="w-16" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading ? (
						<TableMessage colSpan={8}>Loading staff…</TableMessage>
					) : isError ? (
						<TableMessage colSpan={8} tone="error">
							Couldn't load staff.
						</TableMessage>
					) : staff.length === 0 ? (
						<TableMessage colSpan={8}>No staff match these filters.</TableMessage>
					) : (
						staff.map((member) => (
							<TableRow key={member.id}>
								<TableCell className="font-mono text-xs">{member.staffId ?? "—"}</TableCell>
								<TableCell className="font-medium">{member.name}</TableCell>
								<TableCell className="text-muted-foreground">{member.email}</TableCell>
								<TableCell>
									<RoleBadge role={member.role} />
								</TableCell>
								<TableCell className="font-mono text-xs text-muted-foreground">
									{branchCode(member.branchId)}
								</TableCell>
								<TableCell>
									<PinStatusBadge
										pinVersion={member.pinVersion}
										pinMustChange={member.pinMustChange}
									/>
								</TableCell>
								<TableCell>
									<div className="flex flex-col gap-1">
										<ActiveBadge active={member.isActive} />
										{member.mustChangePassword ? (
											<span className="text-xs text-amber-600">Password change required</span>
										) : null}
									</div>
								</TableCell>
								<TableCell className="text-right">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Actions for ${member.name}`}
											>
												<MoreHorizontalIcon />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											{canUpdate ? (
												<DropdownMenuItem
													className="cursor-pointer"
													onSelect={() => onEdit(member)}
												>
													Edit
												</DropdownMenuItem>
											) : null}
											{canResetPassword ? (
												<DropdownMenuItem
													className="cursor-pointer"
													onSelect={() => onResetPassword(member)}
												>
													Reset password
												</DropdownMenuItem>
											) : null}
											{canResetPinFor(member) ? (
												<DropdownMenuItem
													className="cursor-pointer"
													onSelect={() => onSetPin(member)}
												>
													Set PIN
												</DropdownMenuItem>
											) : null}
											{canUpdate && member.id !== currentUserId ? (
												member.isActive ? (
													<DropdownMenuItem
														variant="destructive"
														className="cursor-pointer"
														onSelect={() => onToggleActive(member)}
													>
														Deactivate
													</DropdownMenuItem>
												) : (
													<DropdownMenuItem
														className="cursor-pointer"
														onSelect={() => onToggleActive(member)}
													>
														Reactivate
													</DropdownMenuItem>
												)
											) : null}
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
			<div className="border-t px-3">
				<Pagination total={total} limit={limit} offset={offset} onOffsetChange={onOffsetChange} />
			</div>
		</div>
	)
}
