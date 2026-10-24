import { formatDateTime, formatRelative } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { auditRecentOptions } from "#/modules/audit"

/**
 * The dashboard's "Recent activity" panel.
 *
 * It sits in `components/common` only for the transition: the fetcher is now `modules/audit`'s,
 * and a route file cannot import a module barrel without failing the thin-route gate. Plan 12
 * moves this file to `modules/dashboard/components`, where `dashboard -> audit` is a normal
 * cross-module import through the barrel.
 *
 * The query key is unchanged from before Phase 8 (`["audit", { scope: "dashboard" }]`, see
 * `modules/audit/api/keys.ts`), so the panel reads the same cache entry it always did.
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
