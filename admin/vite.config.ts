import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

const config = defineConfig({
	// Load VITE_* variables from the repository-root .env (single source of truth).
	envDir: "..",
	resolve: {
		tsconfigPaths: true,
		alias: {
			// Watch the workspace source rather than the node_modules symlink, so a
			// new export is picked up without a dev-server restart.
			"@sceptre/shared": path.resolve(import.meta.dirname, "../packages/shared/src/index.ts"),
		},
		// Bun's store can surface a second React copy through symlinked deps
		// (e.g. sonner), which breaks SSR hooks. Force a single instance.
		dedupe: ["react", "react-dom"],
	},
	ssr: {
		// Bundle sonner into the SSR build so its React import resolves through
		// Vite (deduped) instead of Node resolving a second copy from the store.
		noExternal: ["sonner"],
	},
	build: {
		// Fonts are never inlined. `@fontsource` ships many unicode-range subsets,
		// and the small ones (JetBrains Mono cyrillic) fall under Vite's 4 KiB
		// threshold — so they became `data:` URIs, which `font-src 'self'` blocks
		// in the desktop client and which the browser will not cache here either.
		// The desktop CSP is deliberately not widened; both apps keep fonts as
		// real files.
		assetsInlineLimit: (filePath: string) =>
			/\.(?:woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
	},
	plugins: [
		devtools(),
		nitro({ rollupConfig: { external: [/^@sentry\//] } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
})

export default config
