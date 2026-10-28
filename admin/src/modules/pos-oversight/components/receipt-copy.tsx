import { formatCount, formatDateTime, formatTenderLabel } from "@sceptre/shared"
import { formatGhs } from "#/lib/format"
import type { ReceiptCopy } from "../types"
import { signatureGroups } from "../utils/labels"

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div
			className={strong ? "flex justify-between gap-2 font-semibold" : "flex justify-between gap-2"}
		>
			<dt>{label}</dt>
			<dd className="text-right tabular-nums">{value}</dd>
		</div>
	)
}

/**
 * A server-rendered copy of a sale's receipt, sized for an 80 mm till roll.
 *
 * Every figure is the API's own column. This component re-adds nothing: if the copy and
 * the till disagree, the bug is on the server, not in a browser sum. The caption is not
 * conditional — the server does not know the till's print status and must not imply it
 * (P14-D10). The E-VAT block is rendered only when the payload carries a certificate, and
 * the QR payload is text: no image is generated from a mock (P14-D39).
 */
export function ReceiptCopyDocument({ copy }: { copy: ReceiptCopy }) {
	const { header, totals } = copy
	const hasDiscounts =
		totals.lineDiscountMinor > 0 || totals.saleDiscountMinor > 0 || totals.loyaltyDiscountMinor > 0

	return (
		<article
			aria-label="Copy of receipt"
			className="receipt-copy-print mx-auto w-full max-w-[80mm] border border-black/20 bg-white p-3 font-mono text-[11px] leading-snug text-black print:border-0 print:p-0"
		>
			<p className="border border-black px-2 py-1 text-center font-semibold">
				Copy of receipt — not a till reprint
			</p>

			<header className="mt-3 grid gap-0.5 text-center">
				<p className="font-semibold whitespace-pre-line">{header.seller}</p>
				<p>{header.branch}</p>
				<p className="text-black/70">
					{header.branchCode} · {header.terminal}
				</p>
			</header>

			<div className="mt-2 grid gap-0.5 border-y border-dashed border-black/30 py-1.5">
				<Row label="Receipt" value={header.receiptNumber} />
				<Row label="Date" value={formatDateTime(header.occurredAt)} />
				<Row label="Cashier" value={header.cashier} />
				{header.customer ? (
					<>
						{header.customer.name ? <Row label="Customer" value={header.customer.name} /> : null}
						{header.customer.phoneMasked ? (
							<Row label="Phone" value={header.customer.phoneMasked} />
						) : null}
					</>
				) : null}
			</div>

			<table className="mt-2 w-full table-fixed border-collapse">
				<caption className="sr-only">Receipt lines</caption>
				<colgroup>
					<col className="w-[46%]" />
					<col className="w-[10%]" />
					<col className="w-[22%]" />
					<col className="w-[22%]" />
				</colgroup>
				<thead>
					<tr className="border-b border-black/30 text-left">
						<th scope="col" className="py-1 font-semibold">
							Item
						</th>
						<th scope="col" className="py-1 text-right font-semibold">
							Qty
						</th>
						<th scope="col" className="py-1 text-right font-semibold">
							Unit
						</th>
						<th scope="col" className="py-1 text-right font-semibold">
							Total
						</th>
					</tr>
				</thead>
				<tbody>
					{copy.lines.length === 0 ? (
						<tr>
							<td colSpan={4} className="py-2 text-black/70">
								No lines were recorded.
							</td>
						</tr>
					) : (
						copy.lines.map((line) => (
							<tr key={line.lineNumber} className="border-b border-black/10 align-top">
								<td className="py-1 pr-1">
									<span className="block">{line.name}</span>
									<span className="block text-[10px] text-black/60">{line.sku}</span>
									{line.lineDiscountMinor > 0 ? (
										<span className="block text-[10px] text-black/60">
											Line discount {formatGhs(line.lineDiscountMinor)}
										</span>
									) : null}
									{line.saleDiscountMinor > 0 ? (
										<span className="block text-[10px] text-black/60">
											Sale discount {formatGhs(line.saleDiscountMinor)}
										</span>
									) : null}
									{line.loyaltyDiscountMinor > 0 ? (
										<span className="block text-[10px] text-black/60">
											Loyalty discount {formatGhs(line.loyaltyDiscountMinor)}
										</span>
									) : null}
								</td>
								<td className="py-1 text-right tabular-nums">{formatCount(line.quantity)}</td>
								<td className="py-1 text-right tabular-nums">{formatGhs(line.unitPriceMinor)}</td>
								<td className="py-1 text-right tabular-nums">{formatGhs(line.totalMinor)}</td>
							</tr>
						))
					)}
				</tbody>
			</table>

			<dl className="mt-2 grid gap-0.5 border-t border-dashed border-black/30 pt-1.5">
				<Row label="Subtotal" value={formatGhs(totals.subtotalMinor)} />
				{hasDiscounts ? (
					<>
						{totals.lineDiscountMinor > 0 ? (
							<Row label="Line discounts" value={`−${formatGhs(totals.lineDiscountMinor)}`} />
						) : null}
						{totals.saleDiscountMinor > 0 ? (
							<Row label="Sale discount" value={`−${formatGhs(totals.saleDiscountMinor)}`} />
						) : null}
						{totals.loyaltyDiscountMinor > 0 ? (
							<Row label="Loyalty discount" value={`−${formatGhs(totals.loyaltyDiscountMinor)}`} />
						) : null}
					</>
				) : null}
				<Row label="Taxable" value={formatGhs(totals.taxableMinor)} />
				<Row label="VAT" value={formatGhs(totals.vatMinor)} />
				<Row label="NHIL" value={formatGhs(totals.nhilMinor)} />
				<Row label="GETFund" value={formatGhs(totals.getfundMinor)} />
				<Row label="Tax total" value={formatGhs(totals.taxTotalMinor)} />
				<Row label="TOTAL" value={formatGhs(totals.totalMinor)} strong />
			</dl>

			<dl className="mt-2 grid gap-0.5 border-t border-dashed border-black/30 pt-1.5">
				{copy.tenders.map((tender) => (
					<Row
						key={tender.sequence}
						label={`Paid · ${formatTenderLabel(tender.method)}`}
						value={formatGhs(tender.amountMinor)}
					/>
				))}
				<Row label="Tendered" value={formatGhs(copy.tenderedMinor)} />
				<Row label="Change" value={formatGhs(copy.changeMinor)} />
			</dl>

			{copy.loyalty ? (
				<dl className="mt-2 grid gap-0.5 border-t border-dashed border-black/30 pt-1.5">
					<Row label="Points earned" value={formatCount(copy.loyalty.earnedPoints)} />
					<Row label="Points redeemed" value={formatCount(copy.loyalty.redeemedPoints)} />
				</dl>
			) : null}

			{copy.evat ? (
				<section
					className="mt-2 grid gap-0.5 border-t border-dashed border-black/30 pt-1.5"
					aria-labelledby="receipt-evat-heading"
				>
					<h3 id="receipt-evat-heading" className="font-semibold">
						E-VAT certificate
					</h3>
					<Row label="Invoice number" value={copy.evat.providerInvoiceNumber ?? "—"} />
					<Row label="Receipt" value={header.receiptNumber} />
					<Row label="Serial" value={copy.evat.serial ?? "—"} />
					<Row label="SDC" value={copy.evat.sdcId ?? "—"} />
					<p className="mt-1">
						<span className="block text-black/70">Signature</span>
						<span className="block break-all">
							{signatureGroups(copy.evat.signature).join(" ")}
						</span>
					</p>
					<Row
						label="Stamped"
						value={copy.evat.stampedAt ? formatDateTime(copy.evat.stampedAt) : "—"}
					/>
					<p className="mt-1">
						<span className="block text-black/70">QR payload (text)</span>
						<code className="block break-all text-[10px]">{copy.evat.qrPayload ?? "—"}</code>
					</p>
					<p className="mt-1 text-[10px] text-black/70">
						A scannable QR is printed at the till once GRA onboarding is complete. This copy shows
						the certified payload as text.
					</p>
				</section>
			) : null}

			{copy.footer.trim().length > 0 ? (
				<p className="mt-2 border-t border-dashed border-black/30 pt-1.5 text-center whitespace-pre-line">
					{copy.footer}
				</p>
			) : null}
		</article>
	)
}
