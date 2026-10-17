import type { device, terminal } from '@gikautos/db/schema'
import type { z } from 'zod'
import type {
  terminalCreateSchema,
  terminalIdParamSchema,
  terminalListQuerySchema,
  terminalUpdateSchema,
} from './terminals.schema.ts'

export type TerminalRow = typeof terminal.$inferSelect
export type DeviceRow = typeof device.$inferSelect

export type TerminalIdParams = z.infer<typeof terminalIdParamSchema>
export type TerminalCreateBody = z.infer<typeof terminalCreateSchema>
export type TerminalUpdateBody = z.infer<typeof terminalUpdateSchema>
export type TerminalListQuery = z.infer<typeof terminalListQuerySchema>

export interface TerminalCreateInput {
  branchId: string
  name: string
}

export interface TerminalUpdateInput {
  name?: string | undefined
  isActive?: boolean | undefined
}

export interface TerminalListFilters {
  branchId?: string | undefined
  includeInactive: boolean
}
