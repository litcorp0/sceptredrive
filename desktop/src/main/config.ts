import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * Runtime configuration for the POS shell.
 *
 * Only *non-secret* values live here (URLs and identifiers). Tokens and keys are
 * encrypted through the keychain service (`src/main/ipc/keychain.ts`).
 *
 * The renderer's Content-Security-Policy is derived from these values, so every
 * origin is validated against a fixed allowlist (`csp.ts`): a tampered config
 * file cannot widen what the renderer is allowed to talk to.
 */

export const DEV_API_BASE_URL = 'http://localhost:4000'
export const DEV_POWERSYNC_URL = 'http://localhost:8080'
export const PRODUCTION_API_BASE_URL = 'https://api.gikautos.com'
export const PRODUCTION_POWERSYNC_URL = 'https://powersync.gikautos.com'

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'must be an http(s) URL')

export const runtimeConfigSchema = z.object({
  apiBaseUrl: httpUrl,
  powersyncUrl: httpUrl,
})

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(input)
}

export function defaultRuntimeConfig(dev: boolean): RuntimeConfig {
  return dev
    ? { apiBaseUrl: DEV_API_BASE_URL, powersyncUrl: DEV_POWERSYNC_URL }
    : { apiBaseUrl: PRODUCTION_API_BASE_URL, powersyncUrl: PRODUCTION_POWERSYNC_URL }
}

export function originOf(url: string): string {
  return new URL(url).origin
}

export const CONFIG_FILE_NAME = 'config.json'

export class ConfigError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

/**
 * Reads `userData/config.json`. A missing file means "not configured yet" and
 * falls back to the environment defaults; a malformed file fails closed.
 */
export function loadRuntimeConfig(userDataDir: string, dev: boolean): RuntimeConfig {
  const filePath = path.join(userDataDir, CONFIG_FILE_NAME)
  if (!fs.existsSync(filePath)) {
    return defaultRuntimeConfig(dev)
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    throw new ConfigError('CONFIG_INVALID', `Cannot parse ${filePath}`)
  }

  const parsed = runtimeConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ConfigError('CONFIG_INVALID', `Invalid POS configuration in ${filePath}`)
  }

  return parsed.data
}
