import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import { sendCsv } from '../../http/csv.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as payablesService from './payables.service.ts'
import type {
  AgingQuery,
  BalancesQuery,
  InvoiceCreateBody,
  InvoiceListQuery,
  InvoiceVoidBody,
  PaymentCreateBody,
  PaymentListQuery,
  PaymentVoidBody,
  TransferCreateBody,
  TransferFinalizeBody,
  TransferListQuery,
  TransferReconciliationQuery,
} from './payables.types.ts'

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

export async function listPayments(c: Context<AppEnv>, query: PaymentListQuery) {
  const user = currentUser(c)
  const result = await payablesService.listPayments(user, query)
  return c.json(result)
}

export async function createPayment(c: Context<AppEnv>, input: PaymentCreateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await payablesService.createPayment(user, actor, input)
  return c.json({ payment: result.payment, replayed: result.replayed }, result.replayed ? 200 : 201)
}

export async function getPayment(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const detail = await payablesService.getPayment(user, id)
  return c.json(detail)
}

export async function voidPayment(c: Context<AppEnv>, id: string, input: PaymentVoidBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const payment = await payablesService.voidPayment(user, actor, id, input.reason)
  return c.json({ payment })
}

export async function listBalances(c: Context<AppEnv>, query: BalancesQuery) {
  const user = currentUser(c)
  const result = await payablesService.listSupplierBalances(user, query)
  return c.json(result)
}

export async function getAging(c: Context<AppEnv>, query: AgingQuery) {
  const user = currentUser(c)
  const result = await payablesService.getAging(user, query)
  return c.json(result)
}

export async function exportAging(c: Context<AppEnv>, query: AgingQuery) {
  const user = currentUser(c)
  return sendCsv(c, await payablesService.exportAging(user, query))
}

export async function listTransfers(c: Context<AppEnv>, query: TransferListQuery) {
  const user = currentUser(c)
  return c.json(await payablesService.listTransfers(user, query))
}

export async function createTransfer(c: Context<AppEnv>, input: TransferCreateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await payablesService.createSupplierTransfer(user, actor, input)
  return c.json(
    {
      transfer: result.transfer,
      replayed: result.replayed,
      providerUnavailable: result.providerUnavailable,
    },
    result.replayed ? 200 : 201,
  )
}

export async function getTransfer(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  return c.json(await payablesService.getTransfer(user, id))
}

export async function finalizeTransfer(
  c: Context<AppEnv>,
  id: string,
  input: TransferFinalizeBody,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json({
    transfer: await payablesService.finalizeSupplierTransfer(user, actor, id, input.otp),
  })
}

export async function verifyTransfer(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  return c.json({ transfer: await payablesService.verifySupplierTransfer(user, id) })
}

export async function getProviderBalance(c: Context<AppEnv>) {
  return c.json(await payablesService.getProviderBalance())
}

export async function getTransferReconciliation(
  c: Context<AppEnv>,
  query: TransferReconciliationQuery,
) {
  const user = currentUser(c)
  return c.json(await payablesService.getTransferReconciliation(user, query))
}
