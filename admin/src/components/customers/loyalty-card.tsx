import { formatCount, formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import {
	LoyaltyAdjustDialog,
	type LoyaltyRates,
} from "#/components/customers/loyalty-adjust-dialog"
import { LoyaltyHistoryTable } from "#/components/customers/loyalty-history-table"
import { Button } from "#/components/ui/button"
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import { accountOptions, daysUntil, impliedValueMinor, isExpiringSoon } from "#/modules/loyalty"
import type { ResolvedSetting, SettingKey } from "#/modules/settings"
import { settingsListOptions } from "#/modules/settings"

function numberSetting(settings: ResolvedSetting[], key: SettingKey): number | null {
	const setting = settings.find((item) => item.key === key)
	return typeof setting?.value === "number" ? setting.value : null
}

/**
 * Loyalty tab on the customer profile: the global points balance with its
 * redemption value, the live point lots (FEFO), and the full history. Staff
 * adjustments post through the dialog and land in the ledger below.
 */
export function LoyaltyCard({
	customerId,
	branchId,
	branchName,
	canAdjust,
}: {
	customerId: string
	branchId: string | null
	branchName: string | null
	canAdjust: boolean
}) {
	const [adjustOpen, setAdjustOpen] = useState(false)

	const accountQuery = useQuery(accountOptions(customerId))
	const settingsQuery = useQuery({
		...settingsListOptions({}),
		staleTime: 5 * 60_000,
	})

	const settings = settingsQuery.data?.settings ?? []
	const earnPointsPerCedi = numberSetting(settings, "loyalty.earnPointsPerCedi")
	const pointsPerCedi = numberSetting(settings, "loyalty.pointsPerCedi")
	const minimumRedeemPoints = numberSetting(settings, "loyalty.minimumRedeemPoints")
	const rates: LoyaltyRates | null =
		earnPointsPerCedi !== null && pointsPerCedi !== null && minimumRedeemPoints !== null
			? { earnPointsPerCedi, pointsPerCedi, minimumRedeemPoints }
			: null

	const balancePoints = accountQuery.data?.balancePoints ?? 0
	const lots = (accountQuery.data?.lots ?? []).filter((lot) => lot.remainingPoints > 0)
	const expiringSoonPoints = lots
		.filter((lot) => isExpiringSoon(lot.expiresAt))
		.reduce((total, lot) => total + lot.remainingPoints, 0)

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Loyalty</CardTitle>
					<CardDescription>
						One balance across branches. Points redeem at the current rate; redemptions consume the
						oldest lots first.
					</CardDescription>
					<CardAction>
						{canAdjust && branchId !== null ? (
							<Button size="sm" onClick={() => setAdjustOpen(true)}>
								Adjust points
							</Button>
						) : null}
					</CardAction>
				</CardHeader>
				<CardContent className="grid gap-4">
					{accountQuery.isLoading ? (
						<p className="text-sm text-muted-foreground">Loading loyalty…</p>
					) : accountQuery.isError ? (
						<p className="text-sm text-destructive">Couldn't load the loyalty account.</p>
					) : (
						<>
							<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
								<p
									className={
										balancePoints < 0
											? "text-2xl font-semibold tabular-nums text-destructive"
											: "text-2xl font-semibold tabular-nums"
									}
								>
									{formatCount(balancePoints)}{" "}
									<span className="text-sm font-normal text-muted-foreground">points</span>
								</p>
								{pointsPerCedi !== null ? (
									<p className="text-sm text-muted-foreground">
										Worth ≈ {formatGhs(impliedValueMinor(balancePoints, pointsPerCedi))} in
										redemptions.
									</p>
								) : null}
								{expiringSoonPoints > 0 ? (
									<p className="text-sm text-amber-700">
										{formatCount(expiringSoonPoints)} points expire within 30 days.
									</p>
								) : null}
							</div>

							{lots.length === 0 ? (
								<p className="text-sm text-muted-foreground">No live points lots.</p>
							) : (
								<div className="rounded-lg border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead className="w-24 text-right">Points</TableHead>
												<TableHead className="w-28 text-right">Remaining</TableHead>
												<TableHead>Expires</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{lots.map((lot) => {
												const days = daysUntil(lot.expiresAt)
												return (
													<TableRow key={lot.id}>
														<TableCell className="text-right tabular-nums">
															{formatCount(lot.points)}
														</TableCell>
														<TableCell className="text-right tabular-nums">
															{formatCount(lot.remainingPoints)}
														</TableCell>
														<TableCell>
															{formatDay(lot.expiresAt)}
															{isExpiringSoon(lot.expiresAt) ? (
																<span className="ml-2 text-xs font-medium text-amber-700">
																	in {days} {days === 1 ? "day" : "days"}
																</span>
															) : null}
														</TableCell>
													</TableRow>
												)
											})}
										</TableBody>
									</Table>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			<LoyaltyHistoryTable
				entries={accountQuery.data?.entries ?? []}
				entryTotal={accountQuery.data?.entryTotal ?? 0}
				isLoading={accountQuery.isLoading}
				isError={accountQuery.isError}
			/>

			<LoyaltyAdjustDialog
				open={adjustOpen}
				onOpenChange={setAdjustOpen}
				customerId={customerId}
				branchId={branchId}
				branchName={branchName}
				balancePoints={balancePoints}
				rates={rates}
			/>
		</div>
	)
}
