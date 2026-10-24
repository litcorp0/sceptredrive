import { useQuery } from "@tanstack/react-query"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"
import { api } from "#/lib/api"
import type { Branch } from "#/lib/api-types"
import type { Session } from "#/lib/auth-client"
import { SHELL_KEYS } from "#/lib/query-keys"

const STORAGE_KEY = "sceptre-drive.admin.branchId"

interface BranchContextValue {
	/** Branches visible to the signed-in user. */
	branches: Branch[]
	isLoading: boolean
	/** null means "all branches" (admins only). */
	activeBranchId: string | null
	activeBranch: Branch | null
	setActiveBranchId: (id: string | null) => void
	/** Admins can switch; managers are pinned to their own branch. */
	canSelectBranch: boolean
}

const BranchContext = createContext<BranchContextValue | null>(null)

export function BranchProvider({ session, children }: { session: Session; children: ReactNode }) {
	const canSelectBranch = session.user.role === "ADMIN"

	const { data, isLoading } = useQuery({
		queryKey: SHELL_KEYS.branches,
		queryFn: () => api.branches.list(),
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
