/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './scripts/pwa-plugin.ts'

// Relative base so the build works from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    serviceWorker({
      template: fileURLToPath(new URL('./src/pwa/service-worker.js', import.meta.url)),
      publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
