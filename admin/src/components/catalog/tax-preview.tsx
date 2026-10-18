import type { TaxCategory, TaxMode } from "@gikautos/shared"
import { taxBreakdown } from "@gikautos/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { formatGhs } from "#/lib/format"

/**
 * Display-only Ghana tax split for the price being edited. The API computes
 * and stores the authoritative breakdown; this mirrors the shared engine.
 */
export function TaxPreview({
	priceMinor,
	taxCategory,
	taxMode,
}: {
	priceMinor: number | null
	taxCategory: TaxCategory
	taxMode: TaxMode
}) {
	if (priceMinor === null) {
		return (
			<div className="rounded-lg border bg-card p-4">
				<p className="text-sm text-muted-foreground">
					Enter a price to preview the VAT, NHIL, and GETFund split.
				</p>
			</div>
		)
	}

	let breakdown: ReturnType<typeof taxBreakdown>
	try {
		breakdown = taxBreakdown(priceMinor, taxCategory, taxMode)
	} catch {
		return (
			<div className="rounded-lg border bg-card p-4">
				<p className="text-sm text-destructive">Enter a valid amount to preview tax.</p>
			</div>
		)
	}

	const inclusive = taxMode === "INCLUSIVE"
	const rows: Array<{ label: string; value: number }> = [
		{ label: "Base", value: breakdown.baseMinor },
		{ label: "VAT (15%)", value: breakdown.vatMinor },
		{ label: "NHIL (2.5%)", value: breakdown.nhilMinor },
		{ label: "GETFund (2.5%)", value: breakdown.getfundMinor },
	]

	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-medium">Tax preview</h3>
				<StatusBadge tone="blue">{inclusive ? "Tax-inclusive" : "Tax-exclusive"}</StatusBadge>
			</div>

			<dl className="grid gap-1.5 text-sm">
				{inclusive ? (
					<div className="flex items-center justify-between">
						<dt className="text-muted-foreground">Price (customer pays)</dt>
						<dd className="tabular-nums">{formatGhs(breakdown.totalMinor)}</dd>
					</div>
				) : null}

				{rows.map((row) => (
					<div key={row.label} className="flex items-center justify-between">
						<dt className="text-muted-foreground">{row.label}</dt>
						<dd className="tabular-nums">{formatGhs(row.value)}</dd>
					</div>
				))}

				<div className="mt-1 flex items-center justify-between border-t pt-2 font-medium">
					<dt>{inclusive ? "Total tax" : "Total (customer pays)"}</dt>
					<dd className="tabular-nums">
						{formatGhs(inclusive ? breakdown.taxTotalMinor : breakdown.totalMinor)}
					</dd>
				</div>
			</dl>

			<p className="mt-3 text-xs text-muted-foreground">
				Display only. The API stores and validates the final amounts.
			</p>
		</div>
	)
}
