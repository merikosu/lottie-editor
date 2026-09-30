/**
 * Whether a font family is available to the browser (installed locally or loaded as a web
 * font). Browsers do not expose the installed font list, so text is measured in the family
 * with different fallbacks: if any width differs from the fallback alone, the family exists.
 */
import { useSyncExternalStore } from 'react'
import { fontStack, isGenericFamily } from '@/lottie/text'

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
])
const SAMPLE = 'mmmmmmmmmmlli1WQy@!AaBb'
const FALLBACKS = ['monospace', 'serif', 'sans-serif']

const cache = new Map<string, boolean>()
let context: CanvasRenderingContext2D | null | undefined

function measure(font: string): number {
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  if (!context) return 0
  context.font = font
  return context.measureText(SAMPLE).width
}

export function isFontAvailable(family: string): boolean {
  const name = family.trim()
  if (!name) return false
  if (GENERIC.has(name.toLowerCase())) return true
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const quoted = `"${name.replace(/"/g, '\\"')}"`
  let available = false
  for (const fallback of FALLBACKS) {
    if (measure(`72px ${quoted}, ${fallback}`) !== measure(`72px ${fallback}`)) {
      available = true
      break
    }
  }
  cache.set(name, available)
  return available
}

/**
 * True when text in `family` (a family or a CSS stack such as "Inter Variable, Inter,
 * sans-serif") renders with an intended font: one of its named families is available. A stack
 * of generic families only always renders.
 */
export function isFontStackAvailable(family: string | undefined): boolean {
  const stack = fontStack(family)
  const named = stack.filter((f) => !isGenericFamily(f))
  if (named.length === 0) return stack.length > 0
  return named.some(isFontAvailable)
}

/* Web fonts finish loading later: invalidate and re-render then. */
let version = 0
const listeners = new Set<() => void>()

function onFontsLoaded() {
  cache.clear()
  version++
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', onFontsLoaded)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && document.fonts)
      document.fonts.removeEventListener('loadingdone', onFontsLoaded)
  }
}

/** Re-renders when fonts finish loading; returns a counter to use as a memo dependency. */
export function useFontsVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}
