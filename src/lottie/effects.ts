/**
 * Layer effects (`layer.ef`).
 *
 * A catalog of the After Effects effects Lottie players understand, with every control exactly
 * as After Effects + Bodymovin export it. The structures were checked against real exports
 * (control order, `ty`, match name `mn`, English name `nm`, `np`, key order) and against the
 * players that read them:
 *  - lottie-web, ThorVG and Skottie read controls by POSITION in `ef`;
 *  - lottie-android and lottie-ios find drop shadow controls by their English NAME;
 *  - lottie-web renders effects whatever their `en` flag; ThorVG skips effects without `en: 1`
 *    and needs `ty` before `ef`/`v` (so objects are built in Bodymovin's key order).
 *
 * The module also has the structural operations used inside `updateDoc` recipes (they keep
 * `ix` = position + 1, which expressions use), selection path remapping, and the player support
 * of each effect (from `compat.ts`) plus the problems a specific effect has in some players.
 */
import {
  SKOTTIE_ONLY_EFFECT_MN,
  TARGETS,
  cellOf,
  worstLevel,
  type FeatureId,
  type Level,
  type PlayerId,
} from './compat'
import type { NodePath } from './path'
import { getKeyframes, isPropertyLike, type AnyProperty } from './property'
import type { Animation, Effect, EffectValue, Layer, Property } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** Effect types (`ef[].ty`) as Bodymovin writes them. */
export const EFFECT_TY = {
  custom: 5,
  tint: 20,
  fill: 21,
  stroke: 22,
  tritone: 23,
  levels: 24,
  dropShadow: 25,
  radialWipe: 26,
  displacementMap: 27,
  setMatte: 28,
  gaussianBlur: 29,
  twirl: 30,
  meshWarp: 31,
  wavy: 32,
  spherize: 33,
  puppet: 34,
  transform: 35,
} as const

/** Control types (`ef[].ef[].ty`). Built-in checkboxes and popups are exported as 7. */
export const CONTROL_TY = {
  slider: 0,
  angle: 1,
  color: 2,
  point: 3,
  checkbox: 4,
  group: 5,
  noValue: 6,
  dropdown: 7,
  layer: 10,
  mask: 11,
} as const

export type ParamUnit = 'px' | '%' | '°'

/** How the editor presents a control's value. */
export type ParamUi =
  | {
      kind: 'number'
      unit?: ParamUnit
      /** Displayed value = stored value × scale (e.g. 0–255 shown as 0–100 %). */
      scale?: number
      min?: number
      max?: number
      precision?: number
    }
  | { kind: 'angle' }
  | { kind: 'color' }
  | { kind: 'point'; dims: 2 | 3 }
  | { kind: 'checkbox' }
  /** Popup menu; the value is the 1-based option number. */
  | { kind: 'menu'; options: readonly number[] }
  /** A layer of the same composition, by `ind` (0 = none). */
  | { kind: 'layer' }
  /** A mask of the layer, 1-based (0 = none). */
  | { kind: 'mask' }

export type ParamValue = number | number[]

/** Values that depend on the layer the effect is added to. */
export interface EffectContext {
  /** Center of the layer's content in layer space (Transform effect pivot). */
  center: [number, number]
  /** Number of masks on the layer (the Stroke effect strokes masks). */
  masks: number
}

export interface EffectParamDef {
  /** Stable id (labels and lookups). */
  readonly id: string
  /** After Effects match name of the control. */
  readonly mn: string
  /** English After Effects name; lottie-android and lottie-ios look some controls up by it. */
  readonly nm: string
  /** Control type as Bodymovin exports it. */
  readonly ty: number
  readonly ui: ParamUi
  readonly value: ParamValue | ((ctx: EffectContext) => ParamValue)
  /** No Lottie player reads it (kept for After Effects round trips). */
  readonly unused?: boolean
  /** Hidden while this checkbox parameter is on (Scale width with Uniform scale). */
  readonly hiddenBy?: string
  /** Disabled while this checkbox parameter is on (the stroked mask with All masks). */
  readonly disabledBy?: string
}

export type EffectKind =
  | 'fill'
  | 'tint'
  | 'tritone'
  | 'dropShadow'
  | 'stroke'
  | 'gaussianBlur'
  | 'transform'
  | 'setMatte'
  | 'sliderControl'
  | 'angleControl'
  | 'colorControl'
  | 'pointControl'
  | 'point3dControl'
  | 'checkboxControl'
  | 'layerControl'

export interface EffectDef {
  readonly kind: EffectKind
  readonly ty: number
  readonly mn: string
  /** English After Effects name. */
  readonly nm: string
  /** After Effects `numProperties` as Bodymovin writes it. */
  readonly np: number
  readonly params: readonly EffectParamDef[]
}

/* -------------------------------------------------------------------------- */
/*                                   Catalog                                  */
/* -------------------------------------------------------------------------- */

const color = { kind: 'color' } as const
const checkbox = { kind: 'checkbox' } as const
const angle = { kind: 'angle' } as const
const percent = (scale = 1, max: number | undefined = 100): ParamUi => ({
  kind: 'number',
  unit: '%',
  scale,
  min: 0,
  max,
  precision: 1,
})
const pixels = (min: number | undefined = 0): ParamUi => ({
  kind: 'number',
  unit: 'px',
  min,
  precision: 1,
})

type ParamExtras = Pick<EffectParamDef, 'unused' | 'hiddenBy' | 'disabledBy'>

function param(
  id: string,
  mn: string,
  nm: string,
  ty: number,
  value: EffectParamDef['value'],
  ui: ParamUi,
  extras: ParamExtras = {},
): EffectParamDef {
  return { id, mn, nm, ty, value, ui, ...extras }
}

const CENTER = (ctx: EffectContext): ParamValue => [...ctx.center]

/**
 * Known effects. The first seven can be added from the editor (lottie-web's SVG renderer draws
 * them); the others are recognized in imported files for friendly parameters.
 */
export const EFFECT_DEFS: Readonly<Record<EffectKind, EffectDef>> = {
  fill: {
    kind: 'fill',
    ty: EFFECT_TY.fill,
    mn: 'ADBE Fill',
    nm: 'Fill',
    np: 9,
    params: [
      // Players fill the whole layer: the mask options and feathering are After Effects only.
      param(
        'fillMask',
        'ADBE Fill-0001',
        'Fill Mask',
        10,
        0,
        { kind: 'mask' },
        { unused: true, disabledBy: 'allMasks' },
      ),
      param('allMasks', 'ADBE Fill-0007', 'All Masks', 7, 0, checkbox, { unused: true }),
      param('color', 'ADBE Fill-0002', 'Color', 2, [1, 0, 0, 1], color),
      param('invert', 'ADBE Fill-0006', 'Invert', 7, 0, checkbox, { unused: true }),
      param('horizontalFeather', 'ADBE Fill-0003', 'Horizontal Feather', 0, 0, pixels(), {
        unused: true,
      }),
      param('verticalFeather', 'ADBE Fill-0004', 'Vertical Feather', 0, 0, pixels(), {
        unused: true,
      }),
      param('opacity', 'ADBE Fill-0005', 'Opacity', 0, 1, percent(100)),
    ],
  },
  tint: {
    kind: 'tint',
    ty: EFFECT_TY.tint,
    mn: 'ADBE Tint',
    nm: 'Tint',
    np: 6,
    params: [
      param('mapBlackTo', 'ADBE Tint-0001', 'Map Black To', 2, [0, 0, 0, 1], color),
      param('mapWhiteTo', 'ADBE Tint-0002', 'Map White To', 2, [1, 1, 1, 1], color),
      param('amount', 'ADBE Tint-0003', 'Amount to Tint', 0, 100, percent()),
    ],
  },
  tritone: {
    kind: 'tritone',
    ty: EFFECT_TY.tritone,
    mn: 'ADBE Tritone',
    nm: 'Tritone',
    np: 6,
    params: [
      param('highlights', 'ADBE Tritone-0001', 'Highlights', 2, [1, 1, 1, 1], color),
      param('midtones', 'ADBE Tritone-0002', 'Midtones', 2, [0.5, 0.39, 0.25, 1], color),
      param('shadows', 'ADBE Tritone-0003', 'Shadows', 2, [0, 0, 0, 1], color),
      param('blend', 'ADBE Tritone-0004', 'Blend With Original', 0, 0, percent()),
    ],
  },
  dropShadow: {
    kind: 'dropShadow',
    ty: EFFECT_TY.dropShadow,
    mn: 'ADBE Drop Shadow',
    nm: 'Drop Shadow',
    np: 8,
    params: [
      param('color', 'ADBE Drop Shadow-0001', 'Shadow Color', 2, [0, 0, 0, 1], color),
      // Stored 0–255 (After Effects shows it as a percentage).
      param('opacity', 'ADBE Drop Shadow-0002', 'Opacity', 0, 127.5, percent(100 / 255)),
      param('direction', 'ADBE Drop Shadow-0003', 'Direction', 0, 135, angle),
      param('distance', 'ADBE Drop Shadow-0004', 'Distance', 0, 10, pixels()),
      param('softness', 'ADBE Drop Shadow-0005', 'Softness', 0, 20, pixels()),
      param('shadowOnly', 'ADBE Drop Shadow-0006', 'Shadow Only', 7, 0, checkbox),
    ],
  },
  stroke: {
    kind: 'stroke',
    ty: EFFECT_TY.stroke,
    mn: 'ADBE Stroke',
    nm: 'Stroke',
    np: 13,
    params: [
      param(
        'path',
        'ADBE Stroke-0001',
        'Path',
        10,
        (ctx) => (ctx.masks > 0 ? 1 : 0),
        { kind: 'mask' },
        { disabledBy: 'allMasks' },
      ),
      // On by default: with no mask selected lottie-web fails, with every mask it can't.
      param('allMasks', 'ADBE Stroke-0010', 'All Masks', 7, 1, checkbox),
      param('sequentially', 'ADBE Stroke-0011', 'Stroke Sequentially', 7, 1, checkbox, {
        unused: true,
      }),
      param('color', 'ADBE Stroke-0002', 'Color', 2, [1, 1, 1, 1], color),
      param('brushSize', 'ADBE Stroke-0003', 'Brush Size', 0, 2, pixels()),
      param('brushHardness', 'ADBE Stroke-0004', 'Brush Hardness', 0, 0.75, percent(100), {
        unused: true,
      }),
      param('opacity', 'ADBE Stroke-0005', 'Opacity', 0, 1, percent(100)),
      param('start', 'ADBE Stroke-0008', 'Start', 0, 0, percent()),
      param('end', 'ADBE Stroke-0009', 'End', 0, 100, percent()),
      param('spacing', 'ADBE Stroke-0006', 'Spacing', 7, 15, percent()),
      param('paintStyle', 'ADBE Stroke-0007', 'Paint Style', 7, 1, {
        kind: 'menu',
        options: [1, 2, 3],
      }),
    ],
  },
  gaussianBlur: {
    kind: 'gaussianBlur',
    ty: EFFECT_TY.gaussianBlur,
    mn: 'ADBE Gaussian Blur 2',
    nm: 'Gaussian Blur',
    np: 5,
    params: [
      param('blurriness', 'ADBE Gaussian Blur 2-0001', 'Blurriness', 0, 10, pixels()),
      param('dimensions', 'ADBE Gaussian Blur 2-0002', 'Blur Dimensions', 7, 1, {
        kind: 'menu',
        options: [1, 2, 3],
      }),
      param('repeatEdgePixels', 'ADBE Gaussian Blur 2-0003', 'Repeat Edge Pixels', 7, 0, checkbox),
    ],
  },
  transform: {
    kind: 'transform',
    ty: EFFECT_TY.transform,
    mn: 'ADBE Geometry2',
    nm: 'Transform',
    np: 14,
    params: [
      param('anchorPoint', 'ADBE Geometry2-0001', 'Anchor Point', 3, CENTER, {
        kind: 'point',
        dims: 2,
      }),
      param('position', 'ADBE Geometry2-0002', 'Position', 3, CENTER, { kind: 'point', dims: 2 }),
      param('uniformScale', 'ADBE Geometry2-0011', 'Uniform Scale', 7, 1, checkbox),
      param('scaleHeight', 'ADBE Geometry2-0003', 'Scale Height', 0, 100, percent(1, undefined)),
      param('scaleWidth', 'ADBE Geometry2-0004', 'Scale Width', 0, 100, percent(1, undefined), {
        hiddenBy: 'uniformScale',
      }),
      param('skew', 'ADBE Geometry2-0005', 'Skew', 0, 0, angle),
      param('skewAxis', 'ADBE Geometry2-0006', 'Skew Axis', 0, 0, angle),
      param('rotation', 'ADBE Geometry2-0007', 'Rotation', 0, 0, angle),
      param('opacity', 'ADBE Geometry2-0008', 'Opacity', 0, 100, percent()),
      // Motion blur settings: no Lottie player renders motion blur.
      param(
        'useCompShutterAngle',
        'ADBE Geometry2-0009',
        'Use Composition’s Shutter Angle',
        7,
        1,
        checkbox,
        { unused: true },
      ),
      param('shutterAngle', 'ADBE Geometry2-0010', 'Shutter Angle', 0, 0, angle, { unused: true }),
      param(
        'sampling',
        'ADBE Geometry2-0012',
        'Sampling',
        7,
        1,
        { kind: 'menu', options: [1, 2] },
        {
          unused: true,
        },
      ),
    ],
  },
  setMatte: {
    kind: 'setMatte',
    ty: EFFECT_TY.setMatte,
    mn: 'ADBE Set Matte3',
    nm: 'Set Matte',
    np: 8,
    params: [
      param('layer', 'ADBE Set Matte3-0001', 'Take Matte From Layer', 10, 0, { kind: 'layer' }),
      // lottie-web (the only player that renders Set Matte) always uses the alpha channel.
      param(
        'channel',
        'ADBE Set Matte3-0002',
        'Use For Matte',
        7,
        4,
        { kind: 'menu', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        { unused: true },
      ),
      param('invert', 'ADBE Set Matte3-0003', 'Invert Matte', 7, 0, checkbox, { unused: true }),
      param('stretch', 'ADBE Set Matte3-0004', 'Stretch Matte to Fit', 7, 1, checkbox, {
        unused: true,
      }),
      param('composite', 'ADBE Set Matte3-0005', 'Composite Matte with Original', 7, 1, checkbox, {
        unused: true,
      }),
      param('premultiply', 'ADBE Set Matte3-0006', 'Premultiply Matte Layer', 7, 1, checkbox, {
        unused: true,
      }),
    ],
  },
  sliderControl: control('sliderControl', 'ADBE Slider Control', 'Slider Control', [
    param('slider', 'ADBE Slider Control-0001', 'Slider', 0, 0, { kind: 'number', precision: 2 }),
  ]),
  angleControl: control('angleControl', 'ADBE Angle Control', 'Angle Control', [
    param('angle', 'ADBE Angle Control-0001', 'Angle', 1, 0, angle),
  ]),
  colorControl: control('colorControl', 'ADBE Color Control', 'Color Control', [
    param('color', 'ADBE Color Control-0001', 'Color', 2, [1, 0, 0, 1], color),
  ]),
  pointControl: control('pointControl', 'ADBE Point Control', 'Point Control', [
    param('point', 'ADBE Point Control-0001', 'Point', 3, [0, 0], { kind: 'point', dims: 2 }),
  ]),
  point3dControl: control('point3dControl', 'ADBE Point3D Control', '3D Point Control', [
    param('point', 'ADBE Point3D Control-0001', '3D Point', 3, [0, 0, 0], {
      kind: 'point',
      dims: 3,
    }),
  ]),
  checkboxControl: control('checkboxControl', 'ADBE Checkbox Control', 'Checkbox Control', [
    param('checkbox', 'ADBE Checkbox Control-0001', 'Checkbox', 7, 0, checkbox),
  ]),
  layerControl: control('layerControl', 'ADBE Layer Control', 'Layer Control', [
    param('layer', 'ADBE Layer Control-0001', 'Layer', 10, 0, { kind: 'layer' }),
  ]),
}

/** Expression controls: one control inside a generic (`ty` 5) effect. */
function control(kind: EffectKind, mn: string, nm: string, params: EffectParamDef[]): EffectDef {
  return { kind, ty: EFFECT_TY.custom, mn, nm, np: params.length + 2, params }
}

/** Effects the editor can add, in menu order (the ones lottie-web's SVG renderer draws). */
export const ADDABLE_EFFECTS = [
  'fill',
  'tint',
  'tritone',
  'dropShadow',
  'gaussianBlur',
  'stroke',
  'transform',
] as const satisfies readonly EffectKind[]

export type AddableEffectKind = (typeof ADDABLE_EFFECTS)[number]

const DEFS_BY_MN = new Map(Object.values(EFFECT_DEFS).map((d) => [d.mn, d]))
const DEFS_BY_TY = new Map(
  Object.values(EFFECT_DEFS)
    .filter((d) => d.ty !== EFFECT_TY.custom)
    .map((d) => [d.ty, d]),
)

/**
 * The catalog entry of an effect: by match name, else (files without match names) by type.
 * Generic effects (`ty` 5) are only recognized by match name.
 */
export function effectDefOf(
  effect: Pick<Effect, 'ty' | 'mn'> | null | undefined,
): EffectDef | null {
  if (!effect) return null
  if (typeof effect.mn === 'string') {
    const byMn = DEFS_BY_MN.get(effect.mn)
    if (byMn) return byMn
  }
  if (typeof effect.ty === 'number' && effect.ty !== EFFECT_TY.custom)
    return DEFS_BY_TY.get(effect.ty) ?? null
  return null
}

/* -------------------------------------------------------------------------- */
/*                                  Factories                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONTEXT: EffectContext = { center: [0, 0], masks: 0 }

/** Default value of a parameter for a layer. */
export function paramDefault(p: EffectParamDef, ctx: EffectContext = DEFAULT_CONTEXT): ParamValue {
  const v = typeof p.value === 'function' ? p.value(ctx) : p.value
  return Array.isArray(v) ? [...v] : v
}

/** A control exactly as Bodymovin writes it (key order matters to ThorVG). */
function createControl(p: EffectParamDef, ix: number, ctx: EffectContext): EffectValue {
  return {
    ty: p.ty,
    nm: p.nm,
    mn: p.mn,
    ix,
    v: { a: 0, k: paramDefault(p, ctx), ix } as Property,
  }
}

/**
 * A new effect of a known kind, exactly as After Effects + Bodymovin export it, with defaults
 * that render right away. `name` is the effect's name (defaults to the English After Effects
 * name); `ix` is its 1-based position in the layer.
 */
export function createEffect(
  kind: EffectKind,
  opts: { name?: string; ix?: number; context?: EffectContext } = {},
): Effect {
  const def = EFFECT_DEFS[kind]
  const ctx = opts.context ?? DEFAULT_CONTEXT
  return {
    ty: def.ty,
    nm: opts.name ?? def.nm,
    np: def.np,
    mn: def.mn,
    ix: opts.ix ?? 1,
    en: 1,
    ef: def.params.map((p, i) => createControl(p, i + 1, ctx)),
  }
}

/** Effect context of a layer: its content center (in layer space) and its masks. */
export function effectContext(anim: Animation, layerPath: NodePath): EffectContext {
  const layer = layerAt(anim, layerPath)
  const masks = Array.isArray(layer?.masksProperties) ? layer.masksProperties.length : 0
  return { center: layer ? contentCenter(anim, layer) : [0, 0], masks }
}

function layerAt(anim: Animation, layerPath: NodePath): Layer | undefined {
  let node: unknown = anim
  for (const seg of layerPath) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string | number, unknown>)[seg]
  }
  return node !== null && typeof node === 'object' ? (node as Layer) : undefined
}

/**
 * Where the Transform effect pivots by default. After Effects uses the layer's source center;
 * shape, text and null layers have no source size, so their anchor point is used (the pivot of
 * the layer's own transform).
 */
/** Half of a positive size, or null. */
function halfSize(w: unknown, h: unknown): [number, number] | null {
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? [w / 2, h / 2] : null
}

function contentCenter(anim: Animation, layer: Layer): [number, number] {
  let center: [number, number] | null = null
  if (layer.ty === 1) center = halfSize(layer.sw, layer.sh)
  else if (layer.ty === 0) center = halfSize(layer.w, layer.h)
  else if (layer.ty === 2) {
    const asset = anim.assets?.find((a) => a.id === layer.refId) as
      { w?: number; h?: number } | undefined
    center = halfSize(asset?.w, asset?.h)
  }
  if (center) return center
  const a = layer.ks?.a
  const value = a ? (getKeyframes<number[]>(a)?.[0]?.s ?? a.k) : undefined
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number')
    return [round3(value[0]), round3(value[1])]
  return [0, 0]
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * A unique effect name in the After Effects style: the base name first, then "Base 2",
 * "Base 3"… A trailing number on `base` is ignored ("Drop Shadow 2" → "Drop Shadow 3").
 */
export function uniqueEffectName(
  effects: readonly (Effect | null | undefined)[],
  base: string,
): string {
  const root = base.replace(/\s+\d+$/, '').trim() || base.trim()
  const names = new Set(effects.map((e) => (typeof e?.nm === 'string' ? e.nm.trim() : '')))
  if (!names.has(root)) return root
  const re = new RegExp(`^${escapeRegExp(root)} (\\d+)$`)
  let max = 1
  for (const name of names) {
    const m = re.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${root} ${max + 1}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* -------------------------------------------------------------------------- */
/*                             Structural editing                             */
/* -------------------------------------------------------------------------- */

/** Layer types that take effects (After Effects has no effects on cameras, lights and audio). */
export function canHaveEffects(layer: Pick<Layer, 'ty'> | null | undefined): boolean {
  return !!layer && ![6, 13, 14, 15].includes(layer.ty as number)
}

/** Keeps `ix` = position + 1 (expressions such as `effect(2)` address effects by it). */
export function renumberEffects(effects: Effect[]): void {
  effects.forEach((effect, i) => {
    if (effect && typeof effect === 'object' && effect.ix !== i + 1) effect.ix = i + 1
  })
}

function listOf(layer: Layer): Effect[] | null {
  return Array.isArray(layer.ef) ? layer.ef : null
}

/**
 * Inserts an effect (default: at the end) and returns its index. Works on immer drafts; the
 * effect is stored as given, so pass a fresh object.
 */
export function insertEffect(layer: Layer, effect: Effect, index?: number): number {
  if (!Array.isArray(layer.ef)) layer.ef = []
  const effects = layer.ef
  const at = index === undefined ? effects.length : clampIndex(index, effects.length)
  effects.splice(at, 0, effect)
  renumberEffects(effects)
  return at
}

/** Removes an effect; the `ef` list goes away with the last one (as in Bodymovin exports). */
export function removeEffect(layer: Layer, index: number): boolean {
  const effects = listOf(layer)
  if (!effects || index < 0 || index >= effects.length) return false
  effects.splice(index, 1)
  if (effects.length === 0) delete layer.ef
  else renumberEffects(effects)
  return true
}

/** Moves an effect to a new position (the index it has after the move). */
export function moveEffect(layer: Layer, from: number, to: number): boolean {
  const effects = listOf(layer)
  if (!effects || from < 0 || from >= effects.length) return false
  const target = clampIndex(to, effects.length - 1)
  if (target === from) return false
  const [effect] = effects.splice(from, 1)
  effects.splice(target, 0, effect)
  renumberEffects(effects)
  return true
}

/**
 * Inserts a deep copy right after the effect (keyframes and expressions included) and returns
 * its index, or -1. `name` defaults to the next free "Name 2"-style name.
 */
export function duplicateEffect(layer: Layer, index: number, name?: string): number {
  const effects = listOf(layer)
  const source = effects?.[index]
  if (!effects || !source) return -1
  // JSON, not structuredClone: the source may be an immer draft (a Proxy).
  const copy = JSON.parse(JSON.stringify(source)) as Effect
  copy.nm = name ?? uniqueEffectName(effects, nameOf(source))
  effects.splice(index + 1, 0, copy)
  renumberEffects(effects)
  return index + 1
}

/** Renames an effect; blank names are ignored. */
export function renameEffect(layer: Layer, index: number, name: string): boolean {
  const effect = listOf(layer)?.[index]
  const next = name.trim()
  if (!effect || !next || effect.nm === next) return false
  effect.nm = next
  return true
}

/** Turns an effect on or off (`en` 1/0). */
export function setEffectEnabled(layer: Layer, index: number, enabled: boolean): boolean {
  const effect = listOf(layer)?.[index]
  if (!effect) return false
  const en = enabled ? 1 : 0
  if (effect.en === en) return false
  effect.en = en
  return true
}

/**
 * Resets the parameters of a known effect to their defaults: values become static, while
 * expressions, slot ids (`sid`) and unknown controls are kept. Returns false for unknown effects.
 */
export function resetEffect(
  layer: Layer,
  index: number,
  ctx: EffectContext = DEFAULT_CONTEXT,
): boolean {
  const effect = listOf(layer)?.[index]
  const def = effectDefOf(effect)
  if (!effect || !def || !Array.isArray(effect.ef)) return false
  const matches = matchParams(effect, def)
  let changed = false
  effect.ef.forEach((value, i) => {
    const p = matches[i]
    const prop = value?.v as AnyProperty | undefined
    if (!p || !isPropertyLike(prop)) return
    const next = paramDefault(p, ctx)
    const current = prop.k
    if (!getKeyframes(prop) && sameValue(current, next)) return
    prop.k = next
    prop.a = 0
    changed = true
  })
  return changed
}

function sameValue(a: unknown, b: ParamValue): boolean {
  if (typeof b === 'number') return a === b || (Array.isArray(a) && a.length === 1 && a[0] === b)
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
}

function clampIndex(i: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(i)))
}

function nameOf(effect: Effect): string {
  const nm = typeof effect.nm === 'string' ? effect.nm.trim() : ''
  return nm || effectDefOf(effect)?.nm || 'Effect'
}

/* -------------------------------------------------------------------------- */
/*                              Selection remapping                           */
/* -------------------------------------------------------------------------- */

/**
 * Maps a path through `[...layerPath, 'ef', i, …]` to the effect's new index after a structural
 * edit. Returns the path unchanged when it is not inside the layer's effects, a new path when
 * the index moved, or null when the effect is gone.
 */
export function remapEffectPath(
  path: NodePath,
  layerPath: NodePath,
  map: (index: number) => number | null,
): NodePath | null {
  const n = layerPath.length
  if (path.length <= n + 1 || path[n] !== 'ef') return path
  for (let i = 0; i < n; i++) if (path[i] !== layerPath[i]) return path
  const index = path[n + 1]
  if (typeof index !== 'number') return path
  const next = map(index)
  if (next === null) return null
  if (next === index) return path
  return [...path.slice(0, n + 1), next, ...path.slice(n + 2)]
}

/** Index maps of the structural edits (old index → new index, null = removed). */
export const effectIndexMaps = {
  remove: (removed: number) => (i: number) => (i === removed ? null : i > removed ? i - 1 : i),
  insert: (inserted: number) => (i: number) => (i >= inserted ? i + 1 : i),
  move: (from: number, to: number) => (i: number) => {
    if (i === from) return to
    if (from < to && i > from && i <= to) return i - 1
    if (to < from && i >= to && i < from) return i + 1
    return i
  },
}

/* -------------------------------------------------------------------------- */
/*                                 Parameters                                 */
/* -------------------------------------------------------------------------- */

/** Shape of a control's value: a number or a vector with its length. */
function valueLength(prop: unknown): number | null {
  if (!isPropertyLike(prop)) return null
  const kfs = getKeyframes<unknown>(prop)
  const v = kfs ? (kfs[0]?.s ?? kfs[0]?.e) : prop.k
  if (typeof v === 'number') return 1
  if (Array.isArray(v) && v.every((c) => typeof c === 'number')) return v.length
  return null
}

/** True when the stored value fits how the parameter is edited (guards against odd files). */
function fits(p: EffectParamDef, value: EffectValue | undefined): boolean {
  const len = valueLength(value?.v)
  if (len === null) return false
  switch (p.ui.kind) {
    case 'color':
      return len === 3 || len === 4
    case 'point':
      return len >= 2
    default:
      return len === 1
  }
}

/**
 * Matches an effect's controls to the catalog parameters: by match name, or by position for
 * files without match names (players read controls by position). Entries are null for
 * controls that are unknown or whose value doesn't fit the parameter.
 */
export function matchParams(effect: Effect, def: EffectDef): (EffectParamDef | null)[] {
  const values = Array.isArray(effect.ef) ? effect.ef : []
  const byMn = new Map(def.params.map((p) => [p.mn, p]))
  return values.map((value, i) => {
    if (!value || typeof value !== 'object') return null
    const p =
      typeof value.mn === 'string' && value.mn ? (byMn.get(value.mn) ?? null) : def.params[i]
    return p && fits(p, value) ? p : null
  })
}

/* -------------------------------------------------------------------------- */
/*                                Player support                              */
/* -------------------------------------------------------------------------- */

/** Mirrors `compat.ts` (effect type → feature). */
const FEATURE_BY_TY: Partial<Record<number, FeatureId>> = {
  20: 'fx.tint',
  21: 'fx.fill',
  22: 'fx.stroke',
  23: 'fx.tritone',
  24: 'fx.levels',
  25: 'fx.dropShadow',
  26: 'fx.skottieOnly',
  27: 'fx.skottieOnly',
  28: 'fx.setMatte',
  29: 'fx.gaussianBlur',
  35: 'fx.transform',
}

/** Skottie matches effects by match name first, so it also renders these when saved as `ty` 5. */
const SKOTTIE_BY_MN = new Set([
  ...SKOTTIE_ONLY_EFFECT_MN,
  'ADBE Drop Shadow',
  'ADBE Fill',
  'ADBE Gaussian Blur 2',
  'ADBE Geometry2',
  'ADBE Pro Levels2',
  'ADBE Tint',
  'ADBE Tritone',
])

/**
 * The compatibility feature of an effect. Same as `detectFeatures` except for generic (`ty` 5)
 * effects, which `compat.ts` treats as expression controls: expression controls and pseudo
 * effects are, but visual After Effects effects saved as `ty` 5 render in Skottie only (by
 * match name) or nowhere.
 */
export function effectFeature(effect: Pick<Effect, 'ty' | 'mn'>): FeatureId {
  const byTy = typeof effect.ty === 'number' ? FEATURE_BY_TY[effect.ty] : undefined
  if (byTy) return byTy
  const mn = typeof effect.mn === 'string' ? effect.mn.trim() : ''
  if (effect.ty === EFFECT_TY.custom) {
    if (!mn || isControlsEffect(mn)) return 'fx.expressionControls'
    return SKOTTIE_BY_MN.has(mn) ? 'fx.skottieOnly' : 'fx.unknown'
  }
  return mn && SKOTTIE_ONLY_EFFECT_MN.includes(mn) ? 'fx.skottieOnly' : 'fx.unknown'
}

/** Expression controls ("ADBE Slider Control") and pseudo effects (rig controllers). */
function isControlsEffect(mn: string): boolean {
  return /^ADBE .* Control$/.test(mn) || /^pseudo\//i.test(mn)
}

/** Players checked for effect support (the general-purpose ones, as in "All players"). */
export const EFFECT_PLAYERS: readonly PlayerId[] = TARGETS.all

export interface EffectSupport {
  feature: FeatureId
  /** Worst level among the players. */
  level: Level
  players: { player: PlayerId; level: Level }[]
}

/** Which players render an effect. */
export function effectSupport(effect: Pick<Effect, 'ty' | 'mn'>): EffectSupport {
  const feature = effectFeature(effect)
  const players = EFFECT_PLAYERS.map((player) => ({ player, level: cellOf(feature, player).level }))
  return { feature, level: worstLevel(players.map((p) => p.level)), players }
}

/** Effect types lottie-web's SVG renderer (the editor preview) draws, by `ty` only. */
const LOTTIE_WEB_TY = new Set([20, 21, 22, 23, 24, 25, 28, 29, 35])

/** Effect types dotLottie players (ThorVG) draw; they skip effects without `en: 1`. */
const THORVG_TY = new Set([20, 21, 22, 23, 25, 29])

/** True when lottie-web's SVG renderer (the editor preview) draws the effect. */
export function rendersInPreview(effect: Pick<Effect, 'ty'>): boolean {
  return LOTTIE_WEB_TY.has(effect.ty)
}

/* -------------------------------------------------------------------------- */
/*                                   Issues                                   */
/* -------------------------------------------------------------------------- */

export type EffectIssueCode =
  /** No `ef` list: lottie-web fails to load the animation. */
  | 'noControls'
  /** Off, but lottie-web draws it anyway (dotLottie players don't). */
  | 'disabledStillRendered'
  /** No `en` flag: dotLottie players skip it. */
  | 'enabledMissing'
  /** Saved as a generic effect (`ty` 5): only Skottie recognizes it. */
  | 'genericType'
  /** Drop shadow controls not named in English: lottie-android and lottie-ios miss them. */
  | 'localizedNames'
  /** Stroke on a layer without masks: nothing to stroke. */
  | 'noMasks'
  /** Stroke of a mask that doesn't exist: lottie-web fails while rendering. */
  | 'missingMask'

export type EffectFix = 'addControls' | 'enable' | 'setType' | 'englishNames' | 'strokeAllMasks'

export interface EffectIssue {
  code: EffectIssueCode
  severity: 'warning' | 'error'
  fix?: EffectFix
}

/** First value of a numeric control (players set some effects up once, from this value). */
function controlNumber(effect: Effect, index: number): number | null {
  const prop = effect.ef?.[index]?.v as AnyProperty | undefined
  if (!isPropertyLike(prop)) return null
  const kfs = getKeyframes<unknown>(prop)
  const v = kfs ? kfs[0]?.s : prop.k
  const n = Array.isArray(v) ? v[0] : v
  return typeof n === 'number' ? n : null
}

/**
 * Controls lottie-android and lottie-ios look up by English name (they find the drop shadow
 * by `ty` 25, then its controls by `nm`).
 */
const NAMED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'ADBE Drop Shadow': ['color', 'opacity', 'direction', 'distance', 'softness'],
}

/** A generic (`ty` 5) copy of a known effect can take its real type when players would read its controls right. */
function canRetype(effect: Effect, def: EffectDef): boolean {
  const values = Array.isArray(effect.ef) ? effect.ef : []
  if (values.length < def.params.length) return false
  return def.params.every((p, i) => {
    const v = values[i]
    return !!v && (typeof v.mn !== 'string' || !v.mn || v.mn === p.mn) && fits(p, v)
  })
}

/** Problems of one effect in some players, most severe first. */
export function effectIssues(effect: Effect, layer: Pick<Layer, 'masksProperties'>): EffectIssue[] {
  const out: EffectIssue[] = []
  if (!Array.isArray(effect.ef))
    out.push({ code: 'noControls', severity: 'error', fix: 'addControls' })
  const def = effectDefOf(effect)
  if (def?.kind === 'stroke' && effect.ty === EFFECT_TY.stroke && Array.isArray(effect.ef)) {
    const masks = Array.isArray(layer.masksProperties) ? layer.masksProperties.length : 0
    const all = controlNumber(effect, 1) === 1
    const path = controlNumber(effect, 0) ?? 0
    if (!all && (path < 1 || path > masks)) {
      out.push({ code: 'missingMask', severity: 'error', fix: 'strokeAllMasks' })
    } else if (masks === 0) {
      out.push({ code: 'noMasks', severity: 'warning' })
    }
  }
  if (effect.en === 0 && rendersInPreview(effect)) {
    out.push({ code: 'disabledStillRendered', severity: 'warning' })
  } else if (effect.en === undefined && THORVG_TY.has(effect.ty)) {
    out.push({ code: 'enabledMissing', severity: 'warning', fix: 'enable' })
  }
  if (def && def.ty !== EFFECT_TY.custom && effect.ty === EFFECT_TY.custom) {
    out.push({
      code: 'genericType',
      severity: 'warning',
      fix: canRetype(effect, def) ? 'setType' : undefined,
    })
  }
  const named = def ? NAMED_PARAMS[def.mn] : undefined
  if (def && named && effect.ty === def.ty && Array.isArray(effect.ef)) {
    const matches = matchParams(effect, def)
    const renamed = effect.ef.some((v, i) => {
      const p = matches[i]
      return !!p && named.includes(p.id) && v?.nm !== p.nm
    })
    if (renamed) out.push({ code: 'localizedNames', severity: 'warning', fix: 'englishNames' })
  }
  return out
}

/** Applies the fix of an issue to the effect at `index`. Works on immer drafts. */
export function applyEffectFix(
  layer: Layer,
  index: number,
  fix: EffectFix,
  ctx: EffectContext = DEFAULT_CONTEXT,
): boolean {
  const effect = listOf(layer)?.[index]
  if (!effect) return false
  const def = effectDefOf(effect)
  switch (fix) {
    case 'addControls': {
      if (Array.isArray(effect.ef)) return false
      effect.ef = def ? def.params.map((p, i) => createControl(p, i + 1, ctx)) : []
      return true
    }
    case 'enable':
      if (effect.en === 1) return false
      effect.en = 1
      return true
    case 'setType':
      if (!def || def.ty === EFFECT_TY.custom || effect.ty === def.ty || !canRetype(effect, def))
        return false
      effect.ty = def.ty
      return true
    case 'englishNames': {
      if (!def || !Array.isArray(effect.ef)) return false
      const matches = matchParams(effect, def)
      let changed = false
      effect.ef.forEach((v, i) => {
        const p = matches[i]
        if (p && v && v.nm !== p.nm) {
          v.nm = p.nm
          changed = true
        }
      })
      return changed
    }
    case 'strokeAllMasks': {
      const all = effect.ef?.[1]?.v as AnyProperty | undefined
      if (!isPropertyLike(all)) return false
      all.k = 1
      all.a = 0
      return true
    }
  }
}
