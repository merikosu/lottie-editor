/**
 * lottie-web font probes.
 *
 * For fonts without `fPath`, lottie-web appends hidden measuring <span>s to <body> and polls
 * them (up to 5 s) to detect when the font arrives; it never removes them, so every load leaks
 * a few nodes. Removing a probe that is still being polled makes lottie-web throw and the
 * animation never finishes loading — so only probes that belong to no live animation AND have
 * existed longer than the polling window are removed.
 */
import lottie, { type AnimationItem } from 'lottie-web'

const PROBE_TEXT = 'giItT1WQy@!-/#'
/** lottie-web polls for at most 5 s. */
const FONT_POLL_MS = 6000

const firstSeen = new WeakMap<Element, number>()

interface ProbedFont {
  monoCase?: { parent?: unknown }
  sansCase?: { parent?: unknown }
}

/** The measuring nodes lottie-web created for one animation. */
export function fontProbesOf(anim: AnimationItem): Element[] {
  const internals = anim as unknown as {
    renderer?: { globalData?: { fontManager?: { fonts?: unknown } } }
  }
  const fonts = internals.renderer?.globalData?.fontManager?.fonts
  if (!Array.isArray(fonts)) return []
  const out: Element[] = []
  for (const font of fonts as ProbedFont[]) {
    for (const probe of [font?.monoCase?.parent, font?.sansCase?.parent]) {
      if (probe instanceof Element) out.push(probe)
    }
  }
  return out
}

/** Removes leaked probes that are safe to remove (see the module comment). */
export function cleanupLottieFontProbes(): void {
  if (typeof document === 'undefined') return
  const live = new Set<Element>()
  // Not in lottie-web's typings, but part of its public runtime API.
  const registry = lottie as unknown as { getRegisteredAnimations?: () => AnimationItem[] }
  for (const anim of registry.getRegisteredAnimations?.() ?? []) {
    for (const probe of fontProbesOf(anim)) live.add(probe)
  }
  const now = Date.now()
  document.querySelectorAll('body > span[aria-hidden="true"]').forEach((el) => {
    if (!el.textContent?.includes(PROBE_TEXT) || live.has(el)) return
    const seen = firstSeen.get(el)
    if (seen === undefined) firstSeen.set(el, now)
    else if (now - seen > FONT_POLL_MS) el.remove()
  })
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Schedules a cleanup after the polling window (coalesces repeated calls). */
export function scheduleFontProbeCleanup(): void {
  cleanupLottieFontProbes() // records first-seen times
  clearTimeout(timer)
  timer = setTimeout(cleanupLottieFontProbes, FONT_POLL_MS + 500)
}
