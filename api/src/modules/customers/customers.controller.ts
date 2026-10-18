import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as customersService from './customers.service.ts'
import type {
  CustomerCreateBody,
  CustomerListQuery,
  CustomerNoteBody,
  CustomerUpdateBody,
} from './customers.types.ts'

export async function listCustomers(c: Context<AppEnv>, query: CustomerListQuery) {
  const user = currentUser(c)
  const result = await customersService.searchCustomers(user, query)
  return c.json(result)
}

export async function createCustomer(c: Context<AppEnv>, input: CustomerCreateBody) {
  const actor = actorFromContext(c)
  const user = currentUser(c)
  const customer = await customersService.createCustomer(actor, user, input)
  return c.json({ customer }, 201)
}

export async function getCustomer(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const detail = await customersService.getCustomer(user, id)
  return c.json(detail)
}

export async function updateCustomer(c: Context<AppEnv>, id: string, input: CustomerUpdateBody) {
  const actor = actorFromContext(c)
  const customer = await customersService.updateCustomer(actor, id, input)
  return c.json({ customer })
}

export async function archiveCustomer(c: Context<AppEnv>, id: string, input: CustomerNoteBody) {
  const actor = actorFromContext(c)
  const customer = await customersService.archiveCustomer(actor, id, input.note)
  return c.json({ customer })
}

export async function reactivateCustomer(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const customer = await customersService.reactivateCustomer(actor, id)
  return c.json({ customer })
}

export async function anonymizeCustomer(c: Context<AppEnv>, id: string, input: CustomerNoteBody) {
  const actor = actorFromContext(c)
  const customer = await customersService.anonymizeCustomer(actor, id, input.note)
  return c.json({ customer })
}
