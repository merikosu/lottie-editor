import type { Animation } from '@/lottie/types'

/** True when text layers use fonts loaded from a URL (an SVG drawn as an image cannot load them). */
export function usesWebFonts(doc: Animation): boolean {
  return (doc.fonts?.list ?? []).some(
    (f) => typeof f.fPath === 'string' && f.fPath.length > 0 && !f.fPath.startsWith('data:'),
  )
}
