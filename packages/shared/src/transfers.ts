/**
 * Supplier-transfer vocabulary (P14-D24).
 *
 * A transfer is our instruction to Paystack to pay a supplier, never the
 * payment itself. `SUCCESS` is the only status that moved money; a reversal is
 * money that came back and a failed attempt leaves the supplier unpaid.
 */

export const TRANSFER_STATUSES = [
  'PENDING',
  'AWAITING_OTP',
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'BLOCKED',
  'REJECTED',
] as const

export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  PENDING: 'Pending',
  AWAITING_OTP: 'Awaiting OTP',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  REVERSED: 'Reversed',
  BLOCKED: 'Blocked',
  REJECTED: 'Rejected',
}

const PROVIDER_TRANSFER_STATUSES: Record<string, TransferStatus> = {
  pending: 'PENDING',
  otp: 'AWAITING_OTP',
  success: 'SUCCESS',
  failed: 'FAILED',
  reversed: 'REVERSED',
  blocked: 'BLOCKED',
  rejected: 'REJECTED',
}

/**
 * Paystack's own vocabulary → ours. Null means "we do not know this status",
 * which the caller treats as no transition rather than as failure. Paystack's
 * payloads are lowercase and our enum is not.
 */
export function mapProviderTransferStatus(raw: string): TransferStatus | null {
  return PROVIDER_TRANSFER_STATUSES[raw.toLowerCase()] ?? null
}

/** SUCCESS only. A reversal is money that came back; it is not a payment. */
export function transferMovedMoney(status: TransferStatus): boolean {
  return status === 'SUCCESS'
}

/** Terminal states never move again; a webhook arriving for one is a duplicate. */
export function isTerminalTransferStatus(status: TransferStatus): boolean {
  return (
    status === 'SUCCESS' ||
    status === 'FAILED' ||
    status === 'REVERSED' ||
    status === 'BLOCKED' ||
    status === 'REJECTED'
  )
}
