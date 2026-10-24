/**
 * `staff` — manager and cashier console accounts, their PIN state, and password resets.
 *
 * Migration note (Phase 8): the route for `/staff` was 742 lines holding the list, three dialogs,
 * four mutations and their invalidations. The route now renders `StaffPage` and nothing else.
 *
 * Each mutation stayed next to its single consumer (reset/activate on the page, create and update
 * in their dialogs) instead of moving to `hooks/`: they close over local state and callbacks, so
 * extracting them would have been a rewrite rather than a move (decision D9). `hooks/` gets
 * created when something is genuinely shared.
 */
export { staffKeys } from "./api/keys"
export {
	createStaff,
	deactivateStaff,
	reactivateStaff,
	resetStaffPassword,
	setStaffPin,
	staffDetailOptions,
	staffListOptions,
	staffPinStatus,
	updateStaff,
} from "./api/staff"
export { CreateStaffDialog } from "./components/create-staff-dialog"
export { type Credentials, CredentialsDialog } from "./components/credentials-dialog"
export { EditStaffDialog } from "./components/edit-staff-dialog"
export { PinDialog } from "./components/pin-dialog"
export { PinStatusBadge } from "./components/pin-status-badge"
export { StaffTable } from "./components/staff-table"
export { StaffPage } from "./pages/staff-page"
export type {
	CreateStaffResult,
	ResetPasswordResult,
	SetStaffPinInput,
	SetStaffPinResult,
	Staff,
	StaffCreateInput,
	StaffListQuery,
	StaffPinStatus,
	StaffUpdateInput,
} from "./types"
