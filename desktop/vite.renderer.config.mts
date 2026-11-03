import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import { devContentSecurityPolicy } from './src/main/csp.ts'

const rendererRoot = path.resolve(import.meta.dirname, 'src/renderer')

/**
 * The renderer's Content-Security-Policy is injected at request time, not built in.
 *
 * `index.html` keeps a `<!--%SCEPTRE_CSP%-->` placeholder that `serveRenderer`
 * (`src/main/protocol.ts`) fills from the policy in force. Baking it here cannot work: the
 * policy depends on the configured API origin, and the browser enforces the *intersection* of
 * the meta tag and the header, so a build-time copy silently blocked every fetch to a
 * configured host that was not in the bundle's list.
 *
 * In development the Vite server sends the header below and the placeholder stays a comment.
 */

export default defineConfig((): UserConfig => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rendererRoot,
        // Resolve the workspace source directly instead of its node_modules
        // symlink, so Vite watches new exports (and never serves a stale copy).
        '@sceptre/shared': path.resolve(import.meta.dirname, '../packages/shared/src/index.ts'),
      },
      // Bun's store can surface a second React copy through symlinked deps.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      headers: {
        // Dev is local by definition: the API, PowerSync, and HMR all live on
        // localhost. Building this policy without `allowLocalOrigins` blocked
        // enrolment silently — the browser refuses the fetch before the main
        // process (which allows it) is ever asked.
        'Content-Security-Policy': devContentSecurityPolicy(),
        'X-Content-Type-Options': 'nosniff',
      },
    },
    // PowerSync v2 ships ESM workers; pre-bundling breaks the worker URLs.
    // Workspace packages are source, not node_modules deps: pre-bundling them
    // leaves a cache that misses exports added since the last optimize (for
    // example REFUND_REASONS), which blanks the renderer with a SyntaxError.
    optimizeDeps: {
      exclude: ['@powersync/web', '@sceptre/shared'],
    },
    worker: {
      format: 'es',
    },
    build: {
      // Renderer assets are served from the `app://sceptre-drive` origin.
      target: 'chrome140',
      /**
       * Fonts are never inlined. The CSP is `font-src 'self'`, so a Base64
       * `data:` URI is blocked outright — and several `@fontsource` unicode-range
       * subsets (JetBrains Mono cyrillic, for one) are under Vite's 4 KiB
       * threshold. Widening the policy to `data:` would weaken it for every
       * font; opting fonts out of inlining keeps them real files on `app://`.
       */
      assetsInlineLimit: (filePath: string) =>
        /\.(?:woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
    },
  }
})
