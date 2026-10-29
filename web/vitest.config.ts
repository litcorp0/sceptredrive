import { defineConfig } from "vitest/config"

/**
 * Unit tests for the content helpers only. The app's Vite config is not loaded
 * here on purpose: the TanStack Start plugin starts dev servers, which makes a
 * node-only suite wait to exit.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
})
