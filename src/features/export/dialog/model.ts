/**
 * Everything the export dialog derives from the document and the options: plans, file sizes
 * (computed in the background, debounced), encoder support, the footer summary and what the
 * preview shows.
 */
import { gzip } from 'fflate'
import { useEffect, useMemo } from 'react'
import { buildEmbedSnippet, isInline, type EmbedSnippet } from '@/export/embed'
import {
  buildDotLottie,
  buildJsonFile,
  encodeTgs,
  packageInfo,
  resolveDotLottieVersion,
  serializeJson,
  TGS_RULES,
  transformDocument,
  utf8,
  type PackageInfo,
} from '@/export/lottie-files'
import {
  estimateGif,
  estimatePngSequence,
  estimateVideo,
  releaseEstimateRenderer,
} from '@/export/estimate'
import { gifDelays, lastFrameOf } from '@/export/plan'
import { yieldToEventLoop } from '@/export/render'
import { checkTelegram, type TgsReport } from '@/export/telegram'
import { CODEC_NAMES, detectVideoSupport, hasWebCodecs, type VideoSupport } from '@/export/video'
import type { VideoCodec } from 'mediabunny'
import type { Dict } from '@/i18n'
import type { Formatter } from '../format'
import type { Animation } from '@/lottie/types'
import type { DocumentMeta } from '@/store/document'
import type { WorkArea } from '@/store/playback'
import { formatExtension } from '../formats'
import {
  isFrameFormat,
  isRasterFormat,
  planFrame,
  planRaster,
  planTimes,
  type FramePlan,
  type RasterPlan,
} from '../plan'
import {
  dotLottieForEmbed,
  gifCoreOptions,
  renderFrameSvg,
  tgsDocument,
  type ExportInput,
} from '../run'
import type { ExportFormat, ExportPrefs } from '../store'
import type { PreviewMode } from './Preview'
import { useAsync, type AsyncState } from './use-async'

/** Compressed size without blocking the page (fflate compresses in a worker). */
export function gzipSizeAsync(bytes: Uint8Array, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const stop = gzip(bytes, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out.length)))
    signal?.addEventListener('abort', () => stop(), { once: true })
  })
}

export interface JsonStats {
  doc: Animation
  /** Size of the exported file (JSON or ZIP). */
  bytes: number
  /** Compressed size of the JSON text. */
  gzip: number
  /** Minified size of the document as it is, for comparisons. */
  baseline: number
}

export interface TgsStats {
  doc: Animation
  bytes: number
  report: TgsReport
}

export interface PreviewSpec {
  doc: Animation | null
  width: number
  height: number
  background: string | null
  mode: PreviewMode
}

export interface ExportModel {
  format: ExportFormat
  ext: string
  /** Output file name, extension included. */
  fileName: string
  raster: RasterPlan | null
  /** Estimated size of a rendered export, measured on samples (for the format it was made for). */
  estimate: AsyncState<{ format: ExportFormat; bytes: number }>
  frame: FramePlan | null
  json: AsyncState<JsonStats>
  dotlottie: AsyncState<number>
  dotlottieVersion: 1 | 2
  packageInfo: PackageInfo | null
  tgs: AsyncState<TgsStats>
  svgFrame: AsyncState<{ markup: string }>
  /** Snippet for display (inline JSON is collapsed; the full code is built on copy). */
  embed: EmbedSnippet | null
  /** Size of the file the snippet loads (.json or .lottie), or of the JSON an inline snippet carries. */
  embedBytes: AsyncState<number>
  support: Record<'mp4' | 'webm', AsyncState<VideoSupport>>
  /** Formats this browser cannot export (shown as unavailable in the list). */
  unavailable: Set<ExportFormat>
  preview: PreviewSpec | null
  /** False while the format cannot be exported (unsupported video). */
  canExport: boolean
}

interface ModelInput {
  /** An export is running: background measurements pause. */
  busy: boolean
  format: ExportFormat
  doc: Animation
  meta: Pick<DocumentMeta, 'fileName' | 'dotLottie'>
  prefs: ExportPrefs
  workArea: WorkArea | null
  frame: number
  fileName: string
  input: ExportInput
}

const NO_WEBCODECS: VideoSupport = { codec: null, reason: 'no-webcodecs' }

/**
 * Name used when measuring file sizes: the typed name only changes a few bytes of ZIP headers,
 * so sizes are not re-measured on every keystroke.
 */
const MEASURE_NAME = 'animation.json'

/** Measures samples of a rendered export and extrapolates its size. */
function estimateSize(
  format: ExportFormat,
  doc: Animation,
  raster: RasterPlan,
  prefs: ExportPrefs,
  input: ExportInput,
  codec: VideoCodec | null,
  signal: AbortSignal,
): Promise<number> {
  const render = {
    width: raster.size.width,
    height: raster.size.height,
    background: raster.background,
    renderer: input.renderer,
    runExpressions: input.runExpressions,
    signal,
  }
  const times = planTimes(raster)
  if (format === 'gif') {
    const g = prefs.gif
    return estimateGif(
      doc,
      render,
      gifCoreOptions(g),
      times,
      gifDelays(times.length, raster.fps),
      g.palette === 'global',
    )
  }
  if (format === 'png') return estimatePngSequence(doc, render, times)
  const container = format === 'mp4' ? 'mp4' : 'webm'
  if (!codec) return Promise.reject(new Error('No video encoder'))
  const video = {
    container,
    codec,
    fps: raster.fps,
    quality: prefs[container].quality,
    transparent: container === 'webm' && prefs.webm.transparent,
  } as const
  return estimateVideo(doc, render, video, times)
}

export function useExportModel({
  busy,
  format,
  doc,
  meta,
  prefs,
  workArea,
  frame,
  fileName,
  input,
}: ModelInput): ExportModel {
  const ext = formatExtension(format, prefs, doc)
  // Estimates keep a renderer between runs; free it with the dialog.
  useEffect(() => releaseEstimateRenderer, [])

  const raster = useMemo(
    () => (isRasterFormat(format) ? planRaster(format, doc, prefs, workArea) : null),
    [format, doc, prefs, workArea],
  )
  const framePlan = useMemo(
    () => (isFrameFormat(format) ? planFrame(format, doc, prefs[format]) : null),
    [format, doc, prefs],
  )

  /* ------------------------------ Lottie JSON ----------------------------- */
  const jsonOpts = prefs.json
  const json = useAsync<JsonStats>(
    format === 'json'
      ? async (signal) => {
          await yieldToEventLoop()
          const out = transformDocument(doc, jsonOpts)
          const file = buildJsonFile(doc, jsonOpts, MEASURE_NAME)
          const text = utf8(serializeJson(out, jsonOpts.pretty))
          const [gz, baseline] = [
            await gzipSizeAsync(text, signal),
            utf8(serializeJson(doc, false)).length,
          ]
          return { doc: out, bytes: file.bytes.length, gzip: gz, baseline }
        }
      : null,
    [format, doc, jsonOpts],
    120,
  )

  /* ------------------------------- dotLottie ------------------------------ */
  const pkg = useMemo(() => packageInfo(meta.dotLottie), [meta.dotLottie])
  const dotlottieVersion = resolveDotLottieVersion(prefs.dotlottie, pkg)
  const dotlottie = useAsync<number>(
    format === 'dotlottie'
      ? async () => {
          await yieldToEventLoop()
          return buildDotLottie(doc, prefs.dotlottie, MEASURE_NAME, meta.dotLottie).bytes.length
        }
      : null,
    [format, doc, prefs.dotlottie, meta.dotLottie],
    150,
  )

  /* -------------------------------- Telegram ------------------------------ */
  const tgs = useAsync<TgsStats>(
    format === 'tgs'
      ? async () => {
          await yieldToEventLoop()
          const out = tgsDocument(doc, prefs)
          const bytes = encodeTgs(out).length
          return { doc: out, bytes, report: checkTelegram(out, bytes) }
        }
      : null,
    [format, doc, prefs.tgs],
    100,
  )

  /* ------------------------------- SVG frame ------------------------------ */
  const svgFrame = useAsync<{ markup: string }>(
    format === 'frameSvg' ? async () => ({ markup: (await renderFrameSvg(input)).markup }) : null,
    [format, doc, prefs.frameSvg, frame, input.runExpressions],
    200,
  )

  /* --------------------------------- Video -------------------------------- */
  const mp4Plan = useMemo(() => planRaster('mp4', doc, prefs, workArea), [doc, prefs, workArea])
  const webmPlan = useMemo(() => planRaster('webm', doc, prefs, workArea), [doc, prefs, workArea])
  const mp4 = useAsync<VideoSupport>(
    () =>
      hasWebCodecs()
        ? detectVideoSupport('mp4', {
            width: mp4Plan.size.width,
            height: mp4Plan.size.height,
            fps: mp4Plan.fps,
          })
        : Promise.resolve(NO_WEBCODECS),
    [mp4Plan.size.width, mp4Plan.size.height, mp4Plan.fps],
    0,
  )
  const webm = useAsync<VideoSupport>(
    () =>
      hasWebCodecs()
        ? detectVideoSupport('webm', {
            width: webmPlan.size.width,
            height: webmPlan.size.height,
            fps: webmPlan.fps,
          })
        : Promise.resolve(NO_WEBCODECS),
    [webmPlan.size.width, webmPlan.size.height, webmPlan.fps],
    0,
  )

  /* ------------------------------- Estimates ------------------------------ */
  const videoCodec =
    format === 'mp4' ? mp4.value?.codec : format === 'webm' ? webm.value?.codec : null
  const estimate = useAsync<{ format: ExportFormat; bytes: number }>(
    raster && !busy && (format === 'gif' || format === 'png' || videoCodec)
      ? async (signal) => ({
          format,
          bytes: await estimateSize(format, doc, raster, prefs, input, videoCodec ?? null, signal),
        })
      : null,
    [
      busy,
      format,
      doc,
      raster,
      prefs.gif,
      prefs.mp4.quality,
      prefs.webm,
      input.renderer,
      input.runExpressions,
      videoCodec,
    ],
    500,
  )

  const unavailable = useMemo(() => {
    const set = new Set<ExportFormat>()
    // Only a missing WebCodecs API marks the format itself as unavailable; a size the encoder
    // rejects is explained inside the format's options.
    if (mp4.value?.reason === 'no-webcodecs') set.add('mp4')
    if (webm.value?.reason === 'no-webcodecs') set.add('webm')
    return set
  }, [mp4.value, webm.value])

  /* --------------------------------- Embed -------------------------------- */
  const embedOpts = prefs.embed
  const embed = useMemo(
    () => (format === 'embed' ? buildEmbedSnippet(doc, embedOpts, fileName, '') : null),
    [format, doc, embedOpts, fileName],
  )
  const embedWc = embedOpts.flavor === 'wc'
  const embedBytes = useAsync<number>(
    format === 'embed'
      ? async () => {
          await yieldToEventLoop()
          if (!embedWc) return utf8(serializeJson(doc, false)).length
          return buildDotLottie(doc, dotLottieForEmbed(prefs), MEASURE_NAME, meta.dotLottie).bytes
            .length
        }
      : null,
    [format, doc, embedWc, embedWc && prefs.dotlottie, embedWc && embedOpts, meta.dotLottie],
    100,
  )

  /* -------------------------------- Preview ------------------------------- */
  const preview = useMemo<PreviewSpec | null>(() => {
    const play = (d: Animation, fps = d.fr): PreviewMode => ({
      kind: 'play',
      range: { start: d.ip, end: d.op },
      compFps: d.fr,
      fps,
    })
    switch (format) {
      case 'json': {
        const shown = json.value?.doc ?? doc
        return { doc: shown, width: doc.w, height: doc.h, background: null, mode: play(doc) }
      }
      case 'dotlottie':
        return { doc, width: doc.w, height: doc.h, background: null, mode: play(doc) }
      case 'tgs': {
        const shown = tgs.value?.doc ?? null
        return {
          doc: shown,
          width: shown?.w ?? 512,
          height: shown?.h ?? 512,
          background: null,
          mode: shown ? play(shown) : play(doc),
        }
      }
      case 'gif':
      case 'mp4':
      case 'webm':
      case 'png': {
        const plan = raster!
        return {
          doc,
          width: plan.size.width,
          height: plan.size.height,
          background: plan.background,
          mode: { kind: 'play', range: plan.range, compFps: plan.compFps, fps: plan.fps },
        }
      }
      case 'framePng':
      case 'frameSvg': {
        const plan = framePlan!
        return {
          doc,
          width: plan.size.width,
          height: plan.size.height,
          background: plan.background,
          mode: { kind: 'still', frame },
        }
      }
      case 'embed':
        return null
    }
  }, [format, doc, json.value, tgs.value, raster, framePlan, frame])

  const videoSupport = format === 'mp4' ? mp4 : format === 'webm' ? webm : null
  const canExport = !videoSupport || (!!videoSupport.value?.codec && !videoSupport.pending)

  return {
    format,
    ext,
    fileName,
    raster,
    estimate,
    frame: framePlan,
    json,
    dotlottie,
    dotlottieVersion,
    packageInfo: pkg,
    tgs,
    svgFrame,
    embed,
    embedBytes,
    support: { mp4, webm },
    unavailable,
    preview,
    canExport,
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Summary                                  */
/* -------------------------------------------------------------------------- */

/** Short facts for the dialog footer ("Frames 0–59 · 2 s · 512 × 512 · 12 KB"). */
export function summaryParts(
  model: ExportModel,
  t: Dict,
  fmt: Formatter,
  doc: Animation,
  prefs: ExportPrefs,
  frame: number,
): string[] {
  const s = t.export.summary
  const seconds = (value: number) => fmt.decimal(value)
  const measured = (value: number | undefined) =>
    value === undefined ? s.measuring : fmt.size(value)
  switch (model.format) {
    case 'json': {
      const v = model.json.value
      return [
        prefs.json.pretty ? t.export.json.pretty : t.export.json.minified,
        measured(v?.bytes),
        ...(v ? [s.gzip(fmt.size(v.gzip))] : []),
      ]
    }
    case 'dotlottie':
      return [
        t.export.dotlottie[model.dotlottieVersion === 2 ? 'v2' : 'v1'],
        measured(model.dotlottie.value),
      ]
    case 'tgs': {
      const v = model.tgs.value
      const d = v?.doc ?? doc
      return [
        s.size(d.w, d.h),
        t.export.fps(fmt.decimal(d.fr)),
        s.seconds(seconds((d.op - d.ip) / d.fr)),
        v ? s.of(fmt.size(v.bytes), fmt.size(TGS_RULES.maxBytes, 0)) : s.measuring,
      ]
    }
    case 'gif':
    case 'mp4':
    case 'webm':
    case 'png': {
      const plan = model.raster!
      const parts = [s.frames(Math.round(plan.range.start), lastFrameOf(plan.range))]
      parts.push(
        plan.passes > 1
          ? s.repeated(plan.passes, seconds(plan.seconds))
          : s.seconds(seconds(plan.seconds)),
      )
      parts.push(s.countAt(plan.totalFrames, fmt.decimal(plan.fps)))
      parts.push(s.size(plan.size.width, plan.size.height))
      if (model.format === 'mp4' || model.format === 'webm') {
        const codec = model.support[model.format].value?.codec
        if (codec) parts.push(CODEC_NAMES[codec] ?? codec)
      }
      // A previous estimate belongs to other options: say it is being measured instead.
      const estimate = model.estimate.value
      if (model.estimate.pending) parts.push(s.measuring)
      else if (estimate && estimate.format === model.format)
        parts.push(s.estimate(fmt.size(estimate.bytes)))
      return parts
    }
    case 'framePng':
    case 'frameSvg': {
      const plan = model.frame!
      const parts = [
        s.frames(Math.round(frame), Math.round(frame)),
        s.size(plan.size.width, plan.size.height),
      ]
      if (model.format === 'frameSvg' && model.svgFrame.value)
        parts.push(fmt.size(utf8(model.svgFrame.value.markup).length))
      return parts
    }
    case 'embed': {
      const flavor = prefs.embed.flavor
      const bytes = model.embedBytes.value
      return [
        t.export.embed[flavor],
        isInline(prefs.embed) ? t.export.embed.inlineSummary : model.fileName,
        bytes === undefined ? s.measuring : fmt.size(bytes),
      ]
    }
  }
}
