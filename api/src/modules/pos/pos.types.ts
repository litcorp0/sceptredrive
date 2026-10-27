import type {
  CartVoidReason,
  ConflictResolutionCode,
  RefundReason,
  RefundRestock,
  Role,
  TenderMethod,
} from '@sceptre/shared'
import type { ApprovalSubject } from '../approvals/approvals.types.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'

/** The staff identity a terminal may bind to, with the columns needed to verify a PIN. */
export interface DeviceStaffRecord {
  userId: string
  staffId: string
  name: string
  role: Role
  branchId: string | null
  isActive: boolean
  pinHash: string | null
  pinVersion: number
  pinMustChange: boolean
}

export interface BindingStaff {
  userId: string
  staffId: string
  name: string
  role: Role
}

/** Returned exactly once, when a binding is created or replaced. */
export interface StaffBindingResult {
  bindingId: string
  bindingToken: string
  expiresAt: string
  staff: BindingStaff
  pinVersion: number
  mustChangePin: boolean
}

/** Answer to the boot-time binding check. Never carries a credential. */
export interface BindingValidationResult {
  valid: boolean
  staff: BindingStaff | null
  pinVersion: number | null
  mustChangePin: boolean
  bindingId: string | null
}

// --- Shift lifecycle (Plan 05's upload dispatcher calls these) ---------------

export interface ShiftOpenPayload {
  shiftId: string
  number: string
  openingFloatMinor: number
  cashierUserId: string
  cashierStaffId: string
  occurredAt: string
}

export interface CashMovementPayload {
  id: string
  shiftId: string
  type: 'CASH_IN' | 'CASH_OUT'
  amountMinor: number
  reason: string
  occurredAt: string
  staffUserId: string
  staffStaffId: string
}

export interface ShiftClosePayload {
  shiftId: string
  countedCashMinor: number
  clientExpectedCashMinor: number
  closeNote?: string | undefined
  occurredAt: string
}

export interface ShiftApplyResult {
  shiftId: string
  serverExpectedCashMinor?: number
  varianceMinor?: number
  conflictId?: string
}

/**
 * The `shift_variance` subject the review detail returns. It is the shared arm,
 * not a second shape: the console reads the same contract for every request type.
 */
export type ShiftVarianceSubject = Extract<ApprovalSubject, { kind: 'shift_variance' }>

/** Everything needed to compute a shift's expected cash at the server. */
export interface ShiftCashTotals {
  openingFloatMinor: number
  cashTendersMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
  /**
   * Settled `CASH` refund tenders of **this** shift — money that physically left
   * this drawer. A refund counts against the shift it was settled in, not the
   * sale's: a refund outlives the sale's shift, and only a settled cash tender
   * moved the notes.
   */
  cashRefundsMinor: number
}

// --- Offline sale payload (Plan 06/07 produce this; the uploader ships it) ----

/** A manager approval captured on the terminal (D22). Never contains a PIN. */
export interface OverrideProof {
  staffId: string
  userId: string
  bindingId: string
  pinVersion: number
  /** Plan 06 labels or the credit enum values; normalized server-side. */
  reasonCode: string
  note?: string | null
  occurredAt: string
}

export interface SaleCashier {
  userId: string
  staffId: string
  bindingId: string
  /** Returned once at authorization; hashed before lookup, never logged. */
  bindingToken: string
  pinVersion: number
}

export interface SaleCustomerPayload {
  id: string
  phone: string
  name?: string | undefined
}

export interface SaleLinePayload {
  productId: string
  quantity: number
  unitPriceMinor: number
  lineDiscountMinor: number
  taxCategory: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
}

export interface SaleDiscountPayload {
  amountMinor: number
  reasonCode: 'STAFF' | 'DAMAGE' | 'PROMO' | 'OTHER'
  note?: string | null
  override?: OverrideProof | null
}

export interface SaleLoyaltyPayload {
  redeemPoints: number
  /** The terminal's earn preview; a difference is a rate-change conflict. */
  earnPreviewPoints: number
}

export interface SaleTenderPayload {
  method: TenderMethod
  /** Cash: the amount handed over (change included). Credit: the credit portion. */
  amountMinor: number
  /** Required for MOMO | CARD | BANK_TRANSFER; the server settles it before the sale. */
  paymentId?: string | null
  override?: OverrideProof | null
}

export interface SaleTotalsPayload {
  subtotalMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  changeMinor: number
}

export interface SalePayload {
  receiptNumber: string
  shiftId: string
  cashier: SaleCashier
  customer?: SaleCustomerPayload | null
  lines: SaleLinePayload[]
  saleDiscount?: SaleDiscountPayload | null
  loyalty?: SaleLoyaltyPayload | null
  tenders: SaleTenderPayload[]
  totals: SaleTotalsPayload
  occurredAt: string
  appVersion?: string | null
}

export type SyncConflictType =
  | 'STOCK_OVERSELL'
  | 'CREDIT_OVER_LIMIT'
  | 'CREDIT_HOLD'
  | 'LOYALTY_NEGATIVE'
  | 'LOYALTY_RATE_CHANGED'
  | 'PRICE_MISMATCH'
  | 'TOTAL_MISMATCH'
  | 'SHIFT_VARIANCE_MISMATCH'
  | 'STALE_CREDENTIALS'
  | 'OVERRIDE_INVALID'
  | 'DUPLICATE_CUSTOMER'
  | 'CLOCK_SKEW'
  | 'INVALID_CUSTOMER'
  | 'UNKNOWN_PRODUCT'
  // Phase 13: a payment that settled after the till gave up, and one whose
  // provider amount does not match ours. Kept in step with `sync_conflict_type`.
  | 'PAYMENT_LATE_SETTLEMENT'
  | 'PAYMENT_AMOUNT_MISMATCH'

export type SyncConflictSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface AppliedConflict {
  id: string
  type: SyncConflictType
  severity: SyncConflictSeverity
}

export interface SaleApplyResult {
  saleId: string
  conflicts: AppliedConflict[]
  resolvedCustomerId: string | null
}

/** Context the upload dispatcher owns (one client transaction, one sale). */
export interface SaleContext {
  clientTransactionId: string
  device: DeviceAuthContext
  /** Server clock at receipt; written beside the device's `occurredAt`. */
  receivedAt: Date
  clockSkewToleranceMinutes: number
}

// --- Shift reports (Phase 13-07, extracted for the session gate in 14-03) ----

/**
 * One shape for both reports (P13-D32, P13-D33), because a manager comparing a
 * mid-shift X with the night's Z should be comparing the same fields in the same
 * units. `Z` is the stored snapshot; `X` is the same arithmetic asked live.
 */
export interface ShiftReportView {
  kind: 'X' | 'Z'
  shiftId: string
  number: string
  branchId: string
  terminalId: string
  deviceId: string
  openedAt: string
  /** Null on an X-report for a shift that is still open. */
  closedAt: string | null
  openingFloatMinor: number
  saleCount: number
  itemCount: number
  refundCount: number
  voidCount: number
  grossMinor: number
  refundMinor: number
  netMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  loyaltyRedeemPoints: number
  loyaltyEarnedPoints: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  cashMinor: number
  creditMinor: number
  momoMinor: number
  cardMinor: number
  bankTransferMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
  expectedCashMinor: number
  /** The drawer, once someone has counted it (a Z always has; an X may not). */
  countedCashMinor: number | null
  varianceMinor: number | null
  generatedAt: string
}

/**
 * Who may read a shift's report. The **caller** proves the subject; this carries
 * the proof into the one arithmetic function (Plan 03 §5), so a device and a
 * session cannot read two different drawers.
 *
 * - `branchId: null` means an admin reading across branches.
 * - `terminalId` is set by the device route: a terminal may not read another
 *   terminal's shift, and that refusal has always been a 404.
 */
export interface ShiftReportScope {
  branchId: string | null
  terminalId?: string
}

// --- Oversight read models (Phase 14, Plan 03) ------------------------------

/**
 * A sale as a reviewer sees it in a list. It carries an **id** — the analytics
 * row does not, which is why that row cannot link — and `refundedMinor`, which
 * is summed in the statement rather than in the browser.
 *
 * `occurredAt` is the till's clock; `receivedAt` is when the upload landed, and
 * the difference is what `CLOCK_SKEW` and the upload-lag figures are about.
 */
export interface OversightSaleRow {
  id: string
  receiptNumber: string
  occurredAt: string
  branchId: string
  branchCode: string
  branchName: string
  terminalCode: string
  shiftId: string
  cashierName: string
  customerName: string | null
  itemsSold: number
  totalMinor: number
  taxTotalMinor: number
  changeMinor: number
  creditMinor: number
  conflictCount: number
  refundedMinor: number
}

/** One `sale_line`, exactly as the receipt prints it. Never re-derived. */
export interface OversightSaleLine {
  lineNumber: number
  productId: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unitPriceMinor: number
  expectedUnitPriceMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  netMinor: number
  taxableMinor: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  taxCategory: string
}

/** One `sale_tender`, in the order the customer paid. */
export interface OversightSaleTender {
  sequence: number
  method: TenderMethod
  amountMinor: number
  reference: string | null
}

/** A refund that names this sale; the oversight refund detail owns the rest. */
export interface OversightSaleRefundRef {
  id: string
  number: string
  refundedMinor: number
  occurredAt: string
}

/** A conflict that names this sale. Ids only: Plan 04 owns the queue. */
export interface OversightSaleConflictRef {
  id: string
  type: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED'
  resolutionCode: ConflictResolutionCode | null
}

/**
 * The header plus the three things a manager opens next: the lines, the money and
 * the documents that changed the sale afterwards.
 */
export interface OversightSaleDetail {
  sale: OversightSaleRow
  lines: OversightSaleLine[]
  tenders: OversightSaleTender[]
  refunds: OversightSaleRefundRef[]
  conflicts: OversightSaleConflictRef[]
}

/** GRA's certificate for a document, read from `evat_submission` (P14-D35). */
export interface ReceiptEvatBlock {
  providerInvoiceNumber: string | null
  sdcId: string | null
  serial: string | null
  signature: string | null
  internalData: string | null
  machineCode: string | null
  stampedAt: string | null
  qrPayload: string | null
}

/**
 * A server-rendered **copy** of a receipt (P14-D10). It is shaped like the till's
 * `ReceiptModel` but built from server columns, and it says it is a copy because
 * the server does not know the till's print status.
 *
 * The customer's phone is masked here, server-side: a client-side mask is a
 * disclosure with extra steps (P14-D11).
 */
export interface ReceiptCopy {
  header: {
    seller: string
    branch: string
    branchCode: string
    terminal: string
    receiptNumber: string
    occurredAt: string
    cashier: string
    customer: { name: string; phoneMasked: string } | null
    isCopy: true
    reprint: false
  }
  lines: OversightSaleLine[]
  /**
   * The sale's own columns, never a sum of the lines. `taxableMinor` is
   * `total − taxTotal`, exactly as the till derives it, because neither `sale`
   * nor the receipt contract has a taxable column.
   */
  totals: {
    subtotalMinor: number
    lineDiscountMinor: number
    saleDiscountMinor: number
    loyaltyDiscountMinor: number
    taxableMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    taxTotalMinor: number
    totalMinor: number
  }
  tenders: OversightSaleTender[]
  tenderedMinor: number
  changeMinor: number
  loyalty: { earnedPoints: number; redeemedPoints: number } | null
  footer: string
  evat: ReceiptEvatBlock | null
}

/** A refund as a reviewer sees it in a list. Any amount, above or below the threshold. */
export interface OversightRefundRow {
  id: string
  number: string
  occurredAt: string
  branchId: string
  branchCode: string
  branchName: string
  terminalCode: string
  saleId: string
  shiftId: string
  receiptNumber: string
  refundedMinor: number
  reasonCode: RefundReason
  tenderCount: number
  /**
   * A tender that has not settled — `PENDING`, `FAILED` or `NEEDS_ATTENTION`.
   * The name follows the plan; the predicate is "money that has not moved yet".
   */
  hasPendingTender: boolean
  approvalId: string | null
  approvedBy: string | null
  approvedByStaffId: string
}

/** One refunded unit, with the decision a reviewer has to be able to see. */
export interface OversightRefundLine {
  lineNumber: number
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPriceMinor: number
  restock: RefundRestock
  damageReason: string | null
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
}

/** Where the money went, including what the provider said when it did not. */
export interface OversightRefundTender {
  sequence: number
  method: TenderMethod
  amountMinor: number
  status: 'SETTLED' | 'PENDING' | 'FAILED' | 'NEEDS_ATTENTION'
  settledAt: string | null
  providerRefundReference: string | null
  failedMessage: string | null
}

export interface OversightRefundDetail {
  refund: OversightRefundRow & {
    note: string | null
    approvedAt: string
    baseMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    taxTotalMinor: number
  }
  lines: OversightRefundLine[]
  tenders: OversightRefundTender[]
}

/** A shift as a reviewer sees it in a list. */
export interface OversightShiftRow {
  id: string
  number: string
  status: 'OPEN' | 'CLOSED'
  reviewStatus: 'NONE' | 'REQUIRED' | 'REVIEWED'
  branchId: string
  branchCode: string
  branchName: string
  terminalCode: string
  cashierName: string
  openedAt: string
  closedAt: string | null
  openingFloatMinor: number
  serverExpectedCashMinor: number | null
  countedCashMinor: number | null
  varianceMinor: number | null
  hasReport: boolean
}

/**
 * A shift with the document that belongs to it.
 *
 * `reportState` says where the report came from: `STORED` (a closed shift's Z),
 * `LIVE` (an open shift's X) or `MISSING` (a closed shift that has no snapshot —
 * a fact the detail shows rather than a recomputation it invents, P14-D12).
 */
/** A cart abandoned before it became a sale (P13-D28). The only read path. */
export interface OversightVoidRow {
  id: string
  occurredAt: string
  reasonCode: CartVoidReason
  reasonLabel: string
  label: string | null
  itemCount: number
  grossMinor: number
  cashierName: string
}

/**
 * A shift's voids, with the totals a reviewer would otherwise add up by hand: how
 * many carts, how many items they held, and what they were worth at the till.
 */
export interface OversightVoidSummary {
  count: number
  itemCount: number
  grossMinor: number
  rows: OversightVoidRow[]
}

export interface OversightShiftDetail {
  shift: OversightShiftRow
  report: ShiftReportView | null
  reportState: 'STORED' | 'LIVE' | 'MISSING'
  voids: OversightVoidSummary
}

export interface OversightSalesList {
  sales: OversightSaleRow[]
  total: number
  limit: number
  offset: number
}

export interface OversightRefundsList {
  refunds: OversightRefundRow[]
  total: number
  limit: number
  offset: number
}

export interface OversightShiftsList {
  shifts: OversightShiftRow[]
  total: number
  limit: number
  offset: number
}
