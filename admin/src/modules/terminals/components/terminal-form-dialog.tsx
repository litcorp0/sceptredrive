import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"
import { terminalKeys } from "../api/keys"
import { createTerminal } from "../api/terminals"

export function TerminalFormDialog({
	open,
	onOpenChange,
	defaultBranchId,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	defaultBranchId: string | null
}) {
	const queryClient = useQueryClient()
	const { branches, canSelectBranch } = useBranch()

	const [name, setName] = useState("")
	const [branchId, setBranchId] = useState(defaultBranchId ?? "")

	useEffect(() => {
		if (open) setBranchId(defaultBranchId ?? branches[0]?.id ?? "")
	}, [open, defaultBranchId, branches])

	const createMutation = useMutation({
		mutationFn: () => createTerminal({ branchId, name }),
		onSuccess: async (data) => {
			toast.success(`Terminal ${data.terminal.code} created`, {
				description: "Generate an enrollment code when the POS is ready to connect.",
			})
			await queryClient.invalidateQueries({ queryKey: terminalKeys.all })
			onOpenChange(false)
			setName("")
		},
		onError: (error) => toastApiError(error),
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		createMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>New terminal</DialogTitle>
					<DialogDescription>
						The terminal code is allocated automatically from the branch code.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{canSelectBranch ? (
						<div className="grid gap-1.5">
							<Label htmlFor="terminal-branch">Branch</Label>
							<Select value={branchId} onValueChange={setBranchId}>
								<SelectTrigger id="terminal-branch" className="w-full">
									<SelectValue placeholder="Select a branch" />
								</SelectTrigger>
								<SelectContent>
									{branches
										.filter((branch) => branch.isActive)
										.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.code} · {branch.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="terminal-name">Name</Label>
						<Input
							id="terminal-name"
							required
							minLength={2}
							placeholder="Front counter"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending || !branchId}>
							{createMutation.isPending ? "Creating…" : "Create terminal"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
