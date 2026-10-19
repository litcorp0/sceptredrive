import type { z } from 'zod'
import type {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from './payables.schema.ts'
import type {
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoiceVoidSchema,
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
export type InvoiceLineInput = InvoiceCreateBody['lines'] extends (infer T)[] | undefined
  ? T
  : never

/** Internal list filters derived from the query plus caller scoping. */
export interface InvoiceListFilters {
  supplierId: string | null
  branchId: string | null
  status: InvoiceStatus | null
  overdue: boolean
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

export interface InvoiceDetail {
  invoice: SupplierInvoiceRow & { outstandingMinor: number }
  supplier: InvoiceSupplierSummary
  receipt: InvoiceReceiptSummary | null
  lines: InvoiceLineView[]
  allocations: InvoiceAllocationRow[]
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

/** Payment row enriched with its allocated total (Plan 04 surfaces). */
export interface PaymentListRow extends SupplierPaymentRow {
  allocatedMinor: number
  unallocatedMinor: number
}
