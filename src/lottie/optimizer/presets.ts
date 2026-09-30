/**
 * Technique catalogue (pipeline order) and the three presets.
 *
 *  - safe: only changes that cannot alter the rendering (structure, redundancy, defaults,
 *    exact keyframe and path redundancy).
 *  - balanced (default): + sub-pixel precision, keyframe simplification within the same
 *    budget, invisible content, near-lossless image re-encoding.
 *  - maximum: larger (still sub-pixel) tolerances, WebP 80 %, names stripped except layers.
 */
import type {
  OptimizeOptions,
  OptimizeOptionsInput,
  PresetId,
  TechniqueCategory,
  TechniqueId,
  TechniqueInfo,
} from './types'

export const TECHNIQUES: readonly TechniqueInfo[] = [
  { id: 'minify', category: 'lossless' },
  { id: 'legacy', category: 'lossless' },
  { id: 'hidden', category: 'lossless' },
  { id: 'invisible', category: 'lossless' },
  { id: 'empty', category: 'lossless' },
  { id: 'unusedAssets', category: 'lossless' },
  { id: 'dedupeAssets', category: 'lossless' },
  { id: 'staticize', category: 'lossless' },
  { id: 'keyframes', category: 'visual' },
  { id: 'paths', category: 'visual' },
  { id: 'precision', category: 'visual' },
  { id: 'defaults', category: 'lossless' },
  { id: 'names', category: 'lossy' },
  { id: 'images', category: 'lossy', browserOnly: true },
]

export const TECHNIQUE_IDS: readonly TechniqueId[] = TECHNIQUES.map((t) => t.id)

const CATEGORY = new Map<TechniqueId, TechniqueCategory>(TECHNIQUES.map((t) => [t.id, t.category]))

export function techniqueCategory(id: TechniqueId): TechniqueCategory {
  return CATEGORY.get(id) ?? 'lossless'
}

const on = (ids: TechniqueId[]): Record<TechniqueId, boolean> => {
  const out = {} as Record<TechniqueId, boolean>
  for (const id of TECHNIQUE_IDS) out[id] = ids.includes(id)
  return out
}

const LOSSLESS: TechniqueId[] = [
  'minify',
  'legacy',
  'hidden',
  'empty',
  'unusedAssets',
  'dedupeAssets',
  'staticize',
  'defaults',
  // Exact redundancy only in the safe preset: pxTolerance 0 turns both into lossless steps.
  'keyframes',
  'paths',
]

export const PRESETS: Readonly<Record<PresetId, OptimizeOptions>> = {
  safe: {
    techniques: on(LOSSLESS),
    pxTolerance: 0,
    keyframeTolerance: 0,
    pathSimplify: false,
    image: { format: 'auto', quality: 1, maxScale: 0 },
    names: { scope: 'shapes', classes: false },
  },
  balanced: {
    techniques: on([...LOSSLESS, 'invisible', 'precision', 'images']),
    pxTolerance: 0.05,
    keyframeTolerance: 1,
    pathSimplify: true,
    image: { format: 'auto', quality: 0.9, maxScale: 2 },
    names: { scope: 'shapes', classes: false },
  },
  maximum: {
    techniques: on([...LOSSLESS, 'invisible', 'precision', 'images', 'names']),
    pxTolerance: 0.2,
    keyframeTolerance: 1,
    pathSimplify: true,
    image: { format: 'webp', quality: 0.8, maxScale: 1.5 },
    names: { scope: 'exceptLayers', classes: false },
  },
}

export const DEFAULT_PRESET: PresetId = 'balanced'

export const PRESET_IDS: readonly PresetId[] = ['safe', 'balanced', 'maximum']

function clone(o: OptimizeOptions): OptimizeOptions {
  return {
    ...o,
    techniques: { ...o.techniques },
    image: { ...o.image },
    names: { ...o.names },
  }
}

const finite = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/**
 * Full options from a preset id or a partial override (based on `preset`, default balanced).
 * Out-of-range numbers are clamped; `minify` is always on.
 */
export function resolveOptions(input?: OptimizeOptionsInput): OptimizeOptions {
  if (input === undefined) return clone(PRESETS[DEFAULT_PRESET])
  if (typeof input === 'string') return clone(PRESETS[input] ?? PRESETS[DEFAULT_PRESET])
  const base = clone(PRESETS[input.preset ?? DEFAULT_PRESET] ?? PRESETS[DEFAULT_PRESET])
  const out: OptimizeOptions = {
    techniques: { ...base.techniques, ...input.techniques, minify: true },
    pxTolerance: finite(input.pxTolerance, base.pxTolerance, 0, 10),
    keyframeTolerance: finite(input.keyframeTolerance, base.keyframeTolerance, 0, 20),
    pathSimplify: input.pathSimplify ?? base.pathSimplify,
    image: {
      format: input.image?.format ?? base.image.format,
      quality: finite(input.image?.quality, base.image.quality, 0.05, 1),
      maxScale: finite(input.image?.maxScale, base.image.maxScale, 0, 16),
    },
    names: { ...base.names, ...input.names },
  }
  return out
}

const sameOptions = (a: OptimizeOptions, b: OptimizeOptions) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Which preset (if any) the options are identical to. */
export function matchPreset(options: OptimizeOptions): PresetId | null {
  for (const id of PRESET_IDS) if (sameOptions(options, PRESETS[id])) return id
  return null
}
