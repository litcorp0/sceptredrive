import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as procurementService from './procurement.service.ts'
import type {
  OrderActionBody,
  OrderCancelBody,
  OrderCreateBody,
  OrderListQuery,
  OrderUpdateBody,
  ReceiveOrderBody,
} from './procurement.types.ts'

export async function listOrders(c: Context<AppEnv>, query: OrderListQuery) {
  const user = currentUser(c)
  const result = await procurementService.listOrders(user, query)
  return c.json(result)
}

export async function createOrder(c: Context<AppEnv>, input: OrderCreateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await procurementService.createOrder(user, actor, input)
  return c.json(result.order, result.replayed ? 200 : 201)
}

export async function listMatchableOrders(
  c: Context<AppEnv>,
  query: { supplierId: string; branchId?: string },
) {
  const user = currentUser(c)
  return c.json(await procurementService.listMatchableOrders(user, query))
}

export async function getOrder(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const detail = await procurementService.getOrder(user, id)
  return c.json(detail)
}

export async function updateOrder(c: Context<AppEnv>, id: string, input: OrderUpdateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const detail = await procurementService.updateOrder(user, actor, id, input)
  return c.json(detail)
}

export async function submitOrder(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await procurementService.submitOrder(user, actor, id))
}

export async function sendOrder(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await procurementService.sendOrder(user, actor, id))
}

export async function cancelOrder(c: Context<AppEnv>, id: string, input: OrderCancelBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await procurementService.cancelOrder(user, actor, id, input))
}

export async function closeOrder(c: Context<AppEnv>, id: string, input: OrderActionBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await procurementService.closeOrder(user, actor, id, input))
}

export async function receiveOrder(c: Context<AppEnv>, id: string, input: ReceiveOrderBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await procurementService.receiveOrder(user, actor, id, input)
  return c.json(result, result.replayed ? 200 : 201)
}
