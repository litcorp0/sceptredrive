import { type DbExecutor, db } from '@gikautos/db'
import { resolveBranchFilter } from '../../auth/scope.ts'
import type { SessionUser } from '../../http/factory.ts'
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
