import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { buildContentSecurityPolicy, devContentSecurityPolicy } from './src/main/csp.ts'

const rendererRoot = path.resolve(import.meta.dirname, 'src/renderer')

/**
 * Injects the renderer's Content-Security-Policy into `index.html`.
 *
 * In a packaged build the protocol handler also *sends* the policy as a header;
 * the meta tag is the fallback for anything that loads the document without it.
 * Both sides use `buildContentSecurityPolicy`, so the two never disagree.
 */
function cspPlugin(dev: boolean): Plugin {
  // The meta policy is a *fallback* and must never be narrower than the header
  // the protocol handler sends: browsers enforce the intersection of both, so a
  // narrower meta would silently block origins the runtime policy allows (e.g.
  // a local API in an unpackaged build). The header remains authoritative.
  const policy = buildContentSecurityPolicy({ dev, allowLocalOrigins: true })
  // `frame-ancestors` is valid only as a header; browsers ignore it in a meta
  // tag and log a console warning. Drop it from the fallback rather than emit a
  // policy Chrome complains about. The header still enforces it.
  const metaPolicy = policy
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ')
  return {
    name: 'sceptre-csp',
    // The dev server sends the policy as a header (`server.headers`); the meta
    // tag exists for the packaged document, which always gets the header too but
    // must stay safe if it is ever served without it.
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--%SCEPTRE_CSP%-->',
        `<meta http-equiv="Content-Security-Policy" content="${metaPolicy}" />`,
      )
    },
  }
}

export default defineConfig(({ command }) => {
  const dev = command === 'serve'

  return {
    plugins: [react(), tailwindcss(), cspPlugin(dev)],
    resolve: {
      alias: {
        '@': rendererRoot,
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
