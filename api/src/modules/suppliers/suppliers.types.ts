import type { z } from 'zod'
import type { supplier, supplierPaymentDetail, supplierProduct } from './suppliers.schema.ts'
import type {
  supplierCreateSchema,
  supplierListQuerySchema,
  supplierPaymentDetailCreateSchema,
  supplierPaymentDetailUpdateSchema,
  supplierProductCreateSchema,
  supplierProductUpdateSchema,
  supplierUpdateSchema,
} from './suppliers.validation.ts'

export type SupplierRow = typeof supplier.$inferSelect
export type SupplierStatus = SupplierRow['status']
export type SupplierPaymentDetailRow = typeof supplierPaymentDetail.$inferSelect
export type SupplierProductRow = typeof supplierProduct.$inferSelect

export type SupplierCreateBody = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateBody = z.infer<typeof supplierUpdateSchema>
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>
export type PaymentDetailCreateBody = z.infer<typeof supplierPaymentDetailCreateSchema>
export type PaymentDetailUpdateBody = z.infer<typeof supplierPaymentDetailUpdateSchema>
export type SupplierProductCreateBody = z.infer<typeof supplierProductCreateSchema>
export type SupplierProductUpdateBody = z.infer<typeof supplierProductUpdateSchema>

/** Internal search filters derived from the query plus caller scoping. */
export interface SupplierSearchFilters {
  q: string | null
  includeArchived: boolean
  limit: number
  offset: number
}

export interface SupplierListRow {
  id: string
  code: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  paymentTermDays: number
  status: SupplierStatus
  createdAt: Date
  updatedAt: Date
}

/**
 * Payment detail as returned by the API. `accountNumber` is raw only on the
 * owning supplier-detail payload; list responses carry `accountNumberMasked`.
 */
export interface SupplierPaymentDetailView {
  id: string
  method: 'BANK' | 'MOMO'
  label: string | null
  accountName: string | null
  accountNumber: string | null
  accountNumberMasked: string | null
  bankName: string | null
  bankCode: string | null
  momoNetwork: 'MTN' | 'VOD' | 'ATL' | null
  phone: string | null
  isDefault: boolean
  isActive: boolean
  /** A Paystack recipient exists for this destination (P14-D27). The code is never exposed. */
  recipientReady: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SupplierProductView {
  id: string
  supplierId: string
  productId: string
  productSku: string
  productName: string
  supplierSku: string | null
  leadTimeDays: number | null
  lastCostMinor: number
  lastCostAt: Date | null
  isPreferred: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SupplierDetail {
  supplier: SupplierRow
  paymentDetails: SupplierPaymentDetailView[]
  products: SupplierProductView[]
}

export interface SupplierSearchResult {
  suppliers: SupplierListRow[]
  total: number
  page: number
  pageSize: number
}
