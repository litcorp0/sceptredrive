import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = path.resolve(import.meta.dirname, 'src/renderer')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': rendererRoot,
    },
    // Bun's store can surface a second React copy through symlinked deps.
    dedupe: ['react', 'react-dom'],
  },
  // PowerSync v2 ships ESM workers; pre-bundling breaks the worker URLs.
  optimizeDeps: {
    exclude: ['@powersync/web'],
  },
  worker: {
    format: 'es',
  },
  build: {
    // Renderer assets are served from the `app://gikautos` origin.
    target: 'chrome140',
  },
})
