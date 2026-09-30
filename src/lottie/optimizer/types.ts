/**
 * Public types of the optimizer engine.
 *
 * The engine runs a fixed, ordered pipeline of techniques over a JSON clone of the document.
 * Every technique is a pure function of the working copy that reports how many things it
 * changed; the pipeline measures the size after each step so that the contributions of the
 * steps add up exactly to the total saving (raw and gzip).
 */
import type { Animation } from '../types'

/* -------------------------------------------------------------------------- */
/*                                 Techniques                                 */
/* -------------------------------------------------------------------------- */

/** Technique ids, in pipeline order (see `TECHNIQUES`). */
export type TechniqueId =
  | 'minify'
  | 'legacy'
  | 'hidden'
  | 'invisible'
  | 'empty'
  | 'unusedAssets'
  | 'dedupeAssets'
  | 'staticize'
  | 'keyframes'
  | 'paths'
  | 'precision'
  | 'defaults'
  | 'names'
  | 'images'

/**
 * - `lossless`: the rendering cannot change (structure, redundancy, defaults).
 * - `visual`: values change within a tolerance chosen to be invisible (sub-pixel geometry,
 *   imperceptible color/opacity steps), verified by sampling.
 * - `lossy`: may change what runtime code or viewers can observe (names used as keypaths,
 *   re-encoded image pixels).
 */
export type TechniqueCategory = 'lossless' | 'visual' | 'lossy'

export interface TechniqueInfo {
  id: TechniqueId
  category: TechniqueCategory
  /** Needs a browser environment (OffscreenCanvas / createImageBitmap). */
  browserOnly?: boolean
}

export type PresetId = 'safe' | 'balanced' | 'maximum'

/** Output format of re-encoded images. `auto` picks the smallest acceptable encoding. */
export type ImageFormat = 'auto' | 'webp' | 'jpeg' | 'png'

/**
 * Which names the `names` technique strips:
 * - `shapes`: shape items and their properties (layer, mask and effect names are kept)
 * - `exceptLayers`: everything except layer and composition names
 * - `all`: every name, including layers (breaks keypaths and expressions by name)
 */
export type NameScope = 'shapes' | 'exceptLayers' | 'all'

export interface ImageOptions {
  format: ImageFormat
  /** Encoder quality for lossy formats (0..1). */
  quality: number
  /**
   * Largest bitmap kept, as a multiple of the biggest size the image is ever displayed at in
   * composition pixels (2 keeps full detail on 2× screens). 0 disables downscaling.
   */
  maxScale: number
}

export interface NameOptions {
  scope: NameScope
  /** Also strip `cl` / `ln` (CSS classes and ids that web pages may style or script). */
  classes: boolean
}

export interface OptimizeOptions {
  /** Enabled techniques (`minify` always runs: the output is serialized minified). */
  techniques: Record<TechniqueId, boolean>
  /**
   * Largest geometric error, in composition pixels (0 = only exact changes). Every number gets
   * a budget derived from it: coordinates, sizes, path vertices and tangents divided by the
   * magnification of the transforms above them (layer, parents, precompositions, groups,
   * repeaters); rotations and scales through the composition's extent; colors and opacity by
   * perceptual steps. Geometry gets 70 % of it and each transform value 10 %, so the combined
   * world-space error stays within it (measured ≤ 0.045 px at 0.05 on real files). Used by
   * `keyframes`, `paths` and `precision`, which share each property's budget.
   */
  pxTolerance: number
  /**
   * Share of a property's budget keyframe simplification may spend, as a multiple of its
   * default half (1 = half the budget, 2 = all of it); precision rounds with what is left.
   */
  keyframeTolerance: number
  /** Simplify path geometry within tolerance (false: exact redundancy only). */
  pathSimplify: boolean
  image: ImageOptions
  names: NameOptions
}

/** Options accepted by the API: a preset id, or a partial override of a preset (default balanced). */
export type OptimizeOptionsInput =
  | PresetId
  | (Partial<Omit<OptimizeOptions, 'techniques' | 'image' | 'names'>> & {
      preset?: PresetId
      techniques?: Partial<Record<TechniqueId, boolean>>
      image?: Partial<ImageOptions>
      names?: Partial<NameOptions>
    })

/* -------------------------------------------------------------------------- */
/*                                   Reports                                  */
/* -------------------------------------------------------------------------- */

export interface ContentCounts {
  compositions: number
  layers: number
  shapes: number
  /** Animatable properties (static and animated). */
  properties: number
  animatedProperties: number
  keyframes: number
  /** Numbers in the JSON (a proxy of its density). */
  numbers: number
  images: number
  /** Decoded bytes of the embedded images. */
  imageBytes: number
  expressions: number
}

export interface SizeReport {
  /** Minified JSON (or the source text when it was given), UTF-8 bytes. */
  raw: number
  /** Gzip level 9 of the same bytes: what a web server sends. */
  gzip: number
  /** dotLottie container (zip, deflate level 9, images stored as files). */
  dotLottie: number
  counts: ContentCounts
}

/** Machine-readable warning; the UI translates `code`. */
export type OptimizeWarningCode =
  /** Expressions are present: structural and keyframe techniques were limited to stay safe. */
  | 'expressions'
  /** Names were stripped: runtime keypaths / value providers that use them stop matching. */
  | 'namesStripped'
  /** CSS classes / ids (cl, ln) were stripped. */
  | 'classesStripped'
  /** Hidden groups or modifiers were removed (lottie-web ignored their hidden flag). */
  | 'hiddenGroups'
  /** Images were converted to WebP (needs iOS 14+ / Safari 14+ / Android 4.3+). */
  | 'webp'
  /** Images were downscaled to the largest size they are displayed at. */
  | 'imagesDownscaled'
  /** The image technique is not available here (no OffscreenCanvas / createImageBitmap). */
  | 'imagesUnavailable'
  /** Some images could not be decoded and were kept as they were. */
  | 'imageDecodeFailed'
  /** Old Bodymovin format (before 4.4.18): its legacy rules were kept (0–255 colors, `closed`). */
  | 'legacyFormat'
  /** Properties bound to slots (themes) were left untouched. */
  | 'slots'
  /** 3D layers were found: geometry precision uses a conservative scale. */
  | 'threeD'
  /** Precompositions reference themselves; affected parts were skipped. */
  | 'precompCycle'
  /** One-keyframe properties became static (lottie-web could not play them). */
  | 'singleKeyframes'

export interface OptimizeWarning {
  code: OptimizeWarningCode
  /** How many places are concerned (when meaningful). */
  count?: number
  /** Technical detail in English (logs, tooltips). */
  detail?: string
}

export interface StepReport {
  id: TechniqueId
  category: TechniqueCategory
  /** Bytes saved by this step (minified JSON); steps add up to the total. */
  savedRaw: number
  /** Gzip bytes saved by this step (0 when gzip was not measured). */
  savedGzip: number
  /** Total number of changes (sum of `details`). */
  changes: number
  /** What changed, by kind (layers, shapes, keyframes, numbers, fields, …). */
  details: Record<string, number>
  warnings: OptimizeWarning[]
  /** Duration of the step in milliseconds. */
  ms: number
}

export type ImageAction = 'reencoded' | 'downscaled' | 'kept' | 'skipped'

export interface ImageReport {
  /** Asset id. */
  id: string
  action: ImageAction
  /** Why the image was kept or skipped (e.g. 'svg', 'external', 'larger', 'decode'). */
  reason?: string
  before: { mime: string; bytes: number; width?: number; height?: number }
  after: { mime: string; bytes: number; width?: number; height?: number }
}

/** Where the file will be used; drives the format recommendation. */
export type DeliveryGoal = 'web' | 'mobile' | 'telegram'

export interface FormatRecommendation {
  goal: DeliveryGoal
  format: 'json' | 'lottie' | 'tgs'
  /** Size of the recommended delivery (gzip for JSON served over HTTP, file size otherwise). */
  bytes: number
  /** Machine-readable reason code for the UI. */
  reason:
    | 'gzipSmallest'
    | 'dotLottieSmallest'
    | 'imagesPackaged'
    | 'mobileRuntime'
    | 'telegram'
    | 'telegramIncompatible'
}

export interface OptimizeReport {
  before: SizeReport
  after: SizeReport
  /** Every step of the pipeline, in order (disabled techniques are omitted). */
  steps: StepReport[]
  /** Document-level warnings (also repeated on the step that caused them). */
  warnings: OptimizeWarning[]
  images: ImageReport[]
  /** The options that were used (after resolving presets). */
  options: OptimizeOptions
  durationMs: number
}

export interface OptimizeResult {
  animation: Animation
  /** Minified JSON of `animation` (what `after.raw` measures). */
  json: string
  report: OptimizeReport
}

/** Progress callback: `step` is the running technique or phase. */
export type ProgressFn = (step: TechniqueId | 'measure', done: number, total: number) => void

export interface OptimizeHooks {
  onProgress?: ProgressFn
  signal?: AbortSignal
  /**
   * Original file text, when known: `before.raw` / `before.gzip` then measure the bytes as they
   * were delivered (whitespace included), so `minify` shows what it saved.
   */
  source?: string
  /** Measure gzip after every step (default true; false is faster for previews). */
  measureGzip?: boolean
}

/* -------------------------------------------------------------------------- */
/*                                  Analysis                                  */
/* -------------------------------------------------------------------------- */

export interface TechniqueEstimate {
  changes: number
  details: Record<string, number>
  /** Raw bytes the technique would save (in pipeline order). */
  savedRaw: number
}

export interface Analysis {
  size: SizeReport
  /** Estimates for the techniques that would change something. */
  techniques: Partial<Record<TechniqueId, TechniqueEstimate>>
  /** Raw size after all non-image techniques of the analysed options. */
  estimatedRaw: number
  /** Embedded raster images that the image technique could re-encode. */
  images: number
  imageBytes: number
  expressions: number
  /** Bodymovin version of the file (`v`), if any. */
  version?: string
  warnings: OptimizeWarning[]
}

/* -------------------------------------------------------------------------- */
/*                                Verification                                */
/* -------------------------------------------------------------------------- */

export interface SemanticMismatch {
  /** Root composition frame. */
  frame: number
  /** What differs: 'structure', 'geometry', 'opacity', 'color', 'paint', 'text', 'image', 'context'. */
  kind: string
  /** Human-readable location / detail (English). */
  detail: string
  error?: number
}

export interface SemanticReport {
  /** True when every sampled frame renders the same scene within the tolerances. */
  equivalent: boolean
  /** Frames that were compared. */
  frames: number
  /** Largest geometry deviation (composition pixels). */
  maxGeometry: number
  /** Largest opacity deviation (0..1). */
  maxOpacity: number
  /** Largest color channel deviation (0..1). */
  maxColor: number
  /** Largest deviation of other paint parameters (stroke width, trim %, …) in their units. */
  maxOther: number
  mismatches: SemanticMismatch[]
}

export interface SemanticTolerance {
  /** Geometry, composition pixels. */
  geometry: number
  /** Opacity, 0..1. */
  opacity: number
  /** Color channels, 0..1. */
  color: number
  /** Other numbers (stroke width px, trim %, degrees), in their own units. */
  other: number
}

export interface VisualReport {
  /** Largest per-pixel channel difference over all sampled frames (0..255). */
  maxDiff: number
  /** Mean per-pixel channel difference over all frames (0..255). */
  meanDiff: number
  /** Per sampled frame: share of pixels (0..1) whose local difference exceeds the threshold. */
  perFrame: number[]
  /** The sampled frames (root composition frames). */
  frames: number[]
  /** Root composition frame with the largest difference. */
  worstFrame: number
  /** Share of differing pixels on the worst frame (0..1). */
  worstShare: number
  /** No frame has more differing pixels than the allowed share. */
  match: boolean
  /**
   * Difference heatmap of the worst frame (local 3×3 differences): transparent where the
   * difference is invisible (2 levels or less), amber below the threshold, red above it.
   */
  heatmap?: ImageData
}

export interface VerifyVisualOptions {
  /** Number of frames sampled over the animation (default 24). */
  frames?: number
  /** Longest side of the rendering in pixels (default 256). */
  size?: number
  signal?: AbortSignal
  /**
   * Difference (0..255, averaged over the pixel's 3×3 neighbourhood) above which a pixel counts
   * as different (default 24).
   */
  threshold?: number
  /** Share of differing pixels allowed per frame (default 0.001 = 0.1 %). */
  allowedShare?: number
  /** Produce the heatmap of the worst frame (default true). */
  heatmap?: boolean
}
