import { SHELL_KEYS } from "#/lib/query-keys"
import type { BranchListQuery } from "../types"

/**
 * Every key the branches module owns. The root is `SHELL_KEYS.branches`, not a re-declared
 * `["branches"]`, because the shell's branch switcher reads the same constant from
 * `lib/branch-context.tsx`. One shared array means either side's invalidation refreshes the
 * switcher, and `lib` never has to import a module.
 */
export const branchKeys = {
	all: SHELL_KEYS.branches,
	list: (query: BranchListQuery) => [...branchKeys.all, query] as const,
	detail: (id: string) => [...branchKeys.all, id] as const,
	/**
	 * The unscoped directory for a transfer source picker. Keyed under the branches root, so a
	 * create/deactivate refresh reaches both the switcher and the directory.
	 */
	directory: () => [...branchKeys.all, "directory"] as const,
}
