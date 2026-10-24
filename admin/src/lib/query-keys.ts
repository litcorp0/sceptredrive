/**
 * Query keys the console shell owns, because it needs the data before any module exists.
 *
 * The branch list is read by `lib/branch-context.tsx` (which must not import a module — that
 * would make `lib → modules/branches → lib` a cycle) and by the branches module. Both use this
 * constant, so the key stays byte-identical to the pre-Phase-8 `["branches"]` and an
 * `invalidateQueries({ queryKey: ["branches"] })` from either side still refreshes the switcher.
 */
export const SHELL_KEYS = {
	branches: ["branches"],
} as const
