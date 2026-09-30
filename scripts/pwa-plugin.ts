/**
 * Vite plugin: writes the service worker (`sw.js`) of a production build.
 *
 * The worker (`src/pwa/service-worker.js`) needs the list of files to keep for offline use.
 * Their names carry content hashes, so the list is only known once the bundle is written:
 * this plugin fills it in, together with a version derived from the list, the public files and
 * the worker itself. Any change to the app therefore yields a new worker, which is how browsers
 * notice an update.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

export interface ServiceWorkerOptions {
  /** Path of the worker template. */
  template: string
  /** Vite's public directory (copied to the build as is). */
  publicDir: string
}

/** Files that are never needed offline. */
const SKIP = /\.map$|(^|\/)\.[^/]+$/

function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out
}

export function serviceWorker({ template, publicDir }: ServiceWorkerOptions): Plugin {
  return {
    name: 'lottie-editor:service-worker',
    apply: 'build',
    // After Vite has emitted index.html and every chunk.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const source = readFileSync(template, 'utf8')
      const publicFiles = listFiles(publicDir)
      const files = [...new Set(['index.html', ...Object.keys(bundle), ...publicFiles])]
        .filter((file) => !SKIP.test(file) && file !== 'sw.js')
        .sort()

      const hash = createHash('sha256').update(source).update(files.join('\n'))
      // Public files keep their names when they change (the manifest, icons).
      for (const file of publicFiles) hash.update(readFileSync(join(publicDir, file)))
      const version = hash.digest('hex').slice(0, 12)

      const code = source
        .replace("'__LE_VERSION__'", JSON.stringify(version))
        .replace("'__LE_PRECACHE__'", JSON.stringify(files))
      if (code.includes('__LE_'))
        throw new Error('service worker template: placeholder not replaced')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code })
    },
  }
}
