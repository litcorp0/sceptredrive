import type { z } from 'zod'
import type {
  creditEntryKindEnum,
  creditLedgerEntry,
  creditMethodEnum,
  creditOverrideReasonEnum,
  creditProfile,
  creditReasonCodeEnum,
} from './credit.schema.ts'
import type {
  agingQuerySchema,
  entryCreateSchema,
  entryListQuerySchema,
  profileListQuerySchema,
  profileUpdateSchema,
  repaymentCreateSchema,
  statementQuerySchema,
} from './credit.validation.ts'

export type CreditProfileRow = typeof creditProfile.$inferSelect
export type CreditLedgerEntryRow = typeof creditLedgerEntry.$inferSelect

export type CreditEntryKind = (typeof creditEntryKindEnum.enumValues)[number]
export type CreditReasonCode = (typeof creditReasonCodeEnum.enumValues)[number]
export type CreditMethod = (typeof creditMethodEnum.enumValues)[number]
export type CreditOverrideReason = (typeof creditOverrideReasonEnum.enumValues)[number]

export type ProfileUpdateBody = z.infer<typeof profileUpdateSchema>
export type RepaymentCreateBody = z.infer<typeof repaymentCreateSchema>
export type EntryCreateBody = z.infer<typeof entryCreateSchema>
export type EntryListQuery = z.infer<typeof entryListQuerySchema>
export type ProfileListQuery = z.infer<typeof profileListQuerySchema>
export type AgingQuery = z.infer<typeof agingQuerySchema>
export type StatementQuery = z.infer<typeof statementQuerySchema>

/** Signed input for the single write path: the amount is the stored ledger sign. */
export interface PostEntryInput {
  customerId: string
  branchId: string
  kind: CreditEntryKind
  amountMinor: number
  reasonCode?: CreditReasonCode | null
  method?: CreditMethod | null
  note?: string | null
  occurredAt?: Date
  dueDate?: Date | null
  referenceType?: string | null
  referenceId?: string | null
  referenceNumber?: string | null
  idempotencyKey?: string | null
  override?: { reasonCode: CreditOverrideReason; note?: string | null } | null
}

export interface CreditPostingResult {
  entry: CreditLedgerEntryRow
  profile: CreditProfileRow
}

/** Minimal shape settlement needs — the full ledger row satisfies it. */
export interface SettleableEntry {
  id: string
  kind: CreditEntryKind
  amountMinor: number
  occurredAt: Date
  createdAt: Date
  dueDate: string | null
}

export interface ChargeSettlement {
  entryId: string
  occurredAt: Date
  dueDate: string
  amountMinor: number
  outstandingMinor: number
}

export interface SettlementResult {
  charges: ChargeSettlement[]
  unappliedCreditMinor: number
}

export interface CreditProfileListRow {
  id: string
  customerId: string
  customerName: string
  customerPhone: string | null
  branchId: string
  branchCode: string
  branchName: string
  limitMinor: number
  hold: boolean
  paymentTermDays: number
  notes: string | null
  balanceMinor: number
  createdAt: Date
  updatedAt: Date
}

export interface CreditEntryListRow extends CreditLedgerEntryRow {
  branchCode: string
}

export interface CreditEntryListResult {
  entries: CreditEntryListRow[]
  total: number
  page: number
  pageSize: number
}

export interface CreditProfileListResult {
  profiles: CreditProfileListRow[]
}
