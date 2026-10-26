/**
 * `branches` — retail stores and warehouses, their codes, and the branch detail form.
 *
 * Migration note (Phase 8): `routes/_authenticated/branches.tsx` was 324 lines and
 * `branches.$id.tsx` was 211. The list, create dialog, detail query and edit form now live here;
 * both routes render a page and nothing else (decision D9 — a move, not a rewrite).
 *
 * `Branch` is exported as the phase's first cross-module type. Consumers import it with
 * `import type { Branch } from "#/modules/branches"`; type-only imports are erased, so the barrel
 * cannot create a runtime cycle. The shell's `lib/branch-context.tsx` deliberately does not import
 * this module — it keeps its own `apiRequest` call and `SHELL_KEYS.branches`.
 */

export {
	branchDetailOptions,
	branchDirectoryOptions,
	branchListOptions,
	createBranch,
	deactivateBranch,
	suggestBranchCode,
	updateBranch,
} from "./api/branches"
export { branchKeys } from "./api/keys"
export { CreateBranchDialog } from "./components/create-branch-dialog"
export { EditBranchForm } from "./components/edit-branch-form"
export { BranchDetailPage } from "./pages/branch-detail-page"
export { BranchesPage } from "./pages/branches-page"
export type {
	Branch,
	BranchCreateInput,
	BranchDirectoryEntry,
	BranchListQuery,
	BranchType,
	BranchUpdateInput,
	SuggestCode,
} from "./types"
