import { type DbExecutor, db } from '@sceptre/db'
import { accraIsoDay, toCsv } from '@sceptre/shared'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { type CsvExport, csvFilename, enforceExportCap, MAX_EXPORT_ROWS } from '../../http/csv.ts'
import type { SessionUser } from '../../http/factory.ts'
import { findBranchById } from '../org/branches.repository.ts'
import { countAuditRows, insertAuditRow, selectAuditPage } from './audit.repository.ts'
import type { AuditEntry, AuditQueryFilters, AuditQueryResult } from './audit.types.ts'

/**
 * Appends a row to the audit log. The audit log is append-only by design:
 * there are no update or delete helpers, and corrections are new entries.
 */
export async function writeAudit(entry: AuditEntry, executor: DbExecutor = db): Promise<void> {
  await insertAuditRow(entry, executor)
}

/** Reads the audit log with manager branch scoping; the log stays append-only. */
export async function queryAudit(
  user: SessionUser,
  filters: AuditQueryFilters,
): Promise<AuditQueryResult> {
  const branchScope = resolveBranchFilter(user, filters.branchId ?? null)
  const scope = { ...filters, branchScope }

  const entries = await selectAuditPage(scope)
  const total = await countAuditRows(scope)

  return { entries, total }
}

/** The export takes the list's filters without its paging (P14-D19). */
export type AuditExportFilters = Omit<AuditQueryFilters, 'limit' | 'offset'>

/**
 * The audit trail as a file (RPT-06, P14-D44).
 *
 * The projection is the point. Audit rows for `staff.created`, `customer.created` and
 * `customer.updated` carry an email address or a phone number in `before`/`after`, and
 * those rows are permanent — customer erasure scrubs the customer, not the history. An
 * export that fanned the payload out would be a data-protection incident with a download
 * button, so this function selects **time, actor, action, entity, entity id, branch,
 * terminal and request id and nothing else**.
 *
 * Branch scoping is `queryAudit`'s: a manager exports their branch, a foreign branch id
 * is a 403, an admin may export everything.
 */
export async function exportEntries(
  user: SessionUser,
  filters: AuditExportFilters,
): Promise<CsvExport> {
  const branchScope = resolveBranchFilter(user, filters.branchId ?? null)
  const entries = await selectAuditPage({
    ...filters,
    branchScope,
    limit: MAX_EXPORT_ROWS + 1,
    offset: 0,
  })
  enforceExportCap(entries.length)

  const rows = entries.map((entry) => ({
    createdAt: entry.createdAt.toISOString(),
    actorStaffId: entry.actorStaffId ?? '',
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? '',
    branchId: entry.branchId ?? '',
    terminalId: entry.terminalId ?? '',
    requestId: entry.requestId ?? '',
  }))

  const branchCode = branchScope ? ((await findBranchById(branchScope))?.code ?? null) : null
  const from = filters.from ? accraIsoDay(filters.from) : '1970-01-01'
  const to = filters.to ? accraIsoDay(filters.to) : accraIsoDay()

  return {
    filename: csvFilename('audit', branchCode, `${from}-${to}`),
    csv: toCsv(
      [
        { key: 'createdAt', header: 'created_at' },
        { key: 'actorStaffId', header: 'actor_staff_id' },
        { key: 'action', header: 'action' },
        { key: 'entity', header: 'entity' },
        { key: 'entityId', header: 'entity_id' },
        { key: 'branchId', header: 'branch_id' },
        { key: 'terminalId', header: 'terminal_id' },
        { key: 'requestId', header: 'request_id' },
      ],
      rows,
    ),
  }
}
