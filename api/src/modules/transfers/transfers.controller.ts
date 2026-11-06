import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as transfersService from './transfers.service.ts'
import type {
  DispatchInput,
  ReceiveInput,
  ShortCloseInput,
  TransferCreateInput,
  TransferLinesReplaceInput,
  TransferListQuery,
  TransferSourceStockQuery,
  TransferUpdateInput,
} from './transfers.types.ts'

export async function searchSourceStock(c: Context<AppEnv>, query: TransferSourceStockQuery) {
  return c.json(
    await transfersService.searchSourceStock(query.branchId, query.q, query.includeEmpty ?? false),
  )
}

export async function listTransfers(c: Context<AppEnv>, query: TransferListQuery) {
  const user = currentUser(c)
  const result = await transfersService.listTransfers(user, query)
  return c.json(result)
}

export async function createTransfer(c: Context<AppEnv>, input: TransferCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.createTransfer(user, actor, input)
  return c.json({ transfer }, 201)
}

export async function getTransfer(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const transfer = await transfersService.getTransfer(user, id)
  return c.json({ transfer })
}

export async function updateTransfer(c: Context<AppEnv>, id: string, input: TransferUpdateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.updateTransfer(user, actor, id, input)
  return c.json({ transfer })
}

export async function replaceTransferLines(
  c: Context<AppEnv>,
  id: string,
  input: TransferLinesReplaceInput,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.replaceTransferLines(user, actor, id, input)
  return c.json({ transfer })
}

export async function cancelTransfer(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await transfersService.cancelTransfer(user, actor, id)
  return c.json({ ok: true })
}

export async function dispatchTransfer(c: Context<AppEnv>, id: string, input: DispatchInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.dispatchTransfer(user, actor, id, input)
  return c.json({ transfer })
}

export async function receiveTransfer(c: Context<AppEnv>, id: string, input: ReceiveInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.receiveTransfer(user, actor, id, input)
  return c.json({ transfer })
}

export async function shortCloseTransfer(c: Context<AppEnv>, id: string, input: ShortCloseInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const transfer = await transfersService.shortCloseTransfer(user, actor, id, input)
  return c.json({ transfer })
}
