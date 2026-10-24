import type { Permission, Role } from "@sceptre/shared"
import { can, ROLES } from "@sceptre/shared"

/** Better Auth types additional fields loosely; narrow to the known roles. */
export function toRole(value: string): Role | null {
	return (ROLES as readonly string[]).includes(value) ? (value as Role) : null
}

/** Deny-by-default permission check for console UX (the API enforces for real). */
export function hasPermission(role: string, permission: Permission): boolean {
	const narrowed = toRole(role)
	return narrowed !== null && can(narrowed, permission)
}
