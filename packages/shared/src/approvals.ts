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
 * The role and branch a request type defaults to when nothing more specific is
 * known. Stored on the row (`decider_role`, `decider_branch_id`), never derived
 * from the type at decision time — P12-D2.
 */
export interface ApprovalAuthority {
  role: Role
  /** null = any branch (an admin); a uuid = that branch only (a manager). */
  branchId: string | null
}

/**
 * Defaults. A requesting service overrides them when the subject decides the
 * authority (a transfer's source branch type; a shift's branch) — P12-D2.
 *
 * A `MANAGER` default binds the decision to the branch passed in; an `ADMIN`
 * default is never branch-bound, because an admin may decide in any branch and
 * that fallback is what P12-D3 depends on.
 */
export const APPROVAL_DECIDER_ROLE: Record<ApprovalType, Role> = {
  PURCHASE_ORDER: 'ADMIN',
  PRODUCT_CREATE: 'ADMIN',
  TRANSFER_REQUEST: 'MANAGER', // overridden to ADMIN when the source is a warehouse
  STOCK_WRITE_OFF: 'ADMIN',
  PRICE_CHANGE: 'ADMIN',
  CREDIT_LIMIT_CHANGE: 'ADMIN',
  SHIFT_VARIANCE_REVIEW: 'MANAGER',
  REFUND: 'ADMIN',
}

/**
 * The authority a row is created with. `branchId` is the branch that owns the
 * subject (a transfer's source, a shift's branch); it is ignored when the role
 * is `ADMIN`.
 *
 * A `MANAGER` default with a null branch is returned as-is and is undecidable —
 * `canDecideApproval` fails closed. `requestApproval` refuses that pairing when
 * the row is written, so the state is never persisted.
 */
export function defaultApprovalAuthority(
  type: ApprovalType,
  branchId: string | null,
): ApprovalAuthority {
  const role = APPROVAL_DECIDER_ROLE[type]
  return { role, branchId: role === 'MANAGER' ? branchId : null }
}

/**
 * The one rule both the service and the console use to render a decision button.
 *
 * All four must hold: the row is pending, the actor holds `approval.decide`, the
 * actor did not raise the request (no self-approval, any role), and the actor is
 * either an admin or the manager of the branch the row names. A manager may never
 * decide an `ADMIN`-authority row, even in their own branch.
 */
export function canDecideApproval(args: {
  approval: {
    status: ApprovalStatus
    deciderRole: Role
    deciderBranchId: string | null
    requestedBy: string
  }
  user: {
    role: Role
    branchId: string | null
    label: string
    hasDecidePermission: boolean
  }
}): boolean {
  const { approval, user } = args

  if (approval.status !== 'PENDING') return false
  if (!user.hasDecidePermission) return false
  if (user.label === approval.requestedBy) return false
  if (user.role === 'ADMIN') return true

  return (
    approval.deciderRole === 'MANAGER' &&
    approval.deciderBranchId !== null &&
    user.branchId === approval.deciderBranchId
  )
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
