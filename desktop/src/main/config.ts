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

/**
 * The production apex domain. One constant on purpose: the domain is not yet
 * purchased, so every origin below derives from it. Changing this line and the
 * CSP test expectations is the whole swap.
 */
export const SCEPTRE_DOMAIN = 'gikautos.com' // TODO(domain): replace when purchased
export const PRODUCTION_API_BASE_URL = `https://api.${SCEPTRE_DOMAIN}`
export const PRODUCTION_POWERSYNC_URL = `https://powersync.${SCEPTRE_DOMAIN}`

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

export function defaultRuntimeConfig(local: boolean): RuntimeConfig {
  return local
    ? { apiBaseUrl: DEV_API_BASE_URL, powersyncUrl: DEV_POWERSYNC_URL }
    : { apiBaseUrl: PRODUCTION_API_BASE_URL, powersyncUrl: PRODUCTION_POWERSYNC_URL }
}

export function originOf(url: string): string {
  return new URL(url).origin
}

/**
 * Whether the renderer may talk to localhost API/PowerSync origins.
 *
 * A dev server and an unpackaged build always may — that is how the E2E and the
 * local smoke tests run. A **packaged** app may not by default: a shipped
 * terminal that can reach `http://localhost:4000` can be pointed at a local
 * impersonator that collects the enrolment code and the device token.
 *
 * The one exception is deliberate and explicit: an operator running a packaged
 * build for a local demo or an on-site pilot sets `SCEPTRE_ALLOW_LOCAL_API=1`.
 * It is an environment variable rather than a `config.json` field because it has
 * to be opted into at launch, it warns on startup, and it leaves no setting
 * behind for the next person who opens the app.
 */
export const ALLOW_LOCAL_API_ENV = 'SCEPTRE_ALLOW_LOCAL_API'

export function allowsLocalOrigins(input: {
  isDev: boolean
  isPackaged: boolean
  allowLocalApi: boolean
}): boolean {
  return input.isDev || !input.isPackaged || input.allowLocalApi
}

/** The opt-in is the exact string `1`; `true`, `yes`, `0` and unset are all off. */
export function readAllowLocalApiFlag(env: Record<string, string | undefined>): boolean {
  return env[ALLOW_LOCAL_API_ENV] === '1'
}

export const CONFIG_FILE_NAME = 'config.json'

/**
 * The config file a build can bake beside the app resources (`process.resourcesPath`), written
 * by `forge.config.mts` from `SCEPTRE_API_BASE_URL` / `SCEPTRE_POWERSYNC_URL` at packaging time.
 */
export const BUNDLED_CONFIG_FILE_NAME = 'runtime-config.json'

export class ConfigError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

/** Reads one config file. Missing means "not configured here"; malformed fails closed. */
function readConfigFile(filePath: string): RuntimeConfig | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined
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

/**
 * Reads `userData/config.json`. A missing file means "not configured yet" and
 * falls back to the environment defaults; a malformed file fails closed.
 */
export function loadRuntimeConfig(userDataDir: string, local: boolean): RuntimeConfig {
  const fromFile = readConfigFile(path.join(userDataDir, CONFIG_FILE_NAME))
  return fromFile ?? defaultRuntimeConfig(local)
}

export interface ResolveRuntimeConfigOptions {
  userDataDir: string
  local: boolean
  /** `process.resourcesPath/runtime-config.json`, when the build baked one in. */
  bundledConfigPath?: string | undefined
}

/**
 * The configuration a packaged app actually uses.
 *
 * A baked file wins over `userData/config.json`. The URLs inside the installer are the ones the
 * build was tested against, and a stale or malformed file in the user profile must not be able to
 * stop the till from starting — which is exactly what a hand-written `config.json` did. Builds
 * without a baked file keep the documented per-machine file.
 */
export function resolveRuntimeConfig(options: ResolveRuntimeConfigOptions): RuntimeConfig {
  if (options.bundledConfigPath) {
    const bundled = readConfigFile(options.bundledConfigPath)
    if (bundled) return bundled
  }
  return loadRuntimeConfig(options.userDataDir, options.local)
}
