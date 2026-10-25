import { useBranch } from "#/lib/branch-context"

/**
 * The branch an analytics request should ask for.
 *
 * Precedence (P9-D4): the URL wins when it names a branch, otherwise the shell switcher
 * decides. A manager never sends one: their scope is the server's decision, and dropping the
 * parameter here keeps a hand-edited `?branchId=` from producing a 403 on their page.
 */
export function useAnalyticsBranch(urlBranchId: string | undefined): {
	branchId: string | undefined
	canSelectBranch: boolean
} {
	const { canSelectBranch, activeBranchId } = useBranch()
	if (!canSelectBranch) return { branchId: undefined, canSelectBranch }
	return { branchId: urlBranchId ?? activeBranchId ?? undefined, canSelectBranch }
}
