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
		// Bun's store can surface a second React copy through symlinked deps
		// (e.g. sonner), which breaks SSR hooks. Force a single instance.
		dedupe: ["react", "react-dom"],
	},
	ssr: {
		// Bundle sonner into the SSR build so its React import resolves through
		// Vite (deduped) instead of Node resolving a second copy from the store.
		noExternal: ["sonner"],
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
