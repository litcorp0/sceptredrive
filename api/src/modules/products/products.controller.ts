import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as productsService from './products.service.ts'
import type { ProductCreateInput } from './products.types.ts'

export async function suggestSku(c: Context<AppEnv>) {
  const suggestion = await productsService.suggestSku()
  return c.json(suggestion)
}

export async function createProduct(c: Context<AppEnv>, input: ProductCreateInput) {
  const actor = actorFromContext(c)
  const product = await productsService.createProduct(actor, input)
  return c.json({ product }, 201)
}
