import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'

/**
 * The NuGet package id Squirrel installs under, and the packaged executable name.
 *
 * Both are deliberately one camel-case word. Squirrel stamps the Start Menu
 * shortcut with `com.squirrel.<package id>.<exe name minus .exe>`, and NuGet ids
 * cannot contain spaces; a space anywhere in that chain gives Windows a second
 * taskbar group for the same app. Kept identical in `src/main/identity.ts`, which
 * is what the running app announces.
 */
const SQUIRREL_PACKAGE_ID = 'SceptreDrivePOS'

/**
 * Icon base path, without an extension: @electron/packager appends `.ico` on
 * Windows and `.png` on Linux from this one value. Generated from
 * `packages/brand/assets/logo-icon.png` (512×512) — see `desktop/README.md`.
 */
const ICON_BASE = path.join(import.meta.dirname, 'icons', 'icon')

if (!existsSync(`${ICON_BASE}.ico`)) {
  throw new Error(
    `Missing ${ICON_BASE}.ico. Regenerate it from the brand master (desktop/README.md).`,
  )
}

/**
 * Bake the API and PowerSync origins into the package.
 *
 * A shipped till should not need somebody to hand-write `config.json` in `%APPDATA%` before it
 * will start, and a malformed file there closed the window with no explanation. When the build
 * supplies both origins they are written next to the app resources, and the running app prefers
 * that copy over anything in userData (`src/main/config.ts`).
 *
 * Both or neither: a half-configured bake would ship a build that points one service at staging
 * and the other at production.
 */
function bakedRuntimeConfig(): string | undefined {
  const apiBaseUrl = process.env.SCEPTRE_API_BASE_URL?.trim()
  const powersyncUrl = process.env.SCEPTRE_POWERSYNC_URL?.trim()

  if (!apiBaseUrl && !powersyncUrl) return undefined
  if (!apiBaseUrl || !powersyncUrl) {
    throw new Error(
      'Set both SCEPTRE_API_BASE_URL and SCEPTRE_POWERSYNC_URL to bake the till configuration, or neither.',
    )
  }

  for (const [name, value] of [
    ['SCEPTRE_API_BASE_URL', apiBaseUrl],
    ['SCEPTRE_POWERSYNC_URL', powersyncUrl],
  ] as const) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`${name} is not a URL: ${value}`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`${name} must be an http(s) URL: ${value}`)
    }
  }

  const target = path.join(import.meta.dirname, 'build', 'runtime-config.json')
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify({ apiBaseUrl, powersyncUrl }, null, 2)}\n`)
  console.log(`[forge] baked runtime config: ${apiBaseUrl} / ${powersyncUrl}`)
  return target
}

const bundledConfig = bakedRuntimeConfig()

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Sceptre Drive POS',
    executableName: SQUIRREL_PACKAGE_ID,
    /**
     * Windows embeds the icon in the `.exe`; Linux ignores this option and uses
     * the `BrowserWindow` icon instead. macOS needs a `.icns` before `make` is
     * attempted there, so it is left unset rather than failing the build.
     */
    ...(process.platform === 'darwin' ? {} : { icon: ICON_BASE }),
    /** Empty when the build did not bake URLs, which keeps the per-machine file working. */
    extraResource: bundledConfig ? [bundledConfig] : [],
  },
  hooks: {
    /**
     * The Vite plugin ignores everything except `/.vite`, so native runtime
     * modules have to be copied into the package after the copy/prune steps.
     * `desktop/node_modules/@node-rs` is materialised by
     * `scripts/prepare-desktop.mjs` (the wrapper plus the platform package for
     * the build host). AutoUnpackNatives then unpacks the `.node` binary.
     */
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      /**
       * Runtime packages were materialised by `scripts/prepare-desktop.mjs`,
       * which writes the exact list (including transitive dependencies such as
       * `iconv-lite` → `safer-buffer`) to `node_modules/.runtime-packages.json`.
       * Reading it means Forge cannot silently miss a dependency.
       */
      const listPath = path.join(import.meta.dirname, 'node_modules', '.runtime-packages.json')
      if (!existsSync(listPath)) {
        throw new Error('Missing runtime dependency list. Run `bun run setup` in desktop/ first.')
      }
      const { packages } = JSON.parse(readFileSync(listPath, 'utf8'))
      for (const name of packages) {
        const source = path.join(import.meta.dirname, 'node_modules', name)
        if (!existsSync(source)) {
          throw new Error(`Missing ${name} for packaging. Run \`bun run setup\` in desktop/ first.`)
        }
        cpSync(source, path.join(buildPath, 'node_modules', name), {
          recursive: true,
          dereference: true,
        })
      }
    },
  },
  rebuildConfig: {},
  makers: [
    // Unsigned Windows installer (Phase 6). Signing and auto-update are Phase 9.
    new MakerSquirrel({
      name: SQUIRREL_PACKAGE_ID,
      // Icon for Setup.exe itself. The app icon inside the package comes from
      // `packagerConfig.icon` above; `iconUrl` (the Control Panel icon) needs a
      // public HTTPS URL, so it lands with the production domain in Phase 15.
      setupIcon: `${ICON_BASE}.ico`,
    }),
    new MakerZIP({}, ['linux', 'darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}

export default config
