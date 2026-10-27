import { formatCount } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Search, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Skeleton } from "#/components/ui/skeleton"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { settingsKeys } from "../api/keys"
import { settingsListOptions, settingsUpdate } from "../api/settings"
import { SettingRow } from "../ui/setting-row"
import { controlFor, metaFor } from "../utils/meta"
import { filterSettings, groupSettings } from "../utils/settings"

const routeApi = getRouteApi("/_authenticated/settings")

/**
 * Every setting the API defines, rendered from the response.
 *
 * There is no hand-maintained key list to fall out of date: `GET /api/settings` is the list, and
 * a key this module has no hint for still gets a row with the key as its label and a plain text
 * control (P14-D42). The old page rendered 19 of 51 and silently dropped the rest.
 *
 * Groups come from the key's prefix in a fixed order and the search box filters on the key, the
 * label and the help text, so a setting can be found by the name the API gave it rather than by
 * the screen it happens to live on.
 */
export function SettingsPage() {
	const { session } = routeApi.useRouteContext()
	const { activeBranchId, activeBranch, canSelectBranch } = useBranch()
	const canRead = hasPermission(session.user.role, "settings.read")
	const canUpdate = hasPermission(session.user.role, "settings.update")
	const isAdmin = session.user.role === "ADMIN"

	const queryClient = useQueryClient()
	const [search, setSearch] = useState("")
	const debouncedSearch = useDebouncedValue(search, 250)

	const settingsQuery = useQuery({
		...settingsListOptions({ branchId: activeBranchId ?? undefined }),
		enabled: canRead,
	})

	const updateMutation = useMutation({
		mutationFn: ({
			key,
			value,
			branchId,
		}: {
			key: string
			value: unknown
			branchId: string | null
		}) => settingsUpdate({ key, value, branchId }),
		onSuccess: async () => {
			toast.success("Setting saved")
			await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
		},
		onError: (error) => {
			toastApiError(error)
		},
	})

	if (!canRead) {
		return (
			<div>
				<PageHeader title="Settings" />
				<p className="text-sm text-muted-foreground">
					Your role cannot read the console settings. Ask an administrator if you need a value
					changed.
				</p>
			</div>
		)
	}

	const settings = settingsQuery.data?.settings ?? []
	const matching = filterSettings(settings, debouncedSearch)
	const groups = groupSettings(matching)
	const forbidden = settingsQuery.error instanceof ApiError && settingsQuery.error.status === 403
	const filtering = debouncedSearch.trim() !== ""

	const description = canSelectBranch
		? activeBranch
			? `Every setting the server defines, resolved for ${activeBranch.code}. A branch value overrides the global value.`
			: "Every setting the server defines, resolved with global values and built-in defaults. Select a branch to see its overrides."
		: "Every setting the server defines, resolved for your branch."

	return (
		<div>
			<PageHeader title="Settings" description={description} />

			{settingsQuery.isLoading ? (
				<div className="grid gap-2" aria-busy="true">
					<output className="sr-only">Loading settings</output>
					{Array.from({ length: 6 }, (_, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are positional placeholders
						<Skeleton key={index} className="h-16 w-full" />
					))}
				</div>
			) : settingsQuery.isError ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">
						{forbidden
							? "Your role cannot read the console settings."
							: "Couldn't load the settings."}
					</p>
					{forbidden ? null : (
						<Button
							size="sm"
							variant="outline"
							className="mt-3"
							onClick={() => void settingsQuery.refetch()}
						>
							Try again
						</Button>
					)}
				</div>
			) : settings.length === 0 ? (
				<EmptyState
					icon={SlidersHorizontal}
					title="No settings returned"
					description="The server answered with an empty list. Settings appear here as soon as the API defines them."
				/>
			) : (
				<div className="grid gap-6">
					<div className="grid gap-1 sm:max-w-md">
						<Label htmlFor="settings-search" className="text-xs text-muted-foreground">
							Search settings
						</Label>
						<Input
							id="settings-search"
							type="search"
							placeholder="Key, label or help text"
							className="h-8"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							aria-describedby="settings-count"
						/>
						<output id="settings-count" className="block text-xs text-muted-foreground">
							{filtering
								? `${formatCount(matching.length)} of ${formatCount(settings.length)} settings match “${debouncedSearch.trim()}”.`
								: `${formatCount(settings.length)} settings in ${formatCount(groups.length)} groups.`}
						</output>
					</div>

					{groups.length === 0 ? (
						<EmptyState
							icon={Search}
							title="No settings match that search"
							description="Try a key prefix such as pricing, or a word from the label or help text."
						/>
					) : (
						groups.map((group) => (
							<section key={group.prefix} aria-labelledby={`settings-group-${group.prefix}`}>
								<h2
									id={`settings-group-${group.prefix}`}
									className="text-sm font-medium text-muted-foreground"
								>
									{group.label}
								</h2>
								{group.description ? (
									<p className="mb-2 text-xs text-muted-foreground">{group.description}</p>
								) : null}
								<div className="divide-y rounded-lg border bg-card">
									{group.settings.map((setting) => {
										const meta = metaFor(setting.key)
										const canWrite =
											canUpdate &&
											(setting.writableBy === "admin"
												? isAdmin
												: setting.branchScoped
													? isAdmin || activeBranchId !== null
													: isAdmin)
										const reason = !canUpdate
											? "Your role cannot change settings."
											: setting.writableBy === "admin" && !isAdmin
												? "Only administrators can change this value."
												: null

										return (
											<SettingRow
												key={setting.key}
												setting={setting}
												meta={meta}
												control={controlFor(setting, meta)}
												canWrite={canWrite}
												reason={reason}
												pending={
													updateMutation.isPending && updateMutation.variables?.key === setting.key
												}
												onSave={(value) => {
													updateMutation.mutate({
														key: setting.key,
														value,
														branchId: setting.branchScoped ? (activeBranchId ?? null) : null,
													})
												}}
											/>
										)
									})}
								</div>
							</section>
						))
					)}
				</div>
			)}
		</div>
	)
}
