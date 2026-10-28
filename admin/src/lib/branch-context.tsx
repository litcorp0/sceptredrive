import { useQuery } from "@tanstack/react-query"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"
import { apiRequest } from "#/lib/api"
import type { Session } from "#/lib/auth-client"
import { SHELL_KEYS } from "#/lib/query-keys"

const STORAGE_KEY = "sceptre-drive.admin.branchId"

/**
 * The branch fields the console shell actually reads (the switcher and the branch columns its
 * consumers render). The full record belongs to `modules/branches`; `lib` must not import a module
 * — that would make `lib → modules/branches → lib` a cycle — so the shell declares the subset it
 * needs and keeps its own transport call.
 */
interface ShellBranch {
	id: string
	code: string
	name: string
	type: "RETAIL" | "WAREHOUSE"
	isActive: boolean
}

interface BranchContextValue {
	/** Branches visible to the signed-in user. */
	branches: ShellBranch[]
	isLoading: boolean
	/** null means "all branches" (admins only). */
	activeBranchId: string | null
	activeBranch: ShellBranch | null
	setActiveBranchId: (id: string | null) => void
	/** Admins can switch; managers are pinned to their own branch. */
	canSelectBranch: boolean
}

const BranchContext = createContext<BranchContextValue | null>(null)

export function BranchProvider({ session, children }: { session: Session; children: ReactNode }) {
	const canSelectBranch = session.user.role === "ADMIN"

	const { data, isLoading } = useQuery({
		queryKey: SHELL_KEYS.branches,
		queryFn: () => apiRequest<{ branches: ShellBranch[] }>("/api/branches"),
	})
	const branches = useMemo(() => data?.branches ?? [], [data])

	const [selectedId, setSelectedId] = useState<string | null>(() => {
		if (!canSelectBranch) return session.user.branchId ?? null
		if (typeof window === "undefined") return null
		return window.localStorage.getItem(STORAGE_KEY)
	})

	const setActiveBranchId = useCallback((id: string | null) => {
		setSelectedId(id)
		if (typeof window === "undefined") return
		if (id) window.localStorage.setItem(STORAGE_KEY, id)
		else window.localStorage.removeItem(STORAGE_KEY)
	}, [])

	const activeBranchId = canSelectBranch ? selectedId : (session.user.branchId ?? null)
	const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? null

	const value = useMemo(
		() => ({
			branches,
			isLoading,
			activeBranchId,
			activeBranch,
			setActiveBranchId,
			canSelectBranch,
		}),
		[branches, isLoading, activeBranchId, activeBranch, setActiveBranchId, canSelectBranch],
	)

	return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch(): BranchContextValue {
	const context = useContext(BranchContext)
	if (!context) throw new Error("useBranch must be used inside a BranchProvider")
	return context
}
