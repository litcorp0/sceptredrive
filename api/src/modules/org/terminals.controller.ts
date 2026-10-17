import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import * as terminalsService from './terminals.service.ts'
import type {
  TerminalCreateInput,
  TerminalListQuery,
  TerminalUpdateInput,
} from './terminals.types.ts'

export async function listTerminals(c: Context<AppEnv>, query: TerminalListQuery) {
  const user = currentUser(c)
  const terminals = await terminalsService.listTerminals(user, {
    branchId: query.branchId,
    includeInactive: query.includeInactive,
  })
  return c.json({ terminals })
}

export async function createTerminal(c: Context<AppEnv>, input: TerminalCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const terminal = await terminalsService.createTerminal(user, actor, input)
  return c.json({ terminal }, 201)
}

export async function getTerminal(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const terminal = await terminalsService.getTerminal(user, id)
  return c.json({ terminal })
}

export async function updateTerminal(c: Context<AppEnv>, id: string, input: TerminalUpdateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const terminal = await terminalsService.updateTerminal(user, actor, id, input)
  return c.json({ terminal })
}

export async function listDevices(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const devices = await terminalsService.listDevices(user, id)
  return c.json({ devices })
}

export async function revokeDevice(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const device = await terminalsService.revokeDevice(user, actor, id)
  return c.json({ device })
}
