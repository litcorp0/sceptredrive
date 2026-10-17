import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as terminalsController from './terminals.controller.ts'
import {
  validateTerminalCreate,
  validateTerminalIdParam,
  validateTerminalListQuery,
  validateTerminalUpdate,
} from './terminals.validation.ts'

export const terminalsRoutes = factory.createApp()

terminalsRoutes.get(
  '/api/terminals',
  requireSession,
  requirePermission('terminal.read'),
  validateTerminalListQuery,
  (c) => terminalsController.listTerminals(c, c.req.valid('query')),
)

terminalsRoutes.post(
  '/api/terminals',
  requireSession,
  requirePermission('terminal.create'),
  validateTerminalCreate,
  (c) => terminalsController.createTerminal(c, c.req.valid('json')),
)

terminalsRoutes.get(
  '/api/terminals/:id',
  requireSession,
  requirePermission('terminal.read'),
  validateTerminalIdParam,
  (c) => terminalsController.getTerminal(c, c.req.valid('param').id),
)

terminalsRoutes.patch(
  '/api/terminals/:id',
  requireSession,
  requirePermission('terminal.update'),
  validateTerminalIdParam,
  validateTerminalUpdate,
  (c) => terminalsController.updateTerminal(c, c.req.valid('param').id, c.req.valid('json')),
)

terminalsRoutes.get(
  '/api/terminals/:id/devices',
  requireSession,
  requirePermission('device.read'),
  validateTerminalIdParam,
  (c) => terminalsController.listDevices(c, c.req.valid('param').id),
)

terminalsRoutes.post(
  '/api/devices/:id/revoke',
  requireSession,
  requirePermission('device.revoke'),
  validateTerminalIdParam,
  (c) => terminalsController.revokeDevice(c, c.req.valid('param').id),
)
