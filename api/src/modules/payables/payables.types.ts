import type { z } from 'zod'
import type {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from './payables.schema.ts'
import type {
  agingQuerySchema,
  balancesQuerySchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoiceVoidSchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  paymentVoidSchema,
} from './payables.validation.ts'

export type SupplierInvoiceRow = typeof supplierInvoice.$inferSelect
export type SupplierInvoiceLineRow = typeof supplierInvoiceLine.$inferSelect
export type SupplierPaymentRow = typeof supplierPayment.$inferSelect
export type SupplierPaymentAllocationRow = typeof supplierPaymentAllocation.$inferSelect

export type InvoiceStatus = SupplierInvoiceRow['status']
export type InvoiceVoidReason = NonNullable<SupplierInvoiceRow['voidReason']>
export type PaymentMethod = SupplierPaymentRow['method']
export type AllocationKind = SupplierPaymentAllocationRow['kind']

export type InvoiceCreateBody = z.infer<typeof invoiceCreateSchema>
export type InvoiceVoidBody = z.infer<typeof invoiceVoidSchema>
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>
export type PaymentCreateBody = z.infer<typeof paymentCreateSchema>
export type PaymentVoidBody = z.infer<typeof paymentVoidSchema>
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>
export type BalancesQuery = z.infer<typeof balancesQuerySchema>
export type AgingQuery = z.infer<typeof agingQuerySchema>
export type PaymentVoidReason = NonNullable<SupplierPaymentRow['voidReason']>
export type InvoiceLineInput = InvoiceCreateBody['lines'] extends (infer T)[] | undefined
  ? T
  : never

/** Internal list filters derived from the query plus caller scoping. */
export interface InvoiceListFilters {
  supplierId: string | null
  branchId: string | null
  receiptId: string | null
  status: InvoiceStatus | null
  overdue: boolean
  /** Only invoices with at least one purchase-order variance. */
  variance?: boolean
  /** ISO date (YYYY-MM-DD) used as the overdue cut-off. */
  asOfDate: string
  from: string | null
  to: string | null
  limit: number
  offset: number
}

export interface InvoiceListRow {
  id: string
  number: string
  supplierId: string
  supplierCode: string
  supplierName: string
  branchId: string
  branchCode: string
  branchName: string
  supplierInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  receiptId: string | null
  purchaseOrderId: string | null
  purchaseOrderNumber: string | null
  hasVariance: boolean
  subtotalMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  totalMinor: number
  amountPaidMinor: number
  outstandingMinor: number
  status: InvoiceStatus
  createdAt: Date
}

export interface InvoiceLineView {
  id: string
  productId: string | null
  sku: string | null
  productName: string | null
  description: string | null
  quantity: number
  unitCostMinor: number
  lineTotalMinor: number
}

export interface InvoiceAllocationRow {
  id: string
  paymentId: string
  paymentNumber: string
  method: PaymentMethod
  paymentStatus: SupplierPaymentRow['status']
  paidAt: Date
  kind: AllocationKind
  amountMinor: number
  reversesAllocationId: string | null
  note: string | null
  createdAt: Date
}

export interface InvoiceSupplierSummary {
  id: string
  code: string
  name: string
}

export interface InvoiceReceiptSummary {
  id: string
  number: string
  branchId: string
}

export interface InvoiceMatchLine {
  lineNumber: number
  productId: string | null
  sku: string
  name: string
  invoicedQuantity: number
  invoicedUnitCostMinor: number
  orderedQuantity: number | null
  orderedUnitCostMinor: number | null
  receivedQuantity: number
  previouslyInvoicedQuantity: number
  matchStatus: (typeof supplierInvoiceLine.$inferSelect)['matchStatus']
}

export interface InvoiceMatch {
  purchaseOrderId: string
  orderNumber: string
  status: (typeof supplierInvoiceLine.$inferSelect)['matchStatus']
  lines: InvoiceMatchLine[]
}

export interface InvoiceDetail {
  invoice: SupplierInvoiceRow & { outstandingMinor: number }
  supplier: InvoiceSupplierSummary
  receipt: InvoiceReceiptSummary | null
  lines: InvoiceLineView[]
  allocations: InvoiceAllocationRow[]
  match: InvoiceMatch | null
}

export interface InvoiceListResult {
  invoices: InvoiceListRow[]
  total: number
  branchId: string | null
}

export interface InvoiceDetailHeader {
  invoice: SupplierInvoiceRow
  supplier: InvoiceSupplierSummary
  receipt: InvoiceReceiptSummary | null
}

export interface InvoiceCreateResult {
  invoice: InvoiceDetail
  replayed: boolean
}

export interface PaymentDetailHeader {
  payment: SupplierPaymentRow
  supplier: InvoiceSupplierSummary
}

/** Payment row enriched with its allocated total (Plan 04 surfaces). */
export interface PaymentListRow extends SupplierPaymentRow {
  supplierCode: string
  supplierName: string
  branchCode: string
  branchName: string
  allocatedMinor: number
  unallocatedMinor: number
}

export interface PaymentAllocationView {
  id: string
  invoiceId: string
  invoiceNumber: string
  supplierInvoiceNumber: string
  invoiceBranchId: string
  kind: AllocationKind
  amountMinor: number
  reversesAllocationId: string | null
  createdAt: Date
}

export interface PaymentDetail {
  payment: SupplierPaymentRow
  supplier: InvoiceSupplierSummary
  allocations: PaymentAllocationView[]
  allocatedMinor: number
  unallocatedMinor: number
}

export interface PaymentCreateResult {
  payment: PaymentDetail
  replayed: boolean
}

export interface PaymentListFilters {
  supplierId: string | null
  branchId: string | null
  method: PaymentMethod | null
  status: SupplierPaymentRow['status'] | null
  from: Date | null
  to: Date | null
  limit: number
  offset: number
}

export interface PaymentListResult {
  payments: PaymentListRow[]
  total: number
  branchId: string | null
}

/** A supplier's payable position: invoices outstanding minus on-account credit. */
export interface SupplierBalanceRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  branchId: string | null
  invoiceOutstandingMinor: number
  onAccountMinor: number
  owedMinor: number
  overdueMinor: number
  invoiceCount: number
}

export interface SupplierBalanceResult {
  balances: SupplierBalanceRow[]
  branchId: string | null
}

export type AgingBucketKey = 'current' | 'days1To30' | 'days31To60' | 'days61To90' | 'over90'

export type AgingBuckets = Record<AgingBucketKey, number>

export interface PayableAgingInvoiceRow {
  invoiceId: string
  number: string
  supplierInvoiceNumber: string
  dueDate: string
  outstandingMinor: number
  daysPastDue: number
  bucket: AgingBucketKey
}

export interface PayableAgingSupplierRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  buckets: AgingBuckets
  totalOutstandingMinor: number
  onAccountMinor: number
  invoices: PayableAgingInvoiceRow[]
}

export interface PayablesAgingResult {
  asOf: string
  branchId: string | null
  suppliers: PayableAgingSupplierRow[]
  totals: AgingBuckets
  totalOutstandingMinor: number
  totalOnAccountMinor: number
}

export interface PayablesReconciliationResult {
  invoicesChecked: number
  suppliersChecked: number
}

/** Per-supplier invoice aggregates feeding the balances view. */
export interface SupplierOutstandingRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  outstandingMinor: number
  overdueMinor: number
  invoiceCount: number
}

/** Per-supplier on-account position: completed payments minus their allocations. */
export interface SupplierOnAccountRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  onAccountMinor: number
}

/** Outstanding invoice joined to its supplier, for the aging report. */
export interface PayableAgingInvoiceSourceRow {
  invoiceId: string
  number: string
  supplierInvoiceNumber: string
  dueDate: string
  outstandingMinor: number
  supplierId: string
  supplierCode: string
  supplierName: string
}

/** Invoice row plus its signed allocation sum, for reconciliation. */
export interface InvoiceReconciliationRow {
  id: string
  number: string
  status: InvoiceStatus
  totalMinor: number
  amountPaidMinor: number
  netAllocatedMinor: number
}
