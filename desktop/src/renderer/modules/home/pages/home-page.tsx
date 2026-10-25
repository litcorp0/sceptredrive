import { formatDay } from '@sceptre/shared'
import { ScreenHeader } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { endStaffSession, type StaffSession } from '@/lib/auth/staff-session'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { navigate } from '@/lib/router'
import { usePosShortcuts } from '@/lib/shortcuts'
import { requestFocus } from '@/lib/ui-intent'
import { AttentionStrip } from '../components/attention-strip'
import { DrawerTile } from '../components/drawer-tile'
import { HourChart } from '../components/hour-chart'
import { StatTiles } from '../components/stat-tiles'
import { TakeFigure } from '../components/take-figure'
import { TopSellers } from '../components/top-sellers'
import { useAccraDay } from '../hooks/use-accra-day'
import { useCurrentAccraHour } from '../hooks/use-accra-hour'
import { useHomeDay } from '../hooks/use-home'

/**
 * The counter's home screen (Plan 05, P10-D1).
 *
 * Everything here is this terminal's Accra day, read from the local database, so the screen is
 * correct with the network unplugged and after a relaunch. It is not branch reporting: the
 * device only holds the sales it wrote itself, which is why the heading names the terminal
 * instead of saying "today's takings".
 *
 * Selling is one action away in both layouts: **Start selling** sits in the heading row, so it
 * is on screen at 1024×768 without scrolling, and F2 means the same thing here as on the sell
 * screen — *find an item* — so it lands on the sell screen with the search field focused
 * (P10-D7).
 *
 * Layout: the two data panels sit side by side from 1280 px and stack at 1024 px. The tile row
 * is three cards at 1024 and above, one column on a narrow window.
 */
export function HomePage({
  identity,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  const day = useAccraDay()
  const currentHour = useCurrentAccraHour()
  const home = useHomeDay(day, {
    terminalId: identity.terminalId,
    branchId: identity.branchId,
  })

  function startSelling(): void {
    // The hash change renders the sell screen on a later task (it is a `hashchange` event),
    // so the intent is already set when that screen's effect consumes it.
    navigate('pos')
    requestFocus('search')
  }

  usePosShortcuts({ F2: startSelling })

  function lock(): void {
    // A shift owns the drawer; signing out mid-shift would leave it unattributed.
    if (shift) return
    endStaffSession()
    navigate('login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={lock}
        lockNote={shift ? 'Close the shift before locking' : 'Sign out of this terminal'}
      />

      <main className="mx-auto max-w-6xl p-4 xl:p-6">
        <ScreenHeader
          title="This terminal today"
          description={
            <>
              {formatDay(`${day}T00:00:00.000Z`)} · {identity.terminalCode} · {identity.branchCode}
            </>
          }
          actions={
            <Button
              type="button"
              onClick={startSelling}
              className="h-14 px-6 text-base"
              data-testid="start-selling"
            >
              Start selling
              <span className="ml-1 font-mono text-xs font-normal opacity-70">F2</span>
            </Button>
          }
        />

        <TakeFigure summary={home.summary} />

        <section aria-label="Today's counters" className="mt-4 grid gap-3 sm:grid-cols-3">
          <DrawerTile
            expectedCashMinor={home.summary.expectedCashMinor}
            shiftNumber={home.summary.shiftNumber}
          />
          <StatTiles summary={home.summary} />
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <HourChart points={home.hourly} peak={home.peak} currentHour={currentHour} />
          <TopSellers sellers={home.topSellers} />
        </div>

        <AttentionStrip items={home.attention} />
      </main>
    </div>
  )
}
