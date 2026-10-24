import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PosProvider } from './lib/powersync/provider'
import { parseHash } from './lib/router'
import { PosRoutes } from './routes/_pos/app'
import { DevChartsRoute } from './routes/_pos/dev-charts'
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
 * - `#login`         PIN sign-in (offline-capable) and staff authorization
 * - `#shift`         open/close the shift, cash in/out
 * - `#pos`           POS app shell: selling (`#pos`), tender (`#pos/tender`),
 *                    settings (`#pos/settings`)
 * - `#dev/sync`      sync diagnostics: counts, session, status
 * - `#dev/charts`    chart-layer proof with static fixtures (Phase 7)
 * - `#spike`         the Phase 6 PowerSync gate (kept for verification)
 * - otherwise        shell diagnostics (app info + keychain self-test)
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const route = parseHash(hash)

  if (route.path === 'spike') return <SpikePanel />

  if (route.path === 'login') {
    return (
      <PosProvider>
        <LoginRoute />
      </PosProvider>
    )
  }

  if (route.path === 'shift') {
    return (
      <PosProvider>
        <ShiftRoute />
      </PosProvider>
    )
  }

  if (route.path === 'pos' || (route.path === 'dev' && route.segments[1] === 'sync')) {
    return <PosProvider>{route.path === 'dev' ? <DevSyncRoute /> : <PosRoutes />}</PosProvider>
  }

  if (route.path === 'dev' && route.segments[1] === 'print') {
    return <DevPrintRoute />
  }

  if (route.path === 'dev' && route.segments[1] === 'charts') {
    return <DevChartsRoute />
  }

  return <App />
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
