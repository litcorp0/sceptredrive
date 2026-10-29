#!/usr/bin/env node
/**
 * Dev supervisor.
 *
 * `bun run --parallel --filter '*' dev` starts five long-lived processes, and
 * some of them are grandparents: the API is `node --watch`, which runs the
 * server as a child, and Electron Forge starts its own Vite server on :5173.
 * A plain Ctrl+C reaches the Bun runner but not every descendant, so a watcher
 * or Forge can survive and keep 3000/3004/4000/5173 bound. The next `bun run
 * dev` then fails with "port already in use".
 *
 * This wrapper starts the runner in its own process group and forwards the
 * signal to the whole group, escalating to SIGKILL after a grace period. On
 * POSIX the group contains every child, grandchild and Electron helper; on
 * Windows the tree is killed with `taskkill /T`.
 *
 *   bun run dev        (Ctrl+C once, everything stops)
 */
import { execFileSync, spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'
const PORTS = [3000, 3004, 4000, 5173]
const GRACE_MS = 2_000

let stopping = false
let child = null

function signalTree(signal) {
  if (!child?.pid || child.exitCode !== null) return
  if (isWindows) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // already gone
    }
    return
  }
  try {
    // Negative pid = the process group the detached child leads.
    process.kill(-child.pid, signal)
  } catch {
    // already gone
  }
}

function listeningPids(port) {
  if (isWindows) return []
  try {
    // `ss` ships with iproute2 on the Linux dev boxes. `-p` needs no root for
    // our own processes, which is all we started.
    const output = execFileSync('ss', ['-ltnp', `sport = :${port}`], { encoding: 'utf8' })
    return [...output.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))
  } catch {
    return []
  }
}

/**
 * Last resort: a descendant that detached into its own session is not in our
 * group. Only a PID that appeared on one of our ports **after this wrapper
 * started** is killed, so an unrelated dev stack that already owned a port is
 * never touched. The baseline is captured before the runner is spawned.
 */
const baseline = new Map(PORTS.map((port) => [port, new Set(listeningPids(port))]))

function sweepPorts() {
  if (isWindows) return
  for (const port of PORTS) {
    const before = baseline.get(port) ?? new Set()
    for (const pid of listeningPids(port)) {
      if (pid === process.pid || before.has(pid)) continue
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

function shutdown(code) {
  if (stopping) return
  stopping = true
  console.log('\n[dev] stopping every workspace (ports 3000, 3004, 4000, 5173)…')

  // Ctrl+C semantics first, so Vite/Forge can remove their listeners, then the
  // group is forced after the grace period.
  signalTree('SIGINT')

  setTimeout(() => {
    signalTree('SIGKILL')
    sweepPorts()
    process.exit(code)
  }, GRACE_MS)
}

/** A second Ctrl+C skips the grace period. */
function force(code) {
  signalTree('SIGKILL')
  sweepPorts()
  process.exit(code)
}

process.on('SIGINT', () => (stopping ? force(130) : shutdown(130)))
process.on('SIGTERM', () => (stopping ? force(143) : shutdown(143)))
process.on('SIGHUP', () => (stopping ? force(129) : shutdown(129)))

child = spawn('bun', ['run', '--parallel', '--if-present', '--filter', '*', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  // A new process group on POSIX: the wrapper can signal all descendants at once.
  detached: !isWindows,
})

child.on('error', (error) => {
  console.error('[dev] failed to start the runner:', error.message)
  shutdown(1)
})

child.on('exit', (code, signal) => {
  if (stopping) return
  // The runner ended by itself (a workspace failed). Do not leave its
  // grandchildren behind.
  signalTree('SIGINT')
  setTimeout(() => {
    signalTree('SIGKILL')
    sweepPorts()
    process.exit(code ?? (signal ? 1 : 0))
  }, 500)
})
