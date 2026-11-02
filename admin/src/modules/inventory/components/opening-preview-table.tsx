import { StatusBadge } from "#/components/common/status-badge"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import type { OpeningPreview } from "../types"

/**
 * The review table for a go-live file. The console renders the server's numbers; it
 * never recomputes a delta or a value, because the post will use the server's own
 * arithmetic and the two must not disagree.
 */
export function OpeningPreviewTable({ preview }: { preview: OpeningPreview }) {
	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-12 text-right">Row</TableHead>
						<TableHead>Product</TableHead>
						<TableHead>Match</TableHead>
						<TableHead className="text-right">On hand</TableHead>
						<TableHead className="text-right">Counted</TableHead>
						<TableHead className="text-right">Delta</TableHead>
						<TableHead className="text-right">Unit cost</TableHead>
						<TableHead className="text-right">Value</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{preview.rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={8} className="text-muted-foreground">
								No rows to preview.
							</TableCell>
						</TableRow>
					) : (
						preview.rows.map((row) => (
							<TableRow key={`${row.lineNo}-${row.name}`}>
								<TableCell className="text-right font-mono text-xs">{row.lineNo}</TableCell>
								<TableCell>
									<p className="font-medium">{row.name}</p>
									<p className="text-xs text-muted-foreground">
										{row.sku ? `${row.sku} · ` : ""}
										{row.category} · {row.unit}
										{row.barcode ? ` · ${row.barcode}` : ""}
									</p>
									{row.errors.length > 0 ? (
										<ul className="mt-1 list-disc pl-4 text-xs text-destructive">
											{row.errors.map((error) => (
												<li key={error}>{error}</li>
											))}
										</ul>
									) : null}
									{row.warnings.length > 0 ? (
										<ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
											{row.warnings.map((warning) => (
												<li key={warning}>{warning}</li>
											))}
										</ul>
									) : null}
								</TableCell>
								<TableCell>
									<StatusBadge variant={row.status === "NEW" ? "info" : "ok"}>
										{row.status === "NEW" ? "New product" : "Existing"}
									</StatusBadge>
								</TableCell>
								<TableCell className="text-right tabular-nums">{row.onHand}</TableCell>
								<TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.delta > 0 ? "+" : ""}
									{row.delta}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatGhs(row.costMinor)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatGhs(row.countedValueMinor)}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	)
}
