import { formatBranchLabel } from "@sceptre/shared"

export interface BranchRef {
	id: string
	code: string
	name: string
}

/**
 * Resolve a branch reference from an id or a code against the branches the
 * signed-in user can see. Unknown references fall back to the code (or an
 * em dash) rather than inventing a name.
 */
export function branchLabelFor(
	branches: readonly BranchRef[],
	ref: { id?: string | null; code?: string | null } | null | undefined,
): string {
	if (!ref) return "—"
	const byId = ref.id ? branches.find((branch) => branch.id === ref.id) : undefined
	const byCode = ref.code ? branches.find((branch) => branch.code === ref.code) : undefined
	const branch = byId ?? byCode
	if (branch) return formatBranchLabel(branch)
	return ref.code ?? "—"
}
