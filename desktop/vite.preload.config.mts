import { defineConfig } from 'vite'

// Sandboxed preload scripts must be CommonJS; the Forge Vite plugin emits
// `.vite/build/preload.cjs` for this target.
export default defineConfig({})
