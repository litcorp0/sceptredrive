import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SpikePanel } from './SpikePanel'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Renderer root element #root is missing from index.html')
}

/**
 * Minimal hash routing. The Phase 6 gate lives at `#spike`; Plan 06 replaces this
 * shell with the real POS routes.
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return hash === '#spike' ? <SpikePanel /> : <App />
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
