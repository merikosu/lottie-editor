/**
 * Static thumbnails for the recent files list: one frame rendered by lottie-web into a small
 * canvas and encoded as a data URL.
 *
 * The canvas renderer is used when it can draw everything (it needs no DOM and is fast). It only
 * draws text from embedded glyphs, though, so documents with live text are rendered with the SVG
 * renderer instead and rasterized: otherwise their thumbnails would lose every word.
 */
import lottie, { type AnimationConfigWithData, type AnimationItem } from 'lottie-web'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation } from '@/lottie/types'
import { scheduleFontProbeCleanup } from '@/player/font-probes'
import { prepareAnimationData } from '@/player/prepare'

export interface ThumbnailOptions {
  /** Longest side in pixels (the list shows it at half size for crisp HiDPI output). */
  size?: number
  /** Frame to show as a fraction of the duration (1/3 by default). */
  at?: number
  /** Give up waiting for images/fonts after this many milliseconds. */
  timeoutMs?: number
}

/** True when text layers rely on fonts rather than glyph shapes (the canvas renderer skips them). */
export function hasLiveText(doc: Animation): boolean {
  if (Array.isArray(doc.chars) && doc.chars.length > 0) return false
  let found = false
  forEachLayer(doc, (layer) => {
    if (layer.ty !== 5) return
    found = true
    return false
  })
  return found
}

function waitLoaded(anim: AnimationItem, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (anim.isLoaded) return resolve()
    const timer = setTimeout(resolve, timeoutMs)
    anim.addEventListener('DOMLoaded', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function frameAt(doc: Animation, anim: AnimationItem, at: number): number {
  const frames = Math.max(0, doc.op - doc.ip)
  return Math.min(Math.floor(frames * at), Math.max(0, anim.totalFrames - 1))
}

function encode(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', 0.9)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}

/** Canvas renderer drawing straight into the thumbnail's context (no container needed). */
async function drawWithCanvas(
  doc: Animation,
  context: CanvasRenderingContext2D,
  at: number,
  timeoutMs: number,
): Promise<void> {
  let anim: AnimationItem | null = null
  try {
    const config = {
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: prepareAnimationData(doc),
      // runExpressions is not in lottie-web's typings (5.13) but honoured by every renderer.
      rendererSettings: {
        context,
        clearCanvas: true,
        preserveAspectRatio: 'xMidYMid meet',
        runExpressions: false,
      },
    }
    // No container: the canvas renderer draws into the given context (the typings require one).
    anim = lottie.loadAnimation(config as unknown as AnimationConfigWithData<'canvas'>)
    await waitLoaded(anim, timeoutMs)
    anim.goToAndStop(frameAt(doc, anim, at), true)
  } finally {
    anim?.destroy()
  }
}

/** SVG renderer in an off-screen container, serialized and drawn as an image. */
async function drawWithSvg(
  doc: Animation,
  canvas: HTMLCanvasElement,
  at: number,
  timeoutMs: number,
): Promise<void> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${canvas.width}px;height:${canvas.height}px;pointer-events:none;visibility:hidden;`
  document.body.appendChild(host)
  let anim: AnimationItem | null = null
  let url: string | null = null
  try {
    anim = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: prepareAnimationData(doc),
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: false,
        runExpressions: false,
      } as never,
    })
    await waitLoaded(anim, timeoutMs)
    anim.goToAndStop(frameAt(doc, anim, at), true)
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('lottie-web rendered no SVG')
    const copy = svg.cloneNode(true) as SVGSVGElement
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('width', String(canvas.width))
    copy.setAttribute('height', String(canvas.height))
    copy.removeAttribute('style')
    url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
    )
    const image = new Image()
    image.src = url
    await image.decode()
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally {
    anim?.destroy()
    host.remove()
    if (url) URL.revokeObjectURL(url)
  }
}

/** Renders a thumbnail data URL (WebP when the browser can encode it, else PNG); null on failure. */
export async function renderThumbnail(
  doc: Animation,
  opts: ThumbnailOptions = {},
): Promise<string | null> {
  const size = opts.size ?? 160
  const w = doc.w > 0 ? doc.w : 512
  const h = doc.h > 0 ? doc.h : 512
  const scale = size / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  const at = opts.at ?? 1 / 3
  const timeoutMs = opts.timeoutMs ?? 4000
  try {
    if (hasLiveText(doc)) {
      try {
        await drawWithSvg(doc, canvas, at, timeoutMs)
        return encode(canvas)
      } catch (err) {
        // Some browsers refuse to rasterize SVG images: a thumbnail without text is still useful.
        console.warn('SVG thumbnail failed, using the canvas renderer', err)
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
    await drawWithCanvas(doc, context, at, timeoutMs)
    return encode(canvas)
  } catch (err) {
    console.warn('Thumbnail rendering failed', err)
    return null
  } finally {
    scheduleFontProbeCleanup()
  }
}

/** Runs a task when the browser is idle (or soon, where requestIdleCallback is missing). */
export function whenIdle(task: () => void, timeout = 2000): void {
  const ric = (
    window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback
  if (ric) ric(task, { timeout })
  else setTimeout(task, 200)
}
