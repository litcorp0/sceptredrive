import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as suppliersService from './suppliers.service.ts'
import type {
  PaymentDetailCreateBody,
  PaymentDetailUpdateBody,
  SupplierCreateBody,
  SupplierListQuery,
  SupplierProductCreateBody,
  SupplierProductUpdateBody,
  SupplierUpdateBody,
} from './suppliers.types.ts'

export async function listSuppliers(c: Context<AppEnv>, query: SupplierListQuery) {
  const user = currentUser(c)
  const result = await suppliersService.listSuppliers(user, query)
  return c.json(result)
}

export async function createSupplier(c: Context<AppEnv>, input: SupplierCreateBody) {
  const actor = actorFromContext(c)
  const supplier = await suppliersService.createSupplier(actor, input)
  return c.json({ supplier }, 201)
}

export async function getSupplier(c: Context<AppEnv>, id: string) {
  const detail = await suppliersService.getSupplierDetail(id)
  return c.json(detail)
}

export async function updateSupplier(c: Context<AppEnv>, id: string, input: SupplierUpdateBody) {
  const actor = actorFromContext(c)
  const supplier = await suppliersService.updateSupplier(actor, id, input)
  return c.json({ supplier })
}

export async function archiveSupplier(
  c: Context<AppEnv>,
  id: string,
  input: { note?: string | undefined },
) {
  const actor = actorFromContext(c)
  const supplier = await suppliersService.archiveSupplier(actor, id, input.note)
  return c.json({ supplier })
}

export async function reactivateSupplier(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const supplier = await suppliersService.reactivateSupplier(actor, id)
  return c.json({ supplier })
}

export async function addPaymentDetail(
  c: Context<AppEnv>,
  id: string,
  input: PaymentDetailCreateBody,
) {
  const actor = actorFromContext(c)
  const paymentDetail = await suppliersService.addPaymentDetail(actor, id, input)
  return c.json({ paymentDetail }, 201)
}

export async function updatePaymentDetail(
  c: Context<AppEnv>,
  id: string,
  detailId: string,
  input: PaymentDetailUpdateBody,
) {
  const actor = actorFromContext(c)
  const paymentDetail = await suppliersService.updatePaymentDetail(actor, id, detailId, input)
  return c.json({ paymentDetail })
}

export async function addSupplierProduct(
  c: Context<AppEnv>,
  id: string,
  input: SupplierProductCreateBody,
) {
  const actor = actorFromContext(c)
  const mapping = await suppliersService.addSupplierProduct(actor, id, input)
  return c.json({ mapping }, 201)
}

export async function updateSupplierProduct(
  c: Context<AppEnv>,
  id: string,
  mappingId: string,
  input: SupplierProductUpdateBody,
) {
  const actor = actorFromContext(c)
  const mapping = await suppliersService.updateSupplierProduct(actor, id, mappingId, input)
  return c.json({ mapping })
}

export async function removeSupplierProduct(c: Context<AppEnv>, id: string, mappingId: string) {
  const actor = actorFromContext(c)
  await suppliersService.removeSupplierProduct(actor, id, mappingId)
  return c.body(null, 204)
}
