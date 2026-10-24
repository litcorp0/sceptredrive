import { formatDateTime, formatDay, formatGhanaPhone } from "@sceptre/shared"
import type { CreditStatement, StatementEntry } from "#/lib/api-types"
import { formatGhs } from "#/lib/format"
import {
	AGING_BUCKET_LABELS,
	CREDIT_KIND_LABELS,
	CREDIT_METHOD_LABELS,
	CREDIT_REASON_LABELS,
	signedGhs,
} from "#/modules/credit"

/**
 * Printable A4 customer statement: exactly the statement payload — header,
 * opening balance, ranged entries, closing balance, and the outstanding-charge
 * aging summary — with no console chrome. Printing is triggered by the page.
 */
export function StatementView({ statement }: { statement: CreditStatement }) {
	const period = statement.from
		? `${formatDay(statement.from)} – ${formatDay(statement.to)}`
		: `All time through ${formatDay(statement.to)}`

	return (
		<div className="mx-auto w-full max-w-[190mm] bg-white text-black">
			<div className="flex items-start justify-between gap-6">
				<div>
					<p className="text-xl font-semibold tracking-tight">Sceptre Drive</p>
					<p className="text-sm text-muted-foreground">Customer credit statement</p>
				</div>
				<div className="text-right text-sm">
					<p className="font-medium">{statement.branch.name}</p>
					<p className="text-muted-foreground">{statement.branch.code}</p>
				</div>
			</div>

			<div className="mt-6 grid gap-1 border-y py-3 text-sm">
				<p>
					<span className="text-muted-foreground">Customer: </span>
					<span className="font-medium">{statement.customer.name}</span>
					{statement.customer.phone ? ` · ${formatGhanaPhone(statement.customer.phone)}` : ""}
				</p>
				<p>
					<span className="text-muted-foreground">Statement period: </span>
					{period}
				</p>
			</div>

			<table className="mt-4 w-full border-collapse text-sm">
				<thead>
					<tr className="border-b text-left">
						<th className="py-2 pr-2 font-medium">Date</th>
						<th className="py-2 pr-2 font-medium">Kind</th>
						<th className="py-2 pr-2 font-medium">Reference</th>
						<th className="py-2 pr-2 font-medium">Due date</th>
						<th className="py-2 pr-2 font-medium">Description</th>
						<th className="py-2 text-right font-medium">Amount</th>
					</tr>
				</thead>
				<tbody>
					{statement.entries.length === 0 ? (
						<tr>
							<td colSpan={6} className="py-4 text-center text-muted-foreground">
								No entries in this period.
							</td>
						</tr>
					) : (
						statement.entries.map((entry) => (
							<tr key={entry.id} className="border-b align-top">
								<td className="whitespace-nowrap py-2 pr-2">{formatDay(entry.occurredAt)}</td>
								<td className="whitespace-nowrap py-2 pr-2">{CREDIT_KIND_LABELS[entry.kind]}</td>
								<td className="whitespace-nowrap py-2 pr-2 font-mono text-xs">
									{entry.referenceNumber ?? "—"}
								</td>
								<td className="whitespace-nowrap py-2 pr-2">
									{entry.dueDate ? formatDay(entry.dueDate) : "—"}
								</td>
								<td className="py-2 pr-2">{describeEntry(entry)}</td>
								<td className="whitespace-nowrap py-2 text-right tabular-nums">
									{signedGhs(entry.amountMinor)}
								</td>
							</tr>
						))
					)}
				</tbody>
			</table>

			<div className="mt-4 grid justify-end gap-1 text-sm">
				<p className="flex justify-between gap-8">
					<span className="text-muted-foreground">
						{statement.from
							? `Opening balance (before ${formatDay(statement.from)})`
							: "Opening balance"}
					</span>
					<span className="tabular-nums">{formatGhs(statement.openingBalanceMinor)}</span>
				</p>
				<p className="flex justify-between gap-8 font-semibold">
					<span>Closing balance</span>
					<span className="tabular-nums">{formatGhs(statement.closingBalanceMinor)}</span>
				</p>
				{statement.currentBalanceMinor !== statement.closingBalanceMinor ? (
					<p className="flex justify-between gap-8 text-muted-foreground">
						<span>Current balance (all movements)</span>
						<span className="tabular-nums">{formatGhs(statement.currentBalanceMinor)}</span>
					</p>
				) : null}
			</div>

			{statement.aging.length > 0 ? (
				<div className="mt-8">
					<p className="text-sm font-medium">Outstanding charges as of {formatDay(statement.to)}</p>
					<table className="mt-2 w-full border-collapse text-sm">
						<thead>
							<tr className="border-b text-left">
								<th className="py-1.5 pr-2 font-medium">Due date</th>
								<th className="py-1.5 pr-2 font-medium">Bucket</th>
								<th className="py-1.5 pr-2 text-right font-medium">Days past due</th>
								<th className="py-1.5 text-right font-medium">Outstanding</th>
							</tr>
						</thead>
						<tbody>
							{statement.aging.map((charge) => (
								<tr key={charge.entryId} className="border-b">
									<td className="whitespace-nowrap py-1.5 pr-2">{formatDay(charge.dueDate)}</td>
									<td className="py-1.5 pr-2">{AGING_BUCKET_LABELS[charge.bucket]}</td>
									<td className="py-1.5 pr-2 text-right tabular-nums">
										{charge.daysPastDue > 0 ? charge.daysPastDue : "—"}
									</td>
									<td className="py-1.5 text-right tabular-nums">
										{formatGhs(charge.outstandingMinor)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}

			<p className="mt-8 text-xs text-muted-foreground">
				Generated {formatDateTime(new Date())} · Amounts in GHS
			</p>
		</div>
	)
}

/** Human description: payment method, reason, and note, in that order. */
function describeEntry(entry: StatementEntry): string {
	const parts: string[] = []
	if (entry.method) parts.push(CREDIT_METHOD_LABELS[entry.method])
	if (entry.reasonCode) parts.push(CREDIT_REASON_LABELS[entry.reasonCode])
	if (entry.note) parts.push(entry.note)
	return parts.length > 0 ? parts.join(" · ") : "—"
}
