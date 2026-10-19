import type { z } from 'zod'
import type {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from './loyalty.schema.ts'
import type { liabilityQuerySchema, loyaltyEntryCreateSchema } from './loyalty.validation.ts'

export type LoyaltyAccountRow = typeof loyaltyAccount.$inferSelect
export type LoyaltyLedgerEntryRow = typeof loyaltyLedgerEntry.$inferSelect
export type LoyaltyLotRow = typeof loyaltyLot.$inferSelect
export type LoyaltyLotConsumptionRow = typeof loyaltyLotConsumption.$inferSelect

export type LoyaltyEntryKind = LoyaltyLedgerEntryRow['kind']
export type LoyaltyReasonCode = NonNullable<LoyaltyLedgerEntryRow['reasonCode']>

/** Staff-postable kinds; EXPIRE is written only by the expiry engine. */
export type LoyaltyStaffKind = Exclude<LoyaltyEntryKind, 'EXPIRE'>

export type LoyaltyEntryCreateBody = z.infer<typeof loyaltyEntryCreateSchema>
export type LiabilityQuery = z.infer<typeof liabilityQuerySchema>

/** Signed service-level input: REDEEM/CLAWBACK arrive negative (validation negates). */
export interface LoyaltyPostEntryInput {
  customerId: string
  branchId: string | null
  kind: LoyaltyStaffKind
  netPaidMinor?: number | undefined
  pointsDelta?: number | undefined
  reasonCode?: LoyaltyReasonCode | null | undefined
  note?: string | null | undefined
  referenceType?: string | null | undefined
  referenceId?: string | null | undefined
  referenceNumber?: string | null | undefined
  idempotencyKey?: string | null | undefined
  occurredAt?: Date | undefined
}

export interface RedeemQuote {
  points: number
  discountMinor: number
}

export interface LoyaltyPostingResult {
  /** Null when an earn floors to zero points (no-carry sales write nothing). */
  entry: LoyaltyLedgerEntryRow | null
  account: LoyaltyAccountRow
  lot: LoyaltyLotRow | null
  consumption: LoyaltyLotConsumptionRow[]
  quote: RedeemQuote | null
}

export interface ExpiryRunResult {
  accounts: number
  lots: number
  points: number
}

export interface LoyaltyEntryListOptions {
  limit?: number
  offset?: number
  newestFirst?: boolean
}

/** Account summary, live lots, and recent entries for one customer. */
export interface LoyaltyAccountDetail {
  accountId: string
  customerId: string
  balancePoints: number
  lots: LoyaltyLotRow[]
  entries: LoyaltyLedgerEntryRow[]
  entryTotal: number
}

export interface LoyaltyBranchActivityTotals {
  branchId: string | null
  earnedPoints: number
  redeemedPoints: number
  clawedBackPoints: number
  adjustedPoints: number
  expiredPoints: number
}

export interface LoyaltyBranchActivity extends LoyaltyBranchActivityTotals {
  netPoints: number
}

export interface LoyaltyNegativeBalance {
  customerId: string
  customerName: string
  branchId: string | null
  balancePoints: number
}

export interface LoyaltyOutstandingTotals {
  accounts: number
  points: number
}

export interface LoyaltyLiabilityReport {
  asOf: string
  pointsPerCedi: number
  outstandingPoints: number
  outstandingValueMinor: number
  activity: {
    from: string | null
    to: string | null
    /** Null means every branch (admin); managers are always scoped to their own. */
    branchId: string | null
    rows: LoyaltyBranchActivity[]
  }
  negativeBalances: LoyaltyNegativeBalance[]
}
