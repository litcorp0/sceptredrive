import { useState } from 'react'
import { runPowerSyncSpike, type SpikeReport, type SpikeVfs } from './lib/powersync/spike'

/**
 * Phase 6 gate UI, reachable at `#spike`.
 *
 * Runs the PowerSync Web SDK spike against both candidate VFS backends and shows
 * every step, so the outcome is visible in dev *and* in a packaged build before
 * any POS feature depends on it.
 */
export function SpikePanel() {
  const [report, setReport] = useState<SpikeReport | null>(null)
  const [running, setRunning] = useState<SpikeVfs | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(vfs: SpikeVfs) {
    setRunning(vfs)
    setError(null)
    setReport(null)
    try {
      setReport(await runPowerSyncSpike(vfs))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(null)
    }
  }

  const verdict = error ? 'FAIL' : report ? (report.ok ? 'OK' : 'FAIL') : 'IDLE'

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Phase 6 spike
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          PowerSync Web SDK{' '}
          <span
            data-testid="spike-ok"
            className={verdict === 'OK' ? 'text-emerald-600' : 'text-destructive'}
          >
            {verdict}
          </span>
        </h1>
      </header>

      <div className="mb-6 flex gap-3">
        <button
          type="button"
          onClick={() => run('default')}
          disabled={running !== null}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {running === 'default' ? 'Running…' : 'Run spike (default VFS)'}
        </button>
        <button
          type="button"
          onClick={() => run('opfscopysync')}
          disabled={running !== null}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {running === 'opfscopysync' ? 'Running…' : 'Run spike (OPFSCoopSync VFS)'}
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {report ? (
        <section className="rounded-lg border border-border p-5">
          <h2 className="mb-3 text-sm font-semibold">
            {report.vfs} — {report.durationMs} ms
          </h2>
          <ul className="space-y-1.5">
            {report.steps.map((step) => (
              <li key={step.name} className="flex items-baseline gap-2 text-sm">
                <span className={step.ok ? 'text-emerald-600' : 'text-destructive'}>
                  {step.ok ? '✓' : '✗'}
                </span>
                <span>{step.name}</span>
                {step.detail ? (
                  <span className="font-mono text-xs text-muted-foreground">{step.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <pre
            data-testid="spike-report"
            className="mt-4 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >
            {JSON.stringify(report)}
          </pre>
        </section>
      ) : null}
    </main>
  )
}
