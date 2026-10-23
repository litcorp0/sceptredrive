import { defineConfig } from 'vite'

// The Forge Vite plugin externalises `electron` and Node built-ins for the main
// target and emits `.vite/build/main.cjs`. Native N-API modules must stay
// external as well: Rollup cannot bundle a `.node` binary, and Forge copies the
// installed package (see `scripts/prepare-desktop.mjs`).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['@node-rs/argon2', /^@node-rs\/argon2-/, '@maxxuxx/node-printer'],
    },
  },
})
