import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PosProvider } from './lib/powersync/provider'
import { parseHash, topLevelScreen } from './lib/router'
import { PosRoutes } from './routes/_pos/app'
import { DevPrintRoute } from './routes/_pos/dev-print'
import { DevSyncRoute } from './routes/_pos/dev-sync'
import { LoginRoute } from './routes/login'
import { ShiftRoute } from './routes/shift'
import { SpikePanel } from './SpikePanel'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Renderer root element #root is missing from index.html')
}

/**
 * Minimal hash routing.
 *
 * - *(empty or unknown)* sign-in, which renders enrolment on a terminal with no credential
 * - `#login`         PIN sign-in (offline-capable) and staff authorization
 * - `#shift`         open/close the shift, cash in/out
 * - `#home`          this terminal's day: take, drawer, credit, tax, hourly shape, top five
 * - `#pos`           POS app shell: selling (`#pos`), tender (`#pos/tender`),
 *                    settings (`#pos/settings`)
 * - `#dev/sync`      sync diagnostics: counts, session, status
 * - `#dev/print`     printer diagnostics (`POS_DIAGNOSTICS=1`)
 * - `#spike`         the Phase 6 PowerSync gate (kept for verification)
 * - `#diagnostics`   shell diagnostics: app info + keychain self-test (support only)
 *
 * A first install used to fall through to the diagnostics shell. It now falls through to
 * sign-in, because a shop receiving a new terminal must see an enrolment field, not a
 * developer screen (Phase 10 Plan 08).
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const screen = topLevelScreen(parseHash(hash))

  switch (screen) {
    case 'spike':
      return <SpikePanel />
    case 'diagnostics':
      return <App />
    case 'dev-print':
      return <DevPrintRoute />
    case 'dev-sync':
      return (
        <PosProvider>
          <DevSyncRoute />
        </PosProvider>
      )
    case 'shift':
      return (
        <PosProvider>
          <ShiftRoute />
        </PosProvider>
      )
    // `#home` and `#pos` mount the same provider and the same guard ladder (P10-D6); the route
    // decides which page renders inside it.
    case 'home':
    case 'pos':
      return (
        <PosProvider>
          <PosRoutes />
        </PosProvider>
      )
    default:
      return (
        <PosProvider>
          <LoginRoute />
        </PosProvider>
      )
  }
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
