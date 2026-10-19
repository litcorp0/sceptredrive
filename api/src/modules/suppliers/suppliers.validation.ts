import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const supplierIdParamSchema = z.object({ id: z.uuid() })
export const supplierPaymentDetailParamSchema = z.object({ id: z.uuid(), detailId: z.uuid() })
export const supplierProductParamSchema = z.object({ id: z.uuid(), mappingId: z.uuid() })

const nameSchema = z.string().trim().min(1).max(120)
const phoneSchema = z.string().trim().min(6).max(20)
const labelSchema = z.string().trim().min(1).max(80)
const accountNumberSchema = z.string().trim().min(4).max(40)
const bankNameSchema = z.string().trim().min(1).max(120)
const bankCodeSchema = z.string().trim().min(1).max(40)
const supplierSkuSchema = z.string().trim().min(1).max(60)
const leadTimeSchema = z.number().int().min(0).max(365)
const termDaysSchema = z.number().int().min(0).max(365)

export const supplierCreateSchema = z
  .object({
    name: nameSchema,
    contactName: z.string().trim().min(1).max(120).optional(),
    phone: phoneSchema.optional(),
    email: z.email().max(160).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    tin: z.string().trim().min(1).max(40).optional(),
    vatNumber: z.string().trim().min(1).max(40).optional(),
    paymentTermDays: termDaysSchema.optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()

export const supplierUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    contactName: z.string().trim().min(1).max(120).nullish(),
    phone: phoneSchema.nullish(),
    email: z.email().max(160).nullish(),
    address: z.string().trim().max(300).nullish(),
    tin: z.string().trim().max(40).nullish(),
    vatNumber: z.string().trim().max(40).nullish(),
    paymentTermDays: termDaysSchema.optional(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  })

export const supplierListQuerySchema = z.object({
  q: z.string().trim().min(2).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const supplierNoteSchema = z
  .object({ note: z.string().trim().min(1).max(300).optional() })
  .strict()

/** BANK details require the bank fields; MOMO details require network + phone. */
export const supplierBankDetailSchema = z
  .object({
    method: z.literal('BANK'),
    label: labelSchema.optional(),
    accountName: z.string().trim().min(1).max(120),
    accountNumber: accountNumberSchema,
    bankName: bankNameSchema,
    bankCode: bankCodeSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()

export const supplierMomoDetailSchema = z
  .object({
    method: z.literal('MOMO'),
    label: labelSchema.optional(),
    accountName: z.string().trim().min(1).max(120).optional(),
    momoNetwork: z.enum(['MTN', 'VOD', 'ATL']),
    phone: phoneSchema,
    isDefault: z.boolean().optional(),
  })
  .strict()

export const supplierPaymentDetailCreateSchema = z.discriminatedUnion('method', [
  supplierBankDetailSchema,
  supplierMomoDetailSchema,
])

export const supplierPaymentDetailUpdateSchema = z
  .object({
    label: labelSchema.nullish(),
    accountName: z.string().trim().min(1).max(120).optional(),
    accountNumber: accountNumberSchema.optional(),
    bankName: bankNameSchema.nullish(),
    bankCode: z.string().trim().max(40).nullish(),
    momoNetwork: z.enum(['MTN', 'VOD', 'ATL']).optional(),
    phone: phoneSchema.optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  })

export const supplierProductCreateSchema = z
  .object({
    productId: z.uuid(),
    supplierSku: supplierSkuSchema.optional(),
    leadTimeDays: leadTimeSchema.optional(),
    isPreferred: z.boolean().optional(),
  })
  .strict()

export const supplierProductUpdateSchema = z
  .object({
    supplierSku: supplierSkuSchema.nullish(),
    leadTimeDays: leadTimeSchema.nullish(),
    isPreferred: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  })

export const validateSupplierIdParam = validateParam(supplierIdParamSchema)
export const validateSupplierPaymentDetailParam = validateParam(supplierPaymentDetailParamSchema)
export const validateSupplierProductParam = validateParam(supplierProductParamSchema)
export const validateSupplierCreate = validateJson(supplierCreateSchema)
export const validateSupplierUpdate = validateJson(supplierUpdateSchema)
export const validateSupplierListQuery = validateQuery(supplierListQuerySchema)
export const validateSupplierNote = validateJson(supplierNoteSchema)
export const validateSupplierPaymentDetailCreate = validateJson(supplierPaymentDetailCreateSchema)
export const validateSupplierPaymentDetailUpdate = validateJson(supplierPaymentDetailUpdateSchema)
export const validateSupplierProductCreate = validateJson(supplierProductCreateSchema)
export const validateSupplierProductUpdate = validateJson(supplierProductUpdateSchema)
