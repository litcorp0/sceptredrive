import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon, PrinterIcon } from "lucide-react"
import { useState } from "react"
import { StatementView } from "#/components/customers/statement-view"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError, api } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"

export const Route = createFileRoute("/_authenticated/customers/$id/statement")({
	component: CustomerStatementPage,
})

/**
 * Printable statement for one customer at one branch. The console controls
 * (branch, range, print) are screen-only; the statement itself is the exact
 * API payload and prints as A4 with the chrome hidden.
 */
function CustomerStatementPage() {
	const { id } = Route.useParams()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	const [branchChoice, setBranchChoice] = useState<string | null>(null)
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")

	const profilesQuery = useQuery({
		queryKey: ["credit-profiles", id],
		queryFn: () => api.credit.profiles.list({ customerId: id }),
	})
	const profiles = profilesQuery.data?.profiles ?? []

	const effectiveBranchId =
		branchChoice ?? activeBranchId ?? profiles[0]?.branchId ?? branches[0]?.id ?? null
	const selectedBranch = branches.find((branch) => branch.id === effectiveBranchId) ?? null

	const statementQuery = useQuery({
		queryKey: ["statement", id, effectiveBranchId, from, to],
		queryFn: () =>
			api.credit.statement(id, {
				branchId: effectiveBranchId ?? undefined,
				from: from || undefined,
				to: to || undefined,
			}),
		enabled: effectiveBranchId !== null,
	})

	const statementError =
		statementQuery.error instanceof ApiError
			? statementQuery.error.message
			: "Couldn't load the statement."

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-end gap-3 print:hidden">
				<Link
					to="/customers/$id"
					params={{ id }}
					className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
					Back to customer
				</Link>

				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="statement-branch" className="text-xs text-muted-foreground">
							Branch
						</Label>
						<Select value={effectiveBranchId ?? ""} onValueChange={setBranchChoice}>
							<SelectTrigger id="statement-branch" className="w-52">
								<SelectValue placeholder="Select a branch" />
							</SelectTrigger>
							<SelectContent>
								{branches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<p className="mb-2 self-center text-sm text-muted-foreground">
						Branch:{" "}
						<span className="font-medium text-foreground">{selectedBranch?.name ?? "—"}</span>
					</p>
				)}

				<div className="grid gap-1.5">
					<Label htmlFor="statement-from" className="text-xs text-muted-foreground">
						From
					</Label>
					<Input
						id="statement-from"
						type="date"
						className="w-40"
						value={from}
						onChange={(event) => setFrom(event.target.value)}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="statement-to" className="text-xs text-muted-foreground">
						To
					</Label>
					<Input
						id="statement-to"
						type="date"
						className="w-40"
						value={to}
						onChange={(event) => setTo(event.target.value)}
					/>
				</div>

				<Button
					type="button"
					variant="outline"
					size="sm"
					className="mb-0.5"
					disabled={!statementQuery.data}
					onClick={() => window.print()}
				>
					<PrinterIcon className="size-3.5" aria-hidden="true" />
					Print
				</Button>
			</div>

			{effectiveBranchId === null ? (
				<p className="text-sm text-muted-foreground">Choose a branch to build the statement.</p>
			) : statementQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading statement…</p>
			) : statementQuery.isError ? (
				<p className="text-sm text-destructive">{statementError}</p>
			) : statementQuery.data ? (
				<div className="rounded-xl border bg-card p-6 print:border-0 print:p-0">
					<StatementView statement={statementQuery.data} />
				</div>
			) : null}
		</div>
	)
}
