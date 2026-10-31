import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
	/**
	 * The prefix that client-side variables must have. This is enforced both at
	 * a type-level and at runtime.
	 */
	clientPrefix: "VITE_",

	client: {
		/**
		 * The API origin the **browser** calls, e.g. `http://localhost:4000`.
		 *
		 * A deployed console points this at its own origin and proxies `/api/*` to
		 * the API (`API_URL`, see `vite.config.ts`), so the session cookie is
		 * first-party and the server-side guard can read it. Inlined at build time.
		 */
		VITE_API_URL: z.url(),
		VITE_APP_TITLE: z.string().min(1).optional(),
	},

	/**
	 * What object holds the environment variables at runtime. This is usually
	 * `process.env` or `import.meta.env`.
	 */
	runtimeEnv: import.meta.env,

	/**
	 * By default, this library will feed the environment variables directly to
	 * the Zod validator.
	 *
	 * This means that if you have an empty string for a value that is supposed
	 * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
	 * it as a type mismatch violation. Additionally, if you have an empty string
	 * for a value that is supposed to be a string with a default value (e.g.
	 * `DOMAIN=` in an ".env" file), the default value will never be applied.
	 *
	 * In order to solve these issues, we recommend that all new projects
	 * explicitly specify this option as true.
	 */
	emptyStringAsUndefined: true,
})
