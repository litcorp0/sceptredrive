import { formatDay } from "@sceptre/shared"
import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import type { Supplier } from "../types"

export function SupplierOverview({ supplier }: { supplier: Supplier }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-2 text-sm md:grid-cols-2 md:gap-x-8">
				<DetailsRow label="Code">
					<span className="font-mono text-xs">{supplier.code}</span>
				</DetailsRow>
				<DetailsRow label="Payment terms">
					{supplier.paymentTermDays === 0
						? "Due on receipt"
						: `NET ${supplier.paymentTermDays} days`}
				</DetailsRow>
				<DetailsRow label="Contact">{supplier.contactName ?? "—"}</DetailsRow>
				<DetailsRow label="Phone">{supplier.phone ?? "—"}</DetailsRow>
				<DetailsRow label="Email">{supplier.email ?? "—"}</DetailsRow>
				<DetailsRow label="TIN">{supplier.tin ?? "—"}</DetailsRow>
				<DetailsRow label="VAT number">{supplier.vatNumber ?? "—"}</DetailsRow>
				<DetailsRow label="Created">{formatDay(supplier.createdAt)}</DetailsRow>
				<DetailsRow label="Address">{supplier.address ?? "—"}</DetailsRow>
				<DetailsRow label="Notes">{supplier.notes ?? "—"}</DetailsRow>
			</CardContent>
		</Card>
	)
}

function DetailsRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-4 border-b py-1.5 last:border-b-0">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right">{children}</span>
		</div>
	)
}
