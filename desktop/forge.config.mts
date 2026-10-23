import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'GikAutos POS',
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
      const source = path.join(import.meta.dirname, 'node_modules', '@node-rs')
      if (!existsSync(source)) {
        throw new Error(
          'Missing @node-rs/argon2 for packaging. Run `bun run setup` in desktop/ first.',
        )
      }
      cpSync(source, path.join(buildPath, 'node_modules', '@node-rs'), {
        recursive: true,
        dereference: true,
      })
    },
  },
  rebuildConfig: {},
  makers: [
    // Unsigned Windows installer (Phase 6). Signing and auto-update are Phase 9.
    new MakerSquirrel({ name: 'gikautos_pos' }),
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
