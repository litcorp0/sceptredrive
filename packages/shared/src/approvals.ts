import type { Role } from './roles.ts'

/**
 * The approval vocabulary shared by the API, the console, and the POS.
 *
 * One entity carries every human decision the business makes about a document:
 * a purchase order over the limit, a product a manager submitted, a transfer, a
 * write-off, a price change, a credit limit, a shift variance, a refund.
 * Phase 11 writes only the first two; the rest are declared here so the enum
 * never has to grow in a migration that must be split by hand.
 *
 * The display strings ("Awaiting approval", …) live in each client. The API
 * returns these machine values and nothing else.
 */

export const APPROVAL_TYPES = [
  /** Phase 11 — a purchase order at or above the branch threshold. */
  'PURCHASE_ORDER',
  /** Phase 11 — a product a manager submitted for an admin to create. */
  'PRODUCT_CREATE',
  /** Phase 12 — a branch-to-branch or warehouse-to-branch transfer. */
  'TRANSFER_REQUEST',
  /** Phase 12 — a stock write-off with a reason code. */
  'STOCK_WRITE_OFF',
  /** Phase 12 — a price outside the ±10% band. */
  'PRICE_CHANGE',
  /** Phase 12 — a customer credit limit change. */
  'CREDIT_LIMIT_CHANGE',
  /** Phase 12 — a closed shift with a variance beyond tolerance. */
  'SHIFT_VARIANCE_REVIEW',
  /** Phase 13 — a refund at or above the configured cap. */
  'REFUND',
] as const

export type ApprovalType = (typeof APPROVAL_TYPES)[number]

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/**
 * Why a decision was made. The code is required when rejecting and optional
 * when approving, because "no" without a reason is the thing people complain
 * about afterwards.
 */
export const APPROVAL_REASON_CODES = [
  'OVER_THRESHOLD',
  'PRICE_TOO_HIGH',
  'OUT_OF_POLICY',
  'INCOMPLETE',
  'DUPLICATE',
  'OTHER',
] as const

export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number]

/**
 * Who may decide each type. Every type is an admin decision in v1; a branch
 * manager deciding their own request is the hole this table exists to keep
 * closed, and self-approval is refused regardless (the server compares the
 * requester to the decider).
 */
export const APPROVAL_DECIDER_ROLE = {
  PURCHASE_ORDER: 'ADMIN',
  PRODUCT_CREATE: 'ADMIN',
  TRANSFER_REQUEST: 'ADMIN',
  STOCK_WRITE_OFF: 'ADMIN',
  PRICE_CHANGE: 'ADMIN',
  CREDIT_LIMIT_CHANGE: 'ADMIN',
  SHIFT_VARIANCE_REVIEW: 'ADMIN',
  REFUND: 'ADMIN',
} as const satisfies Record<ApprovalType, Role>

export function approvalDeciderRole(type: ApprovalType): Role {
  return APPROVAL_DECIDER_ROLE[type]
}

/** A decided approval is immutable: no re-decide, no withdraw, no edit. */
export function isDecided(status: ApprovalStatus): boolean {
  return status !== 'PENDING'
}

export function isApprovalType(value: string): value is ApprovalType {
  return (APPROVAL_TYPES as readonly string[]).includes(value)
}

export function isApprovalReasonCode(value: string): value is ApprovalReasonCode {
  return (APPROVAL_REASON_CODES as readonly string[]).includes(value)
}
