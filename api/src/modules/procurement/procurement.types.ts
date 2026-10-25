import type { PurchaseOrderAction, PurchaseOrderStatus } from '@sceptre/shared'
import type { approval } from '../approvals/approvals.schema.ts'
import type { purchaseOrder } from './procurement.schema.ts'

export type OrderRow = typeof purchaseOrder.$inferSelect

export interface OrderLineInput {
  productId: string
  quantity: number
  unitCostMinor: number
}

export interface OrderCreateBody {
  branchId: string
  supplierId: string
  expectedDate?: string
  note?: string
  idempotencyKey: string
  lines: OrderLineInput[]
}

export interface OrderUpdateBody {
  supplierId?: string
  expectedDate?: string | null
  note?: string | null
  lines?: OrderLineInput[]
}

export interface OrderListQuery {
  branchId?: string | null
  supplierId?: string
  status?: PurchaseOrderStatus
  q?: string
  limit: number
  offset: number
}

export interface OrderLineView {
  id: string
  lineNumber: number
  productId: string
  sku: string
  name: string
  quantity: number
  unitCostMinor: number
  lineTotalMinor: number
  receivedQuantity: number
  outstandingQuantity: number
}

export interface OrderApprovalSummary {
  id: string
  status: (typeof approval.$inferSelect)['status']
  requestedBy: string
  decidedBy: string | null
  decidedAt: Date | null
  decisionReasonCode: (typeof approval.$inferSelect)['decisionReasonCode']
}

/**
 * `canApply` is computed server-side from the shared transition table and the
 * actor's permissions, so the console never re-derives a lifecycle rule.
 */
export interface OrderCapabilities {
  submit: boolean
  send: boolean
  receive: boolean
  close: boolean
  cancel: boolean
}

export interface OrderDetail {
  order: OrderRow & { supplierName: string; supplierCode: string }
  lines: OrderLineView[]
  goodsValueMinor: number
  threshold: { valueMinor: number; source: 'branch' | 'global' | 'default' }
  approval: OrderApprovalSummary | null
  canApply: Record<PurchaseOrderAction, boolean>
}

export interface OrderListRow {
  id: string
  number: string
  status: PurchaseOrderStatus
  supplierId: string
  supplierName: string
  branchId: string
  branchCode: string
  expectedDate: string | null
  goodsValueMinor: number
  receivedQuantity: number
  orderedQuantity: number
  createdAt: Date
}

export interface OrderList {
  orders: OrderListRow[]
  total: number
  branchId: string | null
}

export interface OrderActionBody {
  note?: string
}

export interface OrderCancelBody {
  reason: string
}

export type OverReceiptReason = 'SUPPLIER_SENT_MORE' | 'ORDER_ROUNDING' | 'SUBSTITUTE' | 'OTHER'

export interface ReceiveLineBody {
  purchaseOrderLineId: string
  quantity: number
  unitCostMinor: number
  overReceiptReason?: OverReceiptReason
  overReceiptNote?: string
}

export interface ReceiveOrderBody {
  idempotencyKey: string
  supplierInvoiceNumber?: string
  note?: string
  lines: ReceiveLineBody[]
}

export interface ReturnLineBody {
  receiptLineId: string
  quantity: number
}

export interface ReturnCreateBody {
  branchId: string
  supplierId: string
  purchaseOrderId?: string
  receiptId?: string
  reason: string
  note?: string
  supplierCreditNoteNumber?: string
  idempotencyKey: string
  lines: ReturnLineBody[]
}

export interface ReturnLineView {
  id: string
  receiptLineId: string
  receiptNumber: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitCostMinor: number
  lineCreditMinor: number
  receivedQuantity: number
}

export interface ReturnDetail {
  supplierReturn: OrderReturnRow
  supplierName: string
  lines: ReturnLineView[]
  creditNote: { number: string; amountMinor: number; postedAt: Date } | null
  totalCreditMinor: number
  canPost: boolean
  canCancel: boolean
}

export type OrderReturnRow = typeof import('./procurement.schema.ts').supplierReturn.$inferSelect

export interface ReturnListQuery {
  branchId?: string | null
  supplierId?: string
  status?: 'DRAFT' | 'POSTED' | 'CANCELLED'
  limit: number
  offset: number
}

export interface ReturnList {
  returns: (OrderReturnRow & { supplierName: string; creditMinor: number | null })[]
  total: number
  branchId: string | null
}
