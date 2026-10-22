import { z } from 'zod'

/**
 * Build-time POS configuration.
 *
 * The API and PowerSync URLs are baked in per build (`,env` → `VITE_*`): the
 * terminal must know where to enrol *before* it has any server-provided config.
 * Everything that can change per branch (tax mode, discount caps, PIN policy)
 * arrives later in the session's config snapshot and lives in `pos_config`.
 */

const url = z.string().url()

const schema = z.object({
  apiBaseUrl: url,
  powersyncUrl: url,
  appVersion: z.string().min(1),
})

function buildConfig() {
  return {
    apiBaseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
    powersyncUrl: import.meta.env.VITE_POWERSYNC_URL ?? 'http://localhost:8080',
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
  }
}

export const posRuntimeConfig = schema.parse(buildConfig())

export type PosRuntimeConfig = z.infer<typeof schema>
