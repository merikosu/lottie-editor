import { defineConfig } from '@playwright/test'

const PORT = 4173
/**
 * The suite tests the production bundle. It is built into its own folder so a run never races
 * with (or overwrites) `dist`, and without the type-check (`npm run typecheck` covers that).
 */
const OUT_DIR = 'node_modules/.cache/e2e-dist'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // A fresh profile per test: English UI, dark theme, no stored preferences or autosave.
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    // Previews that would autoplay (home cards, export dialog) stay still: less CPU, no flake.
    reducedMotion: 'reduce',
    // The production build installs a service worker that caches the whole app; tests that do
    // not exercise it run without one (offline.spec.ts allows it).
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Desktop Chrome with the host's own user agent (not the "Desktop Chrome" device's Windows
      // one): the app and CodeMirror both derive ⌘ vs Ctrl from the platform, and a spoofed UA
      // on a Mac splits them. Tests press "mod" shortcuts through `pressShortcut`, so they run
      // with ⌘ on macOS and Ctrl on Linux CI.
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command:
      `npx vite build --outDir ${OUT_DIR} --emptyOutDir --logLevel error && ` +
      `npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    // Always a fresh build of the working tree (it takes seconds). `vite preview` of `dist` also
    // defaults to this port: reusing whatever answers there could test a stale bundle, so a busy
    // port fails the run with a clear message instead.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
