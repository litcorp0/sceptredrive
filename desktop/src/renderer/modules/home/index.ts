/**
 * `home` — this terminal's day, in one screen.
 *
 * Every figure is local, day-bounded, and scoped to this terminal (P10-D1). Nothing here
 * calls the API, so the screen is correct with the network unplugged; branch and company
 * takings stay the console's job.
 *
 * `api/` holds the statements, `hooks/` watches them, `utils/` is the pure arithmetic. The
 * page itself arrives in Plan 05 — this barrel exposes only the data layer until then.
 */
export type {
  CountRow,
  DayHeaderRow,
  DayWindow,
  HourRow,
  ItemsSoldRow,
  TopSellerRow,
} from './api/queries'
export { ACCRA_DAY_GUARD_MS, scheduleAccraDayFlip, useAccraDay } from './hooks/use-accra-day'
export {
  type ExpectedCash,
  type HomeDay,
  type HomeIdentity,
  useDayHeader,
  useExpectedCash,
  useHomeDay,
  useHourlyShape,
  useItemsSold,
  useOutOfStock,
  useTopSellers,
} from './hooks/use-home'
export type {
  AccraDay,
  AttentionItem,
  AttentionRoute,
  AttentionTone,
  HomeSummary,
  HourPoint,
  TopSeller,
} from './types'
export { type AttentionCounts, attentionItems } from './utils/attention'
export {
  dayWindow,
  fillHours,
  type HomeSummaryInput,
  homeSummary,
  peakHour,
  toTopSellers,
} from './utils/day'
