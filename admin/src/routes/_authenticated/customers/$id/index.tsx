import { formatGhanaPhone } from "@gikautos/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { api } from "#/lib/api"

export const Route = createFileRoute("/_authenticated/customers/$id/")({
	component: CustomerProfilePage,
})

function CustomerProfilePage() {
	const { id } = Route.useParams()

	const customerQuery = useQuery({
		queryKey: ["customer", id],
		queryFn: () => api.customers.get(id),
	})

	const customer = customerQuery.data?.customer

	if (customerQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading customer…</p>
	}

	if (customerQuery.isError || !customer) {
		return <p className="text-sm text-destructive">Couldn't load this customer.</p>
	}

	return (
		<div className="grid gap-4">
			<div>
				<Link
					to="/customers"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3.5" aria-hidden="true" />
					Customers
				</Link>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<h2 className="text-lg font-semibold tracking-tight">{customer.name}</h2>
					{customer.anonymizedAt ? (
						<StatusBadge tone="zinc">Anonymized</StatusBadge>
					) : (
						<ActiveBadge active={customer.status === "ACTIVE"} />
					)}
				</div>
				<p className="mt-1 text-sm text-muted-foreground">
					{customer.phone ? formatGhanaPhone(customer.phone) : "No phone"}
					{customer.email ? ` · ${customer.email}` : ""}
					{customer.address ? ` · ${customer.address}` : ""}
				</p>
			</div>

			<div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
				Credit, repayments, and the ledger for this customer are coming next.
			</div>
		</div>
	)
}
