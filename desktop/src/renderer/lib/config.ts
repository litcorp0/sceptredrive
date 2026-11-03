import { z } from 'zod'

/**
 * POS configuration for the renderer.
 *
 * The main process resolves the API and PowerSync URLs — a file baked into the package, or
 * `config.json` in userData — and hands them across the preload bridge. The renderer must use
 * those values: it enrols a terminal *before* it has any server-provided config, and when it
 * fell back to its own build-time default a packaged till pointed at `http://localhost:4000`
 * and reported "Cannot reach the server" while the real URLs sat unread in the app resources.
 *
 * The `VITE_*` values remain only as the fallback for contexts with no preload: unit tests and
 * a plain browser. Everything that can change per branch (tax mode, discount caps, PIN policy)
 * arrives later in the session's config snapshot and lives in `pos_config`.
 */

const url = z.string().url()

const schema = z.object({
  apiBaseUrl: url,
  powersyncUrl: url,
  appVersion: z.string().min(1),
})

/** The subset the main process sends. `appVersion` is a build fact, not a runtime one. */
const bridgedSchema = z.object({
  apiBaseUrl: url,
  powersyncUrl: url,
})

type BridgedConfig = z.infer<typeof bridgedSchema>

/**
 * The configuration resolved by the main process, when the preload bridge provided one.
 *
 * A malformed payload throws rather than falling back: silently using localhost would report
 * "Cannot reach the server" and hide the actual defect, which is exactly the bug this replaced.
 */
function bridgedConfig(): BridgedConfig | undefined {
  const bridge = (globalThis as { sceptreDrive?: { runtimeConfig?: unknown } }).sceptreDrive
  if (!bridge?.runtimeConfig) return undefined

  const parsed = bridgedSchema.safeParse(bridge.runtimeConfig)
  if (!parsed.success) {
    throw new Error('The main process sent an invalid runtime configuration')
  }
  return parsed.data
}

function buildConfig() {
  const buildTime = {
    apiBaseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
    powersyncUrl: import.meta.env.VITE_POWERSYNC_URL ?? 'http://localhost:8080',
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
  }

  return { ...buildTime, ...(bridgedConfig() ?? {}) }
}

export const posRuntimeConfig = schema.parse(buildConfig())

export type PosRuntimeConfig = z.infer<typeof schema>
