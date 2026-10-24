import { formatDateTime, formatRelative } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { auditRecentOptions } from "#/modules/audit"

/**
 * The dashboard's "Recent activity" panel.
 *
 * It reads the audit module's feed through its barrel — the one cross-module import the dashboard
 * has. The query key is unchanged from before Phase 8 (`['audit', { scope: 'dashboard' }]`, see
 * `modules/audit/api/keys.ts`), so the panel reads the same cache entry it always did.
 *
 * Phase 9 replaces this panel with the real executive dashboard.
 */
export function RecentActivity() {
	const auditQuery = useQuery(auditRecentOptions())

	return (
		<div className="rounded-lg border">
			<div className="border-b px-4 py-3">
				<h2 className="text-sm font-medium">Recent activity</h2>
			</div>
			{auditQuery.isLoading ? (
				<p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
			) : auditQuery.isError ? (
				<p className="px-4 py-6 text-sm text-destructive">Couldn't load recent activity.</p>
			) : (auditQuery.data?.entries.length ?? 0) === 0 ? (
				<p className="px-4 py-6 text-sm text-muted-foreground">
					No activity yet. Changes you make appear here.
				</p>
			) : (
				<ul className="divide-y">
					{auditQuery.data?.entries.map((entry) => (
						<li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
							<span
								className="font-mono text-xs text-muted-foreground"
								title={formatDateTime(entry.createdAt)}
							>
								{formatRelative(entry.createdAt)}
							</span>
							<span className="font-medium">{entry.action}</span>
							<span className="text-muted-foreground">
								{entry.entity}
								{entry.actorStaffId ? ` · ${entry.actorStaffId}` : ""}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
