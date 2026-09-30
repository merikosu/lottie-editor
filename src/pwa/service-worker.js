/**
 * Service worker: keeps the app's own files so it opens and works without a connection after
 * the first visit.
 *
 * This is a template. The build (`scripts/pwa-plugin.ts`) writes it to `sw.js` with the list of
 * files of that build and a version derived from them; development builds do not use it.
 *
 * - Every file of the build is downloaded once, when the worker installs.
 * - Hashed files (`assets/`) never change, so they are served from the cache.
 * - The page itself comes from the network when it answers quickly, so a new deployment shows
 *   up on the next visit; offline (or on a stalled connection) the cached copy is used.
 * - A new version installs in the background and waits: the page asks the user when to switch
 *   (`src/app/pwa.ts`), because an open editor may still load parts of the version it started with.
 */

// Replaced at build time. As a template these are placeholders, not the real values.
const VERSION = '__LE_VERSION__'
const PRECACHE = '__LE_PRECACHE__'

/** How long the page may take to arrive from the network before the cached copy is shown. */
const NAVIGATION_TIMEOUT = 4000

const SCOPE = new URL(self.registration.scope)
// The scope is part of the name: other sites on the same origin (GitHub Pages project sites
// share one) have their own caches, which this worker must never read or delete.
const CACHE_PREFIX = `lottie-editor:${SCOPE.pathname}:`
const CACHE = CACHE_PREFIX + VERSION
const INDEX_URL = new URL('index.html', SCOPE).href
const ASSETS_URL = new URL('assets/', SCOPE).href
const precached = new Set(PRECACHE.map((path) => new URL(path, SCOPE).href))

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE)
      // `reload` skips the HTTP cache: a stale copy must never become the offline copy.
      await cache.addAll(
        [...precached].map(
          (url) => new Request(url, { cache: 'reload', credentials: 'same-origin' }),
        ),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => self.caches.delete(key)),
      )
      // The first visit: take over the open page so it works offline without a reload.
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  url.hash = ''
  // Only this app's own files; everything else (other sites, linked animations) goes to the
  // network untouched.
  if (!url.href.startsWith(SCOPE.href)) return

  if (request.mode === 'navigate') {
    if (isAppPage(url)) event.respondWith(pageFromNetworkFirst(event))
    return
  }
  if (precached.has(url.href) || url.href.startsWith(ASSETS_URL)) {
    event.respondWith(fromCacheFirst(event, url.href))
  }
})

/** The app is one page: its root or index.html, with any query (`?sample=`, `?url=`). */
function isAppPage(url) {
  const path = url.pathname
  return path === SCOPE.pathname || path === `${SCOPE.pathname}index.html`
}

async function fromCacheFirst(event, key) {
  const cache = await self.caches.open(CACHE)
  const cached = await cache.match(key)
  if (cached) return cached
  // Not in this version's list (an older page asking for its own files): keep what arrives.
  const response = await fetch(event.request)
  if (response.ok && response.type === 'basic') {
    event.waitUntil(cache.put(key, response.clone()))
  }
  return response
}

async function pageFromNetworkFirst(event) {
  const cache = await self.caches.open(CACHE)
  const network = fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(INDEX_URL, response.clone()))
    }
    return response
  })
  // A late failure after the cached copy was served is expected offline, not an error.
  network.catch(() => {})
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT),
      ),
    ])
  } catch {
    const cached = await cache.match(INDEX_URL)
    // Nothing cached yet: let the browser show its own offline page.
    return cached ?? network
  }
}
