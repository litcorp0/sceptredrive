import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'
import { DesktopUnavailableError, desktopApi, isDesktopAvailable } from './lib/desktop-api'

type SelfTestState = 'idle' | 'running' | 'stored' | 'cleared' | 'failed'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [selfTest, setSelfTest] = useState<SelfTestState>('idle')
  const [selfTestNote, setSelfTestNote] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktopAvailable()) {
      setBridgeError('Desktop bridge unavailable (running outside Electron)')
      return
    }

    desktopApi
      .getAppInfo()
      .then(setInfo)
      .catch((error: unknown) => {
        if (error instanceof DesktopUnavailableError) {
          setBridgeError(error.message)
          return
        }
        setBridgeError(error instanceof Error ? error.message : 'Unknown error')
      })
  }, [])

  async function toggleSelfTest() {
    setSelfTest('running')
    setSelfTestNote(null)
    try {
      const existing = await desktopApi.getSecret('keychainSelfTest')
      if (existing) {
        await desktopApi.deleteSecret('keychainSelfTest')
        setSelfTest('cleared')
        return
      }

      const probe = `probe-${crypto.randomUUID()}`
      await desktopApi.setSecret('keychainSelfTest', probe)
      const readBack = await desktopApi.getSecret('keychainSelfTest')
      if (readBack !== probe) {
        setSelfTest('failed')
        setSelfTestNote('Round-trip mismatch')
        return
      }
      setSelfTest('stored')
    } catch (error) {
      setSelfTest('failed')
      setSelfTestNote(error instanceof Error ? error.message : 'Keychain unavailable')
    }
  }

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Sceptre Drive POS
        </p>
        <h1 className="mt-1 text-2xl font-semibold" data-testid="shell-ready">
          Desktop shell ready
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Diagnostics for support and packaging checks. This is not the till: the terminal opens on
          sign-in, and an unenrolled one asks for an enrolment code.
        </p>
      </header>

      {bridgeError ? (
        <p className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {bridgeError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-5">
          <h2 className="mb-3 text-sm font-semibold">Application</h2>
          {info ? (
            <div>
              <Row label="Version" value={info.version} />
              <Row label="Electron" value={info.electron} />
              <Row label="Chromium" value={info.chrome} />
              <Row label="Platform" value={`${info.platform} / ${info.arch}`} />
              <Row label="Packaged" value={info.isPackaged ? 'yes' : 'no'} />
              <Row label="User data" value={info.userDataPath} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </section>

        <section className="rounded-lg border border-border p-5">
          <h2 className="mb-3 text-sm font-semibold">Secure storage</h2>
          {info ? (
            <div>
              <Row label="Available" value={info.secureStorage.available ? 'yes' : 'no'} />
              <Row label="Level" value={info.secureStorage.level} />
              <Row label="Backend" value={info.secureStorage.backend ?? 'n/a'} />
            </div>
          ) : null}

          {info?.secureStorage.available ? (
            <button
              type="button"
              onClick={toggleSelfTest}
              disabled={selfTest === 'running'}
              className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {selfTest === 'stored' ? 'Clear keychain probe' : 'Run keychain self-test'}
            </button>
          ) : null}

          <p className="mt-3 text-sm" data-testid="keychain-status">
            {selfTest === 'idle' && 'Not run'}
            {selfTest === 'running' && 'Running…'}
            {selfTest === 'stored' && 'PASS — encrypted value round-tripped'}
            {selfTest === 'cleared' && 'CLEARED — probe removed'}
            {selfTest === 'failed' && `FAIL — ${selfTestNote ?? 'unknown error'}`}
          </p>
        </section>
      </div>
    </main>
  )
}
