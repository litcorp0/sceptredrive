import type { branch } from '@gikautos/db/schema'
import type { BranchCodeSuggestion, BranchType } from '@gikautos/shared'
import type { z } from 'zod'
import type {
  branchCreateSchema,
  branchIdParamSchema,
  branchListQuerySchema,
  branchUpdateSchema,
  suggestCodeQuerySchema,
} from './branches.schema.ts'

export type BranchRow = typeof branch.$inferSelect

export type BranchIdParams = z.infer<typeof branchIdParamSchema>
export type BranchCreateBody = z.infer<typeof branchCreateSchema>
export type BranchUpdateBody = z.infer<typeof branchUpdateSchema>
export type BranchListQuery = z.infer<typeof branchListQuerySchema>
export type SuggestCodeQuery = z.infer<typeof suggestCodeQuerySchema>

export interface BranchListFilters {
  includeInactive: boolean
}

export interface BranchCreateInput {
  code: string
  name: string
  type: BranchType
  city: string
  area?: string | undefined
  address?: string | undefined
  phone?: string | undefined
}

export interface BranchUpdateInput {
  name?: string | undefined
  city?: string | undefined
  area?: string | undefined
  address?: string | undefined
  phone?: string | undefined
}

export interface SuggestCodeInput {
  city: string
  area?: string | undefined
  type: BranchType
}

export type SuggestCodeResult = BranchCodeSuggestion
