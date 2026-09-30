/**
 * Runs an export: builds the file for a format from the document and the options, reporting
 * progress for rendered formats. Pure orchestration over `@/export/*`; the dialog and the
 * commands decide what to do with the result (download, copy, toast).
 */
import { buildEmbedSnippet, isInline, standaloneHtml } from '@/export/embed'
import { createGifSession } from '@/export/gif'
import { subsamplePixels, type GifCoreOptions } from '@/export/gif-core'
import {
  buildDotLottie,
  buildJsonFile,
  buildTgsDocument,
  encodeTgs,
  serializeJson,
  type DotLottieOptions,
} from '@/export/lottie-files'
import { gifDelays, gifRepeat, spreadIndices } from '@/export/plan'
import { ProgressClock, phaseProgress, type ProgressInfo } from '@/export/progress'
import { encodePngSequence } from '@/export/png-sequence'
import {
  canvasToBlob,
  createFrameRenderer,
  createYielder,
  renderSvgFrame,
  type ExportDataReport,
  type ExportRenderer,
} from '@/export/render'
import { detectVideoSupport, encodeVideo } from '@/export/video'
import { hexToRgba } from '@/lib/color'
import { fileStem } from '@/lottie/formats'
import type { Animation } from '@/lottie/types'
import type { DocumentMeta } from '@/store/document'
import type { WorkArea } from '@/store/playback'
import { planFrame, planRaster, planTimes, type RasterFormat } from './plan'
import type { ExportFormat, ExportPrefs } from './store'

export interface ExportInput {
  doc: Animation
  meta: Pick<DocumentMeta, 'fileName' | 'dotLottie'>
  prefs: ExportPrefs
  workArea: WorkArea | null
  /** Frame for the single-frame formats (absolute, root composition). */
  frame: number
  /** Full output file name, extension included. */
  fileName: string
  runExpressions: boolean
  renderer: ExportRenderer
}

export type ExportWarning =
  | { code: 'missing-images'; count: number }
  | { code: 'unreachable-images'; count: number }
  | { code: 'render-errors'; count: number }

export interface ExportOutput {
  blob: Blob
  fileName: string
  warnings: ExportWarning[]
}

export interface ExportHooks {
  onProgress?: (progress: ProgressInfo) => void
  signal?: AbortSignal
}

export type ExportErrorCode = 'video-unsupported' | 'clipboard-unsupported' | 'nothing-to-export'

/** Failure with a code the UI translates. */
export class ExportError extends Error {
  readonly code: ExportErrorCode
  constructor(code: ExportErrorCode, message: string) {
    super(message)
    this.name = 'ExportError'
    this.code = code
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Warnings                                  */
/* -------------------------------------------------------------------------- */

function dataWarnings(report: ExportDataReport, renderErrors = 0): ExportWarning[] {
  const out: ExportWarning[] = []
  if (report.missingImages) out.push({ code: 'missing-images', count: report.missingImages })
  if (report.unreachableImages)
    out.push({ code: 'unreachable-images', count: report.unreachableImages })
  if (renderErrors) out.push({ code: 'render-errors', count: renderErrors })
  return out
}

function rgb(
  hex: string,
  fallback: [number, number, number] = [255, 255, 255],
): [number, number, number] {
  const c = hexToRgba(hex)
  return c ? [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)] : fallback
}

/* -------------------------------------------------------------------------- */
/*                              Lottie-based files                            */
/* -------------------------------------------------------------------------- */

/** The document as the Telegram export writes it (fixes applied). */
export function tgsDocument(doc: Animation, prefs: ExportPrefs): Animation {
  return buildTgsDocument(doc, prefs.tgs)
}

/** dotLottie options of the web component embed (its player settings follow the snippet). */
export function dotLottieForEmbed(prefs: ExportPrefs): DotLottieOptions {
  return {
    ...prefs.dotlottie,
    loop: prefs.embed.loop,
    autoplay: prefs.embed.autoplay,
    includePackage: true,
  }
}

/** The embed snippet for the current options (the code a user copies). */
export function embedSnippet(doc: Animation, prefs: ExportPrefs, assetName: string) {
  const json = isInline(prefs.embed) ? serializeJson(doc, false) : ''
  return buildEmbedSnippet(doc, prefs.embed, assetName, json)
}

function fileOutput(
  bytes: Uint8Array<ArrayBuffer> | string,
  mime: string,
  fileName: string,
): ExportOutput {
  return { blob: new Blob([bytes], { type: mime }), fileName, warnings: [] }
}

/* -------------------------------------------------------------------------- */
/*                                   Frames                                   */
/* -------------------------------------------------------------------------- */

/** One frame as a PNG blob, with the "Frame (PNG)" options. */
export async function renderFramePng(
  input: ExportInput,
  signal?: AbortSignal,
): Promise<{ blob: Blob; warnings: ExportWarning[] }> {
  const plan = planFrame('framePng', input.doc, input.prefs.framePng)
  const renderer = await createFrameRenderer(input.doc, {
    width: plan.size.width,
    height: plan.size.height,
    background: plan.background,
    renderer: input.renderer,
    runExpressions: input.runExpressions,
    signal,
  })
  try {
    await renderer.render(input.frame)
    const blob = await canvasToBlob(renderer.canvas)
    return { blob, warnings: dataWarnings(renderer.report, renderer.errors) }
  } finally {
    renderer.destroy()
  }
}

/** One frame as standalone SVG markup, with the "Frame (SVG)" options. */
export async function renderFrameSvg(
  input: ExportInput,
): Promise<{ markup: string; warnings: ExportWarning[] }> {
  const plan = planFrame('frameSvg', input.doc, input.prefs.frameSvg)
  const { markup, report } = await renderSvgFrame(input.doc, {
    frame: input.frame,
    width: plan.size.width,
    height: plan.size.height,
    background: plan.background,
    runExpressions: input.runExpressions,
  })
  return { markup, warnings: dataWarnings(report) }
}

/* -------------------------------------------------------------------------- */
/*                                  Rendered                                  */
/* -------------------------------------------------------------------------- */

/** Frame file names inside the ZIP follow the archive name: "hero-frames.zip" → hero_0000.png. */
export function frameBaseName(zipName: string): string {
  return (
    fileStem(zipName)
      .replace(/[-_ ]?frames$/i, '')
      .trim() || 'frame'
  )
}

/** Pixels sampled for the global GIF palette (across all sample frames). */
const PALETTE_SAMPLE_PIXELS = 1_500_000
const PALETTE_SAMPLE_FRAMES = 12

async function renderedExport(
  format: RasterFormat,
  input: ExportInput,
  hooks: ExportHooks,
): Promise<ExportOutput> {
  const { doc, prefs, signal } = { ...input, signal: hooks.signal }
  const plan = planRaster(format, doc, prefs, input.workArea)
  const times = planTimes(plan)
  const total = times.length
  const progress = hooks.onProgress ?? (() => undefined)
  progress(phaseProgress('preparing', total))

  let codec: Awaited<ReturnType<typeof detectVideoSupport>>['codec'] = null
  if (format === 'mp4' || format === 'webm') {
    const support = await detectVideoSupport(format, {
      width: plan.size.width,
      height: plan.size.height,
      fps: plan.fps,
    })
    if (!support.codec)
      throw new ExportError('video-unsupported', `No ${format} encoder is available`)
    codec = support.codec
  }

  const renderer = await createFrameRenderer(doc, {
    width: plan.size.width,
    height: plan.size.height,
    background: plan.background,
    renderer: input.renderer,
    runExpressions: input.runExpressions,
    readback: format === 'gif',
    signal,
  })
  const clock = new ProgressClock(total, performance.now())
  const report = (done: number) => progress(clock.tick(done, performance.now()))
  const yieldNow = createYielder()
  const render = (index: number) => renderer.render(times[index])
  let blob: Blob
  try {
    if (format === 'gif') {
      blob = await encodeGif(input, plan.size, times, plan.fps, renderer, {
        report,
        yieldNow,
        signal,
        progress,
      })
    } else if (format === 'png') {
      blob = await encodePngSequence({
        frameCount: total,
        baseName: frameBaseName(input.fileName),
        canvas: renderer.canvas,
        renderFrame: render,
        onFrame: report,
        yieldNow,
        signal,
      })
    } else {
      const video = await encodeVideo({
        container: format,
        codec: codec!,
        canvas: renderer.canvas,
        renderFrame: render,
        frameCount: total,
        fps: plan.fps,
        quality: prefs[format].quality,
        transparent: format === 'webm' && prefs.webm.transparent,
        onFrame: report,
        onFinishing: () => progress(phaseProgress('finishing', total, total)),
        yieldNow,
        signal,
      })
      blob = video.blob
    }
  } finally {
    renderer.destroy()
  }
  return {
    blob,
    fileName: input.fileName,
    warnings: dataWarnings(renderer.report, renderer.errors),
  }
}

/** Encoder options for the GIF preferences (without the size). */
export function gifCoreOptions(g: ExportPrefs['gif']): Omit<GifCoreOptions, 'width' | 'height'> {
  const transparent = g.background === 'transparent'
  return {
    maxColors: Number(g.colors),
    dither: g.dither,
    transparent,
    alphaThreshold: Math.min(255, Math.max(1, Math.round((g.threshold / 100) * 255))),
    matte: rgb(transparent ? g.matte : g.color),
    repeat: g.loop === 'forever' ? 0 : g.loop === 'once' ? -1 : gifRepeat(g.plays),
    optimize: true,
  }
}

async function encodeGif(
  input: ExportInput,
  size: { width: number; height: number },
  times: number[],
  fps: number,
  renderer: Awaited<ReturnType<typeof createFrameRenderer>>,
  io: {
    report: (done: number) => void
    yieldNow: () => Promise<void>
    signal?: AbortSignal
    progress: (p: ProgressInfo) => void
  },
): Promise<Blob> {
  const g = input.prefs.gif
  const { width, height } = size
  const session = await createGifSession({ ...gifCoreOptions(g), width, height })
  try {
    const read = () => renderer.context.getImageData(0, 0, width, height).data
    if (g.palette === 'global') {
      // One palette for the whole GIF, from frames spread over the animation (no flicker).
      const picks = spreadIndices(times.length, PALETTE_SAMPLE_FRAMES)
      const perSample = Math.floor(PALETTE_SAMPLE_PIXELS / Math.max(1, picks.length))
      const samples: Uint8ClampedArray[] = []
      for (const index of picks) {
        io.signal?.throwIfAborted()
        await renderer.render(times[index])
        samples.push(subsamplePixels(read(), perSample))
        await io.yieldNow()
      }
      await session.setGlobalPalette(samples)
    }
    const delays = gifDelays(times.length, fps)
    for (let i = 0; i < times.length; i++) {
      io.signal?.throwIfAborted()
      await renderer.render(times[i])
      await session.addFrame(read(), delays[i])
      io.report(session.encoded)
      await io.yieldNow()
    }
    io.progress(phaseProgress('finishing', times.length, session.encoded))
    const bytes = await session.finish()
    io.report(times.length)
    return new Blob([bytes], { type: 'image/gif' })
  } finally {
    session.dispose()
  }
}

/* -------------------------------------------------------------------------- */
/*                                    Entry                                   */
/* -------------------------------------------------------------------------- */

export async function runExport(
  format: ExportFormat,
  input: ExportInput,
  hooks: ExportHooks = {},
): Promise<ExportOutput> {
  const { doc, prefs, fileName } = input
  switch (format) {
    case 'json': {
      const file = buildJsonFile(doc, prefs.json, fileName)
      return fileOutput(file.bytes, file.mime, fileName)
    }
    case 'dotlottie': {
      const file = buildDotLottie(doc, prefs.dotlottie, fileName, input.meta.dotLottie)
      return fileOutput(file.bytes, file.mime, fileName)
    }
    case 'tgs':
      // An unknown type keeps browsers from renaming the file to .tgs.gz.
      return fileOutput(encodeTgs(tgsDocument(doc, prefs)), 'application/x-tgsticker', fileName)
    case 'embed': {
      if (prefs.embed.flavor === 'wc') {
        const file = buildDotLottie(doc, dotLottieForEmbed(prefs), fileName, input.meta.dotLottie)
        return fileOutput(file.bytes, file.mime, fileName)
      }
      if (isInline(prefs.embed)) {
        const snippet = embedSnippet(doc, prefs, fileName)
        return fileOutput(
          standaloneHtml(doc.nm ?? fileStem(fileName), snippet.code),
          'text/html',
          fileName,
        )
      }
      return fileOutput(serializeJson(doc, false), 'application/json', fileName)
    }
    case 'framePng': {
      const { blob, warnings } = await renderFramePng(input, hooks.signal)
      return { blob, fileName, warnings }
    }
    case 'frameSvg': {
      const { markup, warnings } = await renderFrameSvg(input)
      return { blob: new Blob([markup], { type: 'image/svg+xml' }), fileName, warnings }
    }
    case 'gif':
    case 'mp4':
    case 'webm':
    case 'png':
      return renderedExport(format, input, hooks)
  }
}
