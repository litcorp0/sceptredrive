import type { SupplierMomoNetwork, SupplierPaymentDetailView } from "../types"

/** The MoMo network label; the stored network codes are never rendered raw. */
export function momoNetworkLabel(network: SupplierMomoNetwork | null): string {
	if (network === "MTN") return "MTN MoMo"
	if (network === "VOD") return "Telecel Cash"
	if (network === "ATL") return "AirtelTigo Money"
	return "—"
}

/**
 * What the payment-details table prints for the account. The API masks the number off the owning
 * payload; the masked form is the fallback for rows that carry no number at all.
 *
 * Payment destinations are sensitive: the value is render-only — never log it and never put it in
 * a query key.
 */
export function paymentAccountDisplay(detail: SupplierPaymentDetailView): string {
	return detail.accountNumber ?? detail.accountNumberMasked ?? "—"
}
