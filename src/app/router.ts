/**
 * Hash router for the three services (works on static hosting such as GitHub Pages):
 *   #/          home — pick a service, recent files, samples
 *   #/edit      the full editor
 *   #/customize quick customization (replace logos, brand colors, texts)
 *   #/optimize  the Lottie optimizer (batch compression with visual verification)
 * Without a hash the app opens the editor when a document is open (e.g. a restored session),
 * otherwise the home page.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { useDocument } from '@/store/document'

export type Route = 'home' | 'edit' | 'customize' | 'optimize'

export const ROUTES: Route[] = ['home', 'edit', 'customize', 'optimize']

function parseHash(hash: string): Route | null {
  const name = hash.replace(/^#\/?/, '').split(/[?/]/)[0]
  if (name === '') return hash.startsWith('#/') ? 'home' : null
  return (ROUTES as string[]).includes(name) ? (name as Route) : null
}

interface RouterState {
  /** Route from the URL hash, or null when the hash is empty. */
  hashRoute: Route | null
}

export const useRouter = create<RouterState>()(() => ({
  hashRoute: typeof location === 'undefined' ? null : parseHash(location.hash),
}))

/** The route to display (resolves an empty hash). */
export function useRoute(): Route {
  const hashRoute = useRouter((s) => s.hashRoute)
  const hasDoc = useDocument((s) => s.doc !== null)
  return hashRoute ?? (hasDoc ? 'edit' : 'home')
}

export function currentRoute(): Route {
  const { hashRoute } = useRouter.getState()
  return hashRoute ?? (useDocument.getState().doc ? 'edit' : 'home')
}

/** Navigates to a service (pushes a history entry unless `replace`). */
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = route === 'home' ? '#/' : `#/${route}`
  if (location.hash !== hash) {
    if (opts.replace)
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
    else history.pushState(null, '', `${location.pathname}${location.search}${hash}`)
  }
  useRouter.setState({ hashRoute: route })
}

function syncFromLocation() {
  useRouter.setState({ hashRoute: parseHash(location.hash) })
}

/** Keeps the router in sync with back/forward navigation. */
export function useRouterSync(): void {
  useEffect(() => {
    window.addEventListener('hashchange', syncFromLocation)
    window.addEventListener('popstate', syncFromLocation)
    return () => {
      window.removeEventListener('hashchange', syncFromLocation)
      window.removeEventListener('popstate', syncFromLocation)
    }
  }, [])
}
