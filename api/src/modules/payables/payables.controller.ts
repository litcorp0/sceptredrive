import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as payablesService from './payables.service.ts'
import type { InvoiceCreateBody, InvoiceListQuery, InvoiceVoidBody } from './payables.types.ts'

export async function listInvoices(c: Context<AppEnv>, query: InvoiceListQuery) {
  const user = currentUser(c)
  const result = await payablesService.listInvoices(user, query)
  return c.json(result)
}

export async function createInvoice(c: Context<AppEnv>, input: InvoiceCreateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await payablesService.createInvoice(user, actor, input)
  return c.json({ invoice: result.invoice, replayed: result.replayed }, result.replayed ? 200 : 201)
}

export async function getInvoice(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const detail = await payablesService.getInvoice(user, id)
  return c.json(detail)
}

export async function voidInvoice(c: Context<AppEnv>, id: string, input: InvoiceVoidBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const invoice = await payablesService.voidInvoice(user, actor, id, input.reason)
  return c.json({ invoice })
}
