/**
 * `audit` — the console's append-only change log.
 *
 * Move map (Phase 8, D8): `routes/_authenticated/audit.tsx` renders `AuditPage`; the route keeps
 * no markup, query or handler (D6). `/audit` is not owned by its URL path here: the route path
 * cannot move (TanStack derives the URL from the file path), only its body can.
 */
export { auditListOptions, auditRecentOptions } from "./api/audit"
export { AuditPage } from "./pages/audit-page"
export type { AuditEntry, AuditListQuery, AuditListResult } from "./types"
