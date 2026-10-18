import type { z } from 'zod'
import type { customer } from './customers.schema.ts'
import type {
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
} from './customers.validation.ts'

export type CustomerRow = typeof customer.$inferSelect
export type CustomerStatus = CustomerRow['status']

export type CustomerCreateBody = z.infer<typeof customerCreateSchema>
export type CustomerUpdateBody = z.infer<typeof customerUpdateSchema>
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>

/** Internal search filters derived from the query plus caller scoping. */
export interface CustomerSearchFilters {
  nameLike: string | null
  phoneExact: string | null
  phoneDigits: string | null
  branchId: string | null
  includeArchived: boolean
  limit: number
  offset: number
}

export interface CustomerListRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  status: CustomerStatus
  anonymizedAt: Date | null
  createdBranchId: string
  createdBranchCode: string
  createdBranchName: string
  createdAt: Date
  updatedAt: Date
}

export interface CustomerCreditProfileRow {
  id: string
  branchId: string
  branchCode: string
  branchName: string
  limitMinor: number
  hold: boolean
  paymentTermDays: number
  balanceMinor: number
}

export interface CustomerDetail {
  customer: CustomerListRow
  creditProfiles: CustomerCreditProfileRow[]
  loyalty: { accountId: string; balancePoints: number } | null
}

export interface CustomerSearchResult {
  customers: CustomerListRow[]
  total: number
  page: number
  pageSize: number
}
