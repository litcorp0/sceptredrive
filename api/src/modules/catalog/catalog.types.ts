import type { z } from 'zod'
import type { brand, category, uom } from './catalog.schema.ts'
import type {
  brandCreateSchema,
  brandUpdateSchema,
  catalogListQuerySchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  uomCreateSchema,
  uomUpdateSchema,
} from './catalog.validation.ts'

export type CategoryRow = typeof category.$inferSelect
export type BrandRow = typeof brand.$inferSelect
export type UomRow = typeof uom.$inferSelect

export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>
export type CategoryCreateBody = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateBody = z.infer<typeof categoryUpdateSchema>
export type BrandCreateBody = z.infer<typeof brandCreateSchema>
export type BrandUpdateBody = z.infer<typeof brandUpdateSchema>
export type UomCreateBody = z.infer<typeof uomCreateSchema>
export type UomUpdateBody = z.infer<typeof uomUpdateSchema>

export interface CategoryCreateInput {
  name: string
  parentId?: string | null | undefined
}

export interface CategoryUpdateInput {
  name?: string | undefined
  parentId?: string | null | undefined
}

export interface BrandCreateInput {
  name: string
}

export interface BrandUpdateInput {
  name: string
}

export interface UomCreateInput {
  code: string
  name: string
}

export interface UomUpdateInput {
  name: string
}

export interface CategoryWithChildren extends CategoryRow {
  children: CategoryRow[]
}
