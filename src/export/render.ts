/**
 * Deterministic frame rendering for exports.
 *
 * Two renderers, matching the editor's canvas view setting:
 * - 'canvas': lottie-web's canvas renderer drawing into a detached canvas at the exact output
 *   size (device pixel ratio 1). Fast; lottie-web's canvas renderer lacks some effects.
 * - 'svg': lottie-web's SVG renderer in a hidden container; every frame is serialized and drawn
 *   onto the output canvas. Slower, but pixel-identical to the SVG preview (effects, blend modes).
 *
 * The composited frame (optional background color underneath) lands on `canvas`, from which the
 * encoders read (VideoFrame, getImageData, toBlob).
 *
 * The document is never handed to lottie-web directly: `prepareAnimationData` builds a JSON copy
 * (lottie-web mutates its input and throws on frozen objects), and images that cannot be loaded
 * from the file alone are replaced by a transparent pixel instead of the editor's placeholder.
 */
import lottie, { type AnimationConfigWithData, type AnimationItem } from 'lottie-web'
import { imageStatus, imageSrc } from '@/lottie/assets'
import type { Animation } from '@/lottie/types'
import { isImageAsset } from '@/lottie/types'
import { prepareAnimationData } from '@/player/prepare'

export type ExportRenderer = 'canvas' | 'svg'

/* -------------------------------------------------------------------------- */
/*                                   Yielding                                 */
/* -------------------------------------------------------------------------- */

/**
 * Yields to the event loop through a message (not setTimeout, which background tabs throttle
 * to once a second, and not scheduler.yield, which starves rendering in Chrome).
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.addEventListener('message', () => {
      port1.close()
      resolve()
    })
    port1.start()
    port2.postMessage(null)
  })
}

/** Returns a function that yields only when `budgetMs` of work has passed since the last yield. */
export function createYielder(budgetMs = 14): () => Promise<void> {
  let last = performance.now()
  return async () => {
    if (performance.now() - last < budgetMs) return
    await yieldToEventLoop()
    last = performance.now()
  }
}

/** The AbortSignal's reason as an error (DOMException 'AbortError' by default). */
export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The export was cancelled', 'AbortError')
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/* -------------------------------------------------------------------------- */
/*                               lottie-web errors                            */
/* -------------------------------------------------------------------------- */

/** 'config': a layer could not be built (content is missing); 'render': a frame failed. */
type ErrorKind = 'config' | 'render'
type ErrorListener = (error: Error, kind: ErrorKind) => void

const errorListeners = new WeakMap<object, ErrorListener>()
/** Listener for errors fired synchronously inside loadAnimation (before the item is known). */
let loadingListener: ErrorListener | null = null
let hookInstalled = false
const ignoreErrors: ErrorListener = () => undefined

function errorKind(event: unknown): ErrorKind {
  return (event as { type?: unknown } | null)?.type === 'renderFrameError' ? 'render' : 'config'
}

function toError(event: unknown): Error {
  const native = (event as { nativeError?: unknown } | null)?.nativeError
  if (native instanceof Error) return native
  if (typeof native === 'string' && native) return new Error(native)
  return new Error('lottie-web could not render the animation')
}

/**
 * lottie-web catches its own exceptions and reports them through `onError`, looked up on the
 * shared AnimationItem prototype. Wraps it once (keeping any other hook, e.g. the viewport's)
 * so export instances report their build and render errors.
 */
function installErrorHook(): void {
  if (hookInstalled) return
  hookInstalled = true
  let probe: AnimationItem | null = null
  try {
    probe = lottie.loadAnimation({
      container: document.createElement('div'),
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: { v: '5.7.0', fr: 30, ip: 0, op: 1, w: 1, h: 1, layers: [] },
    })
    const proto = Object.getPrototypeOf(probe) as { onError?: unknown }
    const previous = proto.onError
    proto.onError = function exportErrorHook(this: AnimationItem, event: unknown) {
      const listener = errorListeners.get(this) ?? loadingListener
      listener?.(toError(event), errorKind(event))
      if (typeof previous === 'function') (previous as (e: unknown) => void).call(this, event)
    }
  } catch (err) {
    console.warn('Could not hook lottie-web errors for export', err)
  } finally {
    probe?.destroy()
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Font probes                                */
/* -------------------------------------------------------------------------- */

interface ProbedFont {
  monoCase?: { parent?: unknown }
  sansCase?: { parent?: unknown }
}

/** The font-measuring nodes lottie-web added to <body> for one animation. */
function fontProbes(anim: AnimationItem): Element[] {
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

/** lottie-web polls its font probes for at most 5 s. */
const FONT_POLL_MS = 6000

/**
 * Moves an animation's font probes into a private container, and returns how to remove them.
 *
 * lottie-web measures hidden probes in <body> to detect when web fonts arrive, and throws
 * (leaving the animation never "loaded") if a probe it polls disappears. Other parts of the app
 * sweep leftover probes from <body> after their own loads; sheltered probes are out of their
 * reach, and this renderer never touches anybody else's. After loading, polling is over and the
 * probes go at once; an animation destroyed while loading keeps polling, so they go later.
 */
function shelterFontProbes(anim: AnimationItem): () => void {
  const probes = fontProbes(anim)
  if (!probes.length) return () => undefined
  const shelter = document.createElement('div')
  shelter.setAttribute('aria-hidden', 'true')
  shelter.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;'
  document.body.appendChild(shelter)
  shelter.append(...probes)
  let released = false
  return () => {
    if (released) return
    released = true
    if (anim.isLoaded) shelter.remove()
    else setTimeout(() => shelter.remove(), FONT_POLL_MS)
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Data setup                                */
/* -------------------------------------------------------------------------- */

/** 1 × 1 transparent PNG. */
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export interface ExportDataReport {
  /** Images the file references by relative path (not inside the file): rendered empty. */
  missingImages: number
  /** Images on other websites that could not be downloaded: rendered empty. */
  unreachableImages: number
}

/** The export's signal combined with a timeout (where the browser supports combining signals). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

async function fetchAsDataUri(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: withTimeout(signal, 8000) })
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.addEventListener('load', () =>
        resolve(typeof reader.result === 'string' ? reader.result : null),
      )
      reader.addEventListener('error', () => resolve(null))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * The render copy of a document for export. Linked images (http URLs) are downloaded and
 * embedded, so the SVG renderer (drawn as an image, which cannot load URLs) and the canvas
 * (which would be tainted) both work; images that cannot be loaded become transparent.
 */
export async function prepareExportData(
  doc: Animation,
  signal?: AbortSignal,
): Promise<{ data: Animation; report: ExportDataReport }> {
  const data = prepareAnimationData(doc, { tagNodes: false, imagePlaceholders: false })
  const report: ExportDataReport = { missingImages: 0, unreachableImages: 0 }
  const jobs: Promise<void>[] = []
  for (const asset of data.assets ?? []) {
    if (!isImageAsset(asset)) continue
    const status = imageStatus(asset)
    if (status === 'embedded') continue
    const setImage = (uri: string) => {
      asset.p = uri
      asset.u = ''
      asset.e = 1
    }
    if (status === 'missing') {
      report.missingImages++
      setImage(TRANSPARENT_PIXEL)
      continue
    }
    const src = imageSrc(asset)
    jobs.push(
      (src ? fetchAsDataUri(src, signal) : Promise.resolve(null)).then((uri) => {
        if (uri) setImage(uri)
        else {
          report.unreachableImages++
          setImage(TRANSPARENT_PIXEL)
        }
      }),
    )
  }
  await Promise.all(jobs)
  signal?.throwIfAborted()
  return { data, report }
}

/* -------------------------------------------------------------------------- */
/*                                   Loading                                  */
/* -------------------------------------------------------------------------- */

const LOAD_TIMEOUT_MS = 20_000

/** Resolves once lottie-web has loaded images and fonts (DOMLoaded), or after a timeout. */
function waitForLoaded(anim: AnimationItem, signal?: AbortSignal): Promise<void> {
  if (anim.isLoaded) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const offs: (() => void)[] = []
    const done = (fn: () => void) => () => {
      offs.forEach((off) => off())
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = done(() => reject(abortError(signal!)))
    // Fonts that never arrive must not hang the export: render with fallbacks after a while.
    const timer = setTimeout(done(resolve), LOAD_TIMEOUT_MS)
    offs.push(anim.addEventListener('DOMLoaded', done(resolve)))
    offs.push(
      anim.addEventListener(
        'data_failed',
        done(() => reject(new Error('The animation data failed to load'))),
      ),
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/* -------------------------------------------------------------------------- */
/*                                Frame renderer                              */
/* -------------------------------------------------------------------------- */

export interface FrameRendererOptions {
  width: number
  height: number
  /** CSS color painted under the animation; null keeps transparency. */
  background: string | null
  renderer: ExportRenderer
  /** Evaluate After Effects expressions (the editor's preference). */
  runExpressions: boolean
  /** The output is read back with getImageData every frame (GIF). */
  readback?: boolean
  signal?: AbortSignal
}

export interface FrameRenderer {
  /** Output canvas holding the last rendered frame. */
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly report: ExportDataReport
  /** Frame render errors reported by lottie-web so far (expressions, unsupported features). */
  readonly errors: number
  readonly lastError: Error | null
  /** Renders an absolute root-composition frame (fractional frames interpolate). */
  render(frame: number): Promise<void>
  destroy(): void
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function get2d(canvas: HTMLCanvasElement, readback: boolean): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: readback })
  if (!ctx) throw new Error('This browser cannot create a 2D canvas')
  return ctx
}

/** Position of an absolute frame for goToAndStop (clamped into the animation). */
function relativeFrame(anim: AnimationItem, frame: number): number {
  const max = Math.max(0, anim.totalFrames - 0.001)
  return Math.min(Math.max(0, frame - anim.firstFrame), max)
}

const svgSettings = (runExpressions: boolean) =>
  ({
    preserveAspectRatio: 'xMidYMid meet',
    viewBoxOnly: true,
    progressiveLoad: false,
    hideOnTransparent: true,
    // Not in lottie-web's typings (5.13), but honoured by every renderer.
    runExpressions,
  }) as never

/** Hidden, laid-out host for SVG instances (text measurement needs a rendered element). */
function createHost(width: number, height: number): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict;`
  document.body.appendChild(host)
  return host
}

/** Loads SVG markup into `img`; returns the object URL to revoke once the image is drawn. */
async function loadSvgImage(img: HTMLImageElement, markup: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => reject(new Error('The frame could not be rasterized')), {
        once: true,
      })
    })
    img.src = url
    try {
      await img.decode()
    } catch {
      // Some engines reject decode() for SVG images; the load event is enough to draw them.
      await loaded
    }
    return url
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/** Creates a renderer for one export. Call `destroy()` when done. */
export async function createFrameRenderer(
  doc: Animation,
  opts: FrameRendererOptions,
): Promise<FrameRenderer> {
  installErrorHook()
  const width = Math.max(1, Math.round(opts.width))
  const height = Math.max(1, Math.round(opts.height))
  const { data, report } = await prepareExportData(doc, opts.signal)
  const canvas = createCanvas(width, height)
  const context = get2d(canvas, !!opts.readback)

  let errors = 0
  let lastError: Error | null = null
  let buildError: Error | null = null
  const onError: ErrorListener = (error, kind) => {
    if (kind === 'config') {
      buildError ??= error
      return
    }
    errors++
    lastError = error
  }

  let anim: AnimationItem
  let host: HTMLDivElement | null = null
  let source: HTMLCanvasElement | null = null
  let svg: SVGSVGElement | null = null
  const image = new Image()

  loadingListener = onError
  try {
    if (opts.renderer === 'svg') {
      host = createHost(width, height)
      anim = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: svgSettings(opts.runExpressions),
      })
    } else {
      source = createCanvas(width, height)
      const lottieContext = get2d(source, false)
      const config = {
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: {
          context: lottieContext,
          clearCanvas: true,
          preserveAspectRatio: 'xMidYMid meet',
          // With a supplied context and no container, lottie-web renders at canvas.width × dpr.
          dpr: 1,
          runExpressions: opts.runExpressions,
        },
      }
      // `container` is typed as required, but a context without a container is supported.
      anim = lottie.loadAnimation(config as unknown as AnimationConfigWithData<'canvas'>)
    }
  } finally {
    loadingListener = null
  }
  errorListeners.set(anim, onError)
  const releaseProbes = shelterFontProbes(anim)

  const destroy = () => {
    releaseProbes()
    anim.destroy()
    host?.remove()
    if (source) source.width = source.height = 0
    image.removeAttribute('src')
  }

  try {
    await waitForLoaded(anim, opts.signal)
  } catch (err) {
    destroy()
    throw err
  }
  releaseProbes()
  // A build error means layers are missing: fail instead of exporting a broken file.
  if (buildError) {
    destroy()
    throw buildError
  }

  if (host) {
    svg = host.querySelector('svg')
    if (!svg) {
      destroy()
      throw new Error('lottie-web did not create an SVG element')
    }
    // Standalone size for serialization; lottie-web's inline style (100%, 3D transform) is for
    // the page and is dropped.
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.removeAttribute('style')
  }
  const serializer = new XMLSerializer()

  const composite = (draw: () => void) => {
    context.clearRect(0, 0, width, height)
    if (opts.background) {
      context.fillStyle = opts.background
      context.fillRect(0, 0, width, height)
    }
    draw()
  }

  return {
    canvas,
    context,
    report,
    get errors() {
      return errors
    },
    get lastError() {
      return lastError
    },
    async render(frame: number) {
      opts.signal?.throwIfAborted()
      anim.goToAndStop(relativeFrame(anim, frame), true)
      if (svg) {
        const url = await loadSvgImage(image, serializer.serializeToString(svg))
        try {
          composite(() => context.drawImage(image, 0, 0, width, height))
        } finally {
          URL.revokeObjectURL(url)
        }
      } else if (source) {
        const from = source
        composite(() => context.drawImage(from, 0, 0))
      }
    },
    destroy,
  }
}

/* -------------------------------------------------------------------------- */
/*                                  SVG frames                                */
/* -------------------------------------------------------------------------- */

export interface SvgFrameOptions {
  frame: number
  width: number
  height: number
  /** Painted as a full-size rect behind the animation; null keeps transparency. */
  background: string | null
  runExpressions: boolean
}

/**
 * One frame as a standalone SVG document: xmlns, viewBox, width/height and every image embedded
 * as a data URI, so it opens anywhere (browsers, Figma, Illustrator).
 */
export async function renderSvgFrame(
  doc: Animation,
  opts: SvgFrameOptions,
): Promise<{ markup: string; report: ExportDataReport }> {
  installErrorHook()
  const { data, report } = await prepareExportData(doc)
  const width = Math.max(1, Math.round(opts.width))
  const height = Math.max(1, Math.round(opts.height))
  const host = createHost(width, height)
  let anim: AnimationItem | null = null
  loadingListener = ignoreErrors
  try {
    anim = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: data,
      rendererSettings: svgSettings(opts.runExpressions),
    })
  } finally {
    loadingListener = null
  }
  const releaseProbes = shelterFontProbes(anim)
  try {
    await waitForLoaded(anim)
    anim.goToAndStop(relativeFrame(anim, opts.frame), true)
    const live = host.querySelector('svg')
    if (!live) throw new Error('lottie-web did not create an SVG element')
    const svg = live.cloneNode(true) as SVGSVGElement
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.removeAttribute('style')
    if (opts.background) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('width', '100%')
      rect.setAttribute('height', '100%')
      rect.setAttribute('fill', opts.background)
      svg.insertBefore(rect, svg.firstChild)
    }
    const markup = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`
    return { markup, report }
  } finally {
    releaseProbes()
    anim.destroy()
    host.remove()
  }
}

/* -------------------------------------------------------------------------- */
/*                                    Blobs                                   */
/* -------------------------------------------------------------------------- */

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))),
      type,
      quality,
    )
  })
}
