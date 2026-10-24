/**
 * `terminals` — POS terminals per branch, their enrolled devices, and one-time enrollment codes.
 *
 * Migration note (Phase 8): `routes/_authenticated/terminals.tsx` was 441 lines holding the list,
 * create dialog, enrollment dialog, device list and revoke confirmation. The route now renders
 * `TerminalsPage` and nothing else. The one-time code stays local state: it is never logged and
 * never part of a React Query key (decision D9 — a move, not a rewrite).
 */
export { terminalKeys } from "./api/keys"
export {
	createEnrollment,
	createTerminal,
	revokeDevice,
	terminalDetailOptions,
	terminalDevicesOptions,
	terminalListOptions,
	updateTerminal,
} from "./api/terminals"
export { DeviceTable } from "./components/device-table"
export { DevicesDialog } from "./components/devices-dialog"
export { EnrollmentDialog } from "./components/enrollment-dialog"
export { RevokeDeviceDialog } from "./components/revoke-device-dialog"
export { TerminalFormDialog } from "./components/terminal-form-dialog"
export { TerminalsPage } from "./pages/terminals-page"
export type {
	Device,
	DeviceStatus,
	Enrollment,
	Terminal,
	TerminalCreateInput,
	TerminalListQuery,
	TerminalUpdateInput,
} from "./types"
