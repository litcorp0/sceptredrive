import { StatusBadge } from "#/components/common/status-badge"

/**
 * PIN state for a staff row. `pinVersion === 0` is the only "never set" signal:
 * a manager reset always stores a hash and bumps the version, and a role or
 * branch change bumps it without clearing the hash.
 */
export function PinStatusBadge({
	pinVersion,
	pinMustChange,
}: {
	pinVersion: number
	pinMustChange: boolean
}) {
	if (pinVersion === 0) return <StatusBadge tone="zinc">Not set</StatusBadge>
	if (pinMustChange) return <StatusBadge tone="amber">Temporary</StatusBadge>
	return <StatusBadge tone="green">Set</StatusBadge>
}
