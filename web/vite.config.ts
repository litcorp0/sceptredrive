import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

const config = defineConfig({
	// Read VITE_* and server-side WEB_API_URL from the repository-root .env, like
	// both other clients. One file is the source of truth for every workspace.
	envDir: "..",
	resolve: {
		tsconfigPaths: true,
		alias: {
			// Watch the workspace source rather than the node_modules symlink, so a new
			// export is picked up without a dev-server restart (see admin/vite.config.ts).
			"@sceptre/shared": path.resolve(import.meta.dirname, "../packages/shared/src/index.ts"),
		},
		// One React in the browser. The monorepo has one version through the catalog,
		// and an optimizer re-run must not be able to surface a second copy.
		dedupe: ["react", "react-dom"],
	},
	build: {
		// Fonts stay real files: the POS CSP blocks data: fonts, and the site should
		// cache them once rather than inline a dozen unicode-range subsets.
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
