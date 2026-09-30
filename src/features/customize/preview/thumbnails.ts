/**
 * Thumbnails of elements: crops of still frames. One hidden lottie-web instance renders the
 * document; for each element the SVG is moved to the element's resting frame, its viewBox is
 * set to a square around the element (in root composition space) and the markup is saved as
 * an SVG image. The element is shown in context — with whatever is behind it — so it looks
 * like it does in the animation.
 */
import lottie from 'lottie-web'
import { useEffect, useRef, useState } from 'react'
import type { Box } from '@/lottie/bounds'
import type { Animation } from '@/lottie/types'
import { prepareAnimationData } from '@/player/prepare'

export interface ThumbnailRequest {
  key: string
  /** Root composition frame. */
  frame: number
  /** Element bounds in root composition space. */
  box: Box
}

/** Size of the rendered images (CSS pixels; shown at half size for sharp 2× screens). */
const SIZE = 80
/** Space around the element in the crop, as a fraction of its size. */
const MARGIN = 0.12
const RENDER_DELAY_MS = 350
/** How long the last render took: big files wait longer after an edit. */
let lastCost = 0
const LOAD_TIMEOUT_MS = 2000

function cropOf(box: Box): Box {
  const side = Math.max(box.w, box.h, 1) * (1 + MARGIN * 2)
  return { x: box.x + box.w / 2 - side / 2, y: box.y + box.h / 2 - side / 2, w: side, h: side }
}

function whenLoaded(anim: ReturnType<typeof lottie.loadAnimation>): Promise<void> {
  if (anim.isLoaded) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS)
    anim.addEventListener('DOMLoaded', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Renders the thumbnails as object URLs (the caller revokes them). */
async function render(
  doc: Animation,
  requests: readonly ThumbnailRequest[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!requests.length) return out
  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText =
    'position:fixed;left:-10000px;top:0;width:256px;height:256px;visibility:hidden;pointer-events:none;'
  document.body.appendChild(container)
  let anim: ReturnType<typeof lottie.loadAnimation> | null = null
  try {
    anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: prepareAnimationData(doc),
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: false,
        hideOnTransparent: true,
        runExpressions: false,
      } as never,
    })
    await whenLoaded(anim)
    const svg = container.querySelector('svg')
    if (!svg) return out
    const serializer = new XMLSerializer()
    for (const req of requests) {
      const relative = req.frame - anim.firstFrame
      anim.goToAndStop(Math.min(Math.max(0, relative), Math.max(0, anim.totalFrames - 0.001)), true)
      const clone = svg.cloneNode(true) as SVGSVGElement
      const crop = cropOf(req.box)
      clone.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.w} ${crop.h}`)
      clone.setAttribute('width', String(SIZE))
      clone.setAttribute('height', String(SIZE))
      clone.removeAttribute('style')
      const blob = new Blob([serializer.serializeToString(clone)], { type: 'image/svg+xml' })
      out.set(req.key, URL.createObjectURL(blob))
    }
  } catch (err) {
    console.warn('Customize: thumbnails failed', err)
  } finally {
    anim?.destroy()
    container.remove()
  }
  return out
}

/**
 * Thumbnails for `requests` (memoize them: a new array re-renders), rendered a moment after the
 * document changes, not while `paused`. The previous images stay up meanwhile.
 */
export function useThumbnails(
  doc: Animation | null,
  requests: readonly ThumbnailRequest[],
  paused = false,
): ReadonlyMap<string, string> {
  const [images, setImages] = useState<ReadonlyMap<string, string>>(() => new Map())
  const live = useRef<ReadonlyMap<string, string>>(images)

  useEffect(() => {
    if (!doc || paused || !requests.length) return
    let cancelled = false
    const timer = setTimeout(
      () => {
        const start = performance.now()
        void render(doc, requests).then((next) => {
          lastCost = performance.now() - start
          if (cancelled) {
            for (const url of next.values()) URL.revokeObjectURL(url)
            return
          }
          for (const url of live.current.values()) URL.revokeObjectURL(url)
          live.current = next
          setImages(next)
        })
      },
      Math.max(RENDER_DELAY_MS, lastCost * 4),
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [doc, paused, requests])

  // The images go with the component.
  useEffect(
    () => () => {
      for (const url of live.current.values()) URL.revokeObjectURL(url)
    },
    [],
  )

  return images
}
