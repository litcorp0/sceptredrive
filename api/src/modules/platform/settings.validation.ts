import { z } from 'zod'
import { env } from '../../config/env.ts'
import { validateJson, validateQuery } from '../../http/validation.ts'

export const SETTING_DEFINITIONS = {
  'staff.idPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: env.STAFF_ID_PREFIX,
    branchScoped: false,
  },
  'staff.idSequence': {
    schema: z.number().int().positive(),
    defaultValue: env.STAFF_ID_START,
    branchScoped: false,
  },
  'receipt.header': {
    schema: z.string().trim().min(1).max(200),
    defaultValue: 'Thank you for shopping at GikAutos',
    branchScoped: true,
  },
  'loyalty.earnPointsPerCedi': {
    schema: z.number().int().min(1),
    defaultValue: 1,
    branchScoped: false,
  },
  'loyalty.pointsPerCedi': {
    schema: z.number().positive(),
    defaultValue: 100,
    branchScoped: false,
  },
  'loyalty.expiryMonths': {
    schema: z.number().int().positive(),
    defaultValue: 12,
    branchScoped: false,
  },
  'loyalty.minimumRedeemPoints': {
    schema: z.number().int().min(1),
    defaultValue: 100,
    branchScoped: false,
  },
  'credit.repaymentPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'REP',
    branchScoped: false,
  },
  'credit.repaymentSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'catalog.skuPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'GIK',
    branchScoped: false,
  },
  'catalog.skuSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'pricing.taxMode': {
    schema: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
    defaultValue: 'INCLUSIVE',
    branchScoped: false,
  },
  'inventory.receiptPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'GRN',
    branchScoped: false,
  },
  'inventory.receiptSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'inventory.transferPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'TRF',
    branchScoped: false,
  },
  'inventory.transferSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'inventory.countPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'CNT',
    branchScoped: false,
  },
  'inventory.countSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
} as const

export type SettingKey = keyof typeof SETTING_DEFINITIONS

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, value)
}

export const settingsListQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const settingsUpdateSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    value: z.unknown(),
    branchId: z.uuid().nullish(),
  })
  .strict()

export const validateSettingsListQuery = validateQuery(settingsListQuerySchema)
export const validateSettingsUpdate = validateJson(settingsUpdateSchema)
