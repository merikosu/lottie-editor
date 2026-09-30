/**
 * Export preferences (persisted per browser: the last format and the options of every format)
 * and the state of the running export (transient).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EmbedOptions } from '@/export/embed'
import type { DotLottieOptions, JsonOptions, TgsOptions } from '@/export/lottie-files'
import type { RangeMode, SizePreset } from '@/export/plan'
import type { ProgressInfo } from '@/export/progress'
import type { VideoQuality } from '@/export/video'

export type ExportFormat =
  'json' | 'dotlottie' | 'tgs' | 'gif' | 'mp4' | 'webm' | 'png' | 'framePng' | 'frameSvg' | 'embed'

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  'json',
  'dotlottie',
  'tgs',
  'gif',
  'mp4',
  'webm',
  'png',
  'framePng',
  'frameSvg',
  'embed',
]

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value)
}

export type BackgroundMode = 'color' | 'transparent'
/** 'source' = the animation's own frame rate. */
export type FpsChoice = 'source' | '60' | '50' | '30' | '25' | '24' | '20' | '15' | '12' | '10'
/** Raster exports: 'auto' follows the canvas view's renderer setting. */
export type RendererChoice = 'auto' | 'svg' | 'canvas'

export interface SizeOptions {
  preset: SizePreset
  /** Custom size (used when preset is 'custom'). */
  width: number
  height: number
  keepAspect: boolean
}

export interface GifPrefs {
  size: SizeOptions
  fps: FpsChoice
  range: RangeMode
  background: BackgroundMode
  color: string
  matte: string
  /** Alpha below this percentage becomes transparent. */
  threshold: number
  colors: '256' | '128' | '64' | '32'
  dither: boolean
  palette: 'global' | 'perFrame'
  loop: 'forever' | 'once' | 'count'
  /** Total plays when loop is 'count'. */
  plays: number
}

export interface VideoPrefs {
  size: SizeOptions
  fps: FpsChoice
  range: RangeMode
  quality: VideoQuality
  color: string
  /** WebM only. */
  transparent: boolean
  /** Plays of the animation in a row. */
  repeat: number
}

export interface PngSequencePrefs {
  size: SizeOptions
  fps: FpsChoice
  range: RangeMode
  background: BackgroundMode
  color: string
}

export interface FramePrefs {
  size: SizeOptions
  background: BackgroundMode
  color: string
}

export interface ExportPrefs {
  format: ExportFormat
  renderer: RendererChoice
  json: JsonOptions
  dotlottie: DotLottieOptions
  tgs: TgsOptions
  gif: GifPrefs
  mp4: VideoPrefs
  webm: VideoPrefs
  png: PngSequencePrefs
  framePng: FramePrefs
  frameSvg: FramePrefs
  embed: EmbedOptions
}

const size = (preset: SizePreset): SizeOptions => ({
  preset,
  width: 1080,
  height: 1080,
  keepAspect: true,
})

export const DEFAULT_PREFS: ExportPrefs = {
  format: 'gif',
  renderer: 'auto',
  json: { pretty: false, precision: 'keep', stripNames: false, images: 'embed' },
  dotlottie: {
    version: 'auto',
    extractImages: true,
    includePackage: true,
    themes: true,
    loop: true,
    autoplay: true,
    speed: 1,
    bounce: false,
  },
  tgs: { fitSize: true, fixFps: true, duration: 'keep', precision: 'keep', stripNames: false },
  gif: {
    size: size('1x'),
    fps: 'source',
    range: 'all',
    background: 'color',
    color: '#ffffff',
    matte: '#ffffff',
    threshold: 50,
    colors: '256',
    dither: false,
    palette: 'global',
    loop: 'forever',
    plays: 3,
  },
  mp4: {
    size: size('1080p'),
    fps: 'source',
    range: 'all',
    quality: 'high',
    color: '#ffffff',
    transparent: false,
    repeat: 1,
  },
  webm: {
    size: size('1080p'),
    fps: 'source',
    range: 'all',
    quality: 'high',
    color: '#ffffff',
    transparent: true,
    repeat: 1,
  },
  png: {
    size: size('1x'),
    fps: 'source',
    range: 'all',
    background: 'transparent',
    color: '#ffffff',
  },
  framePng: { size: size('2x'), background: 'transparent', color: '#ffffff' },
  frameSvg: { size: size('1x'), background: 'transparent', color: '#ffffff' },
  embed: { flavor: 'html', loop: true, autoplay: true, renderer: 'svg', inline: false },
}

type FormatKey = Exclude<keyof ExportPrefs, 'format' | 'renderer'>

/** Persisted state merged over the defaults per format, so new options get their defaults. */
function mergePrefs(persisted: unknown, current: ExportPrefs): ExportPrefs {
  if (!persisted || typeof persisted !== 'object') return current
  const saved = persisted as Partial<Record<keyof ExportPrefs, unknown>>
  const out: ExportPrefs = { ...current }
  if (isExportFormat(saved.format)) out.format = saved.format
  if (saved.renderer === 'auto' || saved.renderer === 'svg' || saved.renderer === 'canvas')
    out.renderer = saved.renderer
  const keys = Object.keys(DEFAULT_PREFS).filter(
    (k) => k !== 'format' && k !== 'renderer',
  ) as FormatKey[]
  for (const key of keys) {
    const value = saved[key]
    if (value && typeof value === 'object') {
      const merged = { ...current[key], ...(value as object) } as Record<string, unknown>
      const base = current[key] as unknown as Record<string, unknown>
      // Nested size options: merge too.
      if (base.size && typeof merged.size === 'object')
        merged.size = { ...(base.size as object), ...(merged.size as object) }
      ;(out as unknown as Record<string, unknown>)[key] = merged
    }
  }
  return out
}

export const useExportPrefs = create<ExportPrefs>()(
  persist(() => DEFAULT_PREFS, {
    name: 'lottie-editor:export',
    version: 1,
    merge: (persisted, current) => mergePrefs(persisted, current),
  }),
)

export function setExportFormat(format: ExportFormat): void {
  useExportPrefs.setState({ format })
}

/** Updates the options of one format. */
export function updateFormatPrefs<K extends FormatKey>(
  key: K,
  patch: Partial<ExportPrefs[K]>,
): void {
  useExportPrefs.setState((s) => ({ [key]: { ...s[key], ...patch } }) as Partial<ExportPrefs>)
}

export function setRendererChoice(renderer: RendererChoice): void {
  useExportPrefs.setState({ renderer })
}

/* -------------------------------------------------------------------------- */
/*                                 Running job                                */
/* -------------------------------------------------------------------------- */

export interface ExportJobState {
  status: 'idle' | 'running'
  format: ExportFormat | null
  progress: ProgressInfo | null
  /** Translated message of the last failure (shown inline in the dialog). */
  error: string | null
  /** The options the failure happened with: after any change the message no longer applies. */
  errorFor: ExportPrefs | null
  controller: AbortController | null
}

export const useExportJob = create<ExportJobState>()(() => ({
  status: 'idle',
  format: null,
  progress: null,
  error: null,
  errorFor: null,
  controller: null,
}))

export function isExporting(): boolean {
  return useExportJob.getState().status === 'running'
}

export function cancelExport(): void {
  const { controller } = useExportJob.getState()
  controller?.abort(new DOMException('The export was cancelled', 'AbortError'))
}

export function clearExportError(): void {
  if (useExportJob.getState().error) useExportJob.setState({ error: null, errorFor: null })
}
