import { ROLES } from '@gikautos/shared'
import { z } from 'zod'

// Better Auth user IDs are opaque 32-char strings, not UUIDs.
export const staffIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
})

export const createStaffSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    branchId: z.uuid().nullish(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    role: z.enum(ROLES).optional(),
    branchId: z.uuid().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })

export const staffListQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  branchId: z.uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(128),
  })
  .strict()
