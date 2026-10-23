import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PosProvider } from './lib/powersync/provider'
import { DevSyncRoute } from './routes/_pos/dev-sync'
import { PosRoute } from './routes/_pos/route'
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
 * - `#login`     PIN sign-in (offline-capable) and staff authorization
 * - `#shift`     open/close the shift, cash in/out
 * - `#pos`       POS shell (Plan 06 fills it in)
 * - `#dev/sync`  sync diagnostics: counts, session, status
 * - `#spike`     the Phase 6 PowerSync gate (kept for verification)
 * - otherwise    shell diagnostics (app info + keychain self-test)
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (hash === '#spike') return <SpikePanel />

  if (hash === '#login') {
    return (
      <PosProvider>
        <LoginRoute />
      </PosProvider>
    )
  }

  if (hash === '#shift') {
    return (
      <PosProvider>
        <ShiftRoute />
      </PosProvider>
    )
  }

  if (hash === '#pos' || hash === '#dev/sync') {
    return <PosProvider>{hash === '#dev/sync' ? <DevSyncRoute /> : <PosRoute />}</PosProvider>
  }

  return <App />
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
