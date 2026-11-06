import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as productsService from './products.service.ts'
import type {
  BarcodeCreateInput,
  PriceOverrideBody,
  ProductCreateInput,
  ProductListQuery,
  ProductSubmissionBody,
  ProductUpdateInput,
} from './products.types.ts'

export async function listProducts(c: Context<AppEnv>, query: ProductListQuery) {
  const user = currentUser(c)
  const result = await productsService.listProducts(user, query)
  return c.json(result)
}

export async function suggestSku(c: Context<AppEnv>) {
  const suggestion = await productsService.suggestSku()
  return c.json(suggestion)
}

export async function suggestBarcode(c: Context<AppEnv>) {
  return c.json(await productsService.suggestBarcode())
}

export async function createProduct(c: Context<AppEnv>, input: ProductCreateInput) {
  const actor = actorFromContext(c)
  const product = await productsService.createProduct(actor, input)
  return c.json({ product }, 201)
}

export async function getProduct(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const product = await productsService.getProductDetail(user, id)
  return c.json({ product })
}

export async function updateProduct(c: Context<AppEnv>, id: string, input: ProductUpdateInput) {
  const actor = actorFromContext(c)
  const product = await productsService.updateProduct(actor, currentUser(c), id, input)
  return c.json({ product })
}

export async function archiveProduct(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const product = await productsService.archiveProduct(actor, id)
  return c.json({ product })
}

export async function reactivateProduct(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const product = await productsService.reactivateProduct(actor, id)
  return c.json({ product })
}

export async function addBarcode(c: Context<AppEnv>, id: string, input: BarcodeCreateInput) {
  const actor = actorFromContext(c)
  const barcodeRow = await productsService.addProductBarcode(actor, id, input.code)
  return c.json({ barcode: barcodeRow }, 201)
}

export async function removeBarcode(c: Context<AppEnv>, id: string, barcodeId: string) {
  const actor = actorFromContext(c)
  await productsService.removeProductBarcode(actor, id, barcodeId)
  return c.json({ removed: true })
}

export async function getPrices(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const result = await productsService.getPriceOverrides(user, id)
  return c.json(result)
}

export async function setPriceOverride(c: Context<AppEnv>, id: string, input: PriceOverrideBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await productsService.setPriceOverride(user, actor, id, input)
  // 200 for both outcomes: the request is a completed action, not an accepted one.
  return c.json(result)
}

export async function removePriceOverride(c: Context<AppEnv>, id: string, branchId: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await productsService.removePriceOverride(user, actor, id, branchId)
  return c.json(result)
}

export async function submitProduct(c: Context<AppEnv>, input: ProductSubmissionBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await productsService.submitProduct(user, actor, input)
  return c.json(result, 201)
}
