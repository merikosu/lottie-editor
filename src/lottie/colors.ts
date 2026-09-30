/**
 * Document colors: finding every color in a Lottie document, grouping them into a palette
 * and rewriting them (replace, adjust, restore) in each source's native format.
 *
 * Sources (lottie-web 5.13 semantics):
 *  - shape fill / stroke `c`             [r,g,b,a] in 0..1; 0..255 in files older than 4.1.9
 *  - gradient fill / stroke `g`           flat [offset,r,g,b]×p, then optional [offset,alpha]×n
 *  - solid layer `sc`                     hex string
 *  - text document `t.d.k[i].s.fc / sc`   [r,g,b] in 0..1 (the stroke only counts when `sw` > 0)
 *  - text animator `t.a[i].a.fc / sc`     color property, 0..1
 *  - effect color control (value ty 2)    color property, 0..1 (nested effect groups included)
 *  - layer style `sy[i].c / hc / sc`      color property, 0..1; gradient overlay `gf`
 * Every composition (root and precomp assets) and every group depth is scanned; static and
 * keyframed values are found, including legacy `e` end values. A property bound to a slot
 * (`sid`) reads its value from `slots[sid].p`, as lottie-web does.
 *
 * Writing is exact: replacing a color with itself changes nothing, a color set back to its
 * original value restores the original numbers, and new values are encoded so that players
 * which floor (lottie-web SVG/canvas) and players which round produce the same 8-bit color.
 */
import { current, isDraft } from 'immer'
import { hslToRgb, rgbToHsl, type RGBA } from '@/lib/color'
import {
  getAt,
  isLayerPath,
  isPathPrefix,
  pathKey,
  setAt,
  type NodePath,
  type PathSegment,
} from './path'
import { isKeyframe } from './property'
import { findPrecomp } from './traverse'
import type { Animation } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type ColorKind =
  'fill' | 'stroke' | 'gradient' | 'text-fill' | 'text-stroke' | 'solid' | 'effect' | 'style'

/** Every kind, in display order. */
export const COLOR_KINDS: readonly ColorKind[] = [
  'fill',
  'stroke',
  'gradient',
  'text-fill',
  'text-stroke',
  'solid',
  'effect',
  'style',
]

/** 8-bit sRGB components. */
export type Rgb8 = readonly [number, number, number]

/** A color stored in a number array (colors, gradient stops). */
export interface ArrayColorRef {
  type: 'array'
  /** Path of the array that holds the components. */
  path: NodePath
  /** Index of the red component (0 for plain colors, 4·stop + 1 for gradient stops). */
  offset: number
  /** 255 for legacy fill/stroke colors (files older than 4.1.9), otherwise 1. */
  scale: 1 | 255
  /** Stored red/green/blue at extraction time (native scale), for exact restores. */
  raw: readonly [number, number, number]
  /** Index of an opacity value that belongs to this color (gradient opacity stop), if any. */
  alphaIndex?: number
  rawAlpha?: number
}

/** A color stored as a hex string (solid layers). */
export interface HexColorRef {
  type: 'hex'
  path: NodePath
  raw: string
}

export type ColorRef = ArrayColorRef | HexColorRef

/** One color value in the document (one static value, keyframe value or gradient stop). */
export interface ColorUsage {
  /** Unique within a scan. */
  id: string
  /** Lowercase #rrggbb (8-bit sRGB, rounded). */
  hex: string
  /** Normalized color (0..1, clamped); `a` equals `alpha`. */
  color: RGBA
  /**
   * Rendered alpha: the effective opacity of a gradient stop, the alpha of an 8-digit solid
   * color, otherwise 1 (players ignore the 4th component of fill/stroke/text/effect colors).
   */
  alpha: number
  kind: ColorKind
  /** Path of the property (or text document / solid `sc`) holding the color. */
  path: NodePath
  keyframeIndex?: number
  /** Legacy end value (`e`) of keyframe `keyframeIndex` that no following keyframe repeats. */
  end?: boolean
  stopIndex?: number
  /** Gradient stop position (0..1). */
  stopOffset?: number
  /** Layer that contains the color. */
  layerPath: NodePath
  /** Shape item (fill, stroke, gradient) when applicable, otherwise the layer. */
  nodePath: NodePath
  /** The property is keyframed. */
  animated: boolean
  /** Alpha can be written (gradient stop with an opacity stop at the same position). */
  alphaEditable: boolean
  /** Every place the value is stored (slot + inline copy, legacy end values that repeat it). */
  refs: ColorRef[]
}

export type GradientKind = 'fill' | 'stroke' | 'style'
export type GradientType = 'linear' | 'radial'

export interface GradientOpacityStop {
  offset: number
  alpha: number
}

/** One gradient value (static, or one keyframe of an animated gradient). */
export interface GradientUsage {
  id: string
  kind: GradientKind
  type: GradientType
  /** Path of the gradient colors object (`g`, or `gf` for a layer style). */
  path: NodePath
  keyframeIndex?: number
  end?: boolean
  animated: boolean
  layerPath: NodePath
  nodePath: NodePath
  /** Color stops, in array order (the same objects as in the color usages). */
  stops: ColorUsage[]
  opacity: GradientOpacityStop[]
  /** Colors, positions and opacity rounded: identical gradients share it. */
  signature: string
}

export interface ColorScan {
  colors: ColorUsage[]
  gradients: GradientUsage[]
}

/* -------------------------------------------------------------------------- */
/*                                Small helpers                               */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** True if `v` is an array with three finite numbers starting at `offset`. */
function isColorArray(v: unknown, offset = 0): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= offset + 3 &&
    isNum(v[offset]) &&
    isNum(v[offset + 1]) &&
    isNum(v[offset + 2])
  )
}

function isNumberArray(v: unknown, minLength: number): v is number[] {
  return Array.isArray(v) && v.length >= minLength && v.every(isNum)
}

function isKeyframeList(k: unknown): k is unknown[] {
  return Array.isArray(k) && k.length > 0 && isKeyframe(k[0])
}

/** 0..1 → 0..255 (rounded, clamped). */
export function to8(v: number): number {
  return Math.round(clamp01(v) * 255)
}

export function colorToRgb8(c: { r: number; g: number; b: number }): Rgb8 {
  return [to8(c.r), to8(c.g), to8(c.b)]
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

export function rgb8ToHex([r, g, b]: Rgb8): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

const eq8 = (a: Rgb8, b: Rgb8) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

function rgb8Of(values: readonly number[], offset: number, scale: 1 | 255): Rgb8 {
  return [
    to8(values[offset] / scale),
    to8(values[offset + 1] / scale),
    to8(values[offset + 2] / scale),
  ]
}

/** Parses #rgb, #rgba, #rrggbb and #rrggbbaa (the '#' is optional). */
export function parseHexColor(
  input: string,
): { rgb8: Rgb8; alpha: number; alphaHex: string } | null {
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  const alphaHex = hex.length === 8 ? hex.slice(6, 8).toLowerCase() : ''
  return { rgb8: [n(0), n(2), n(4)], alpha: alphaHex ? n(6) / 255 : 1, alphaHex }
}

/**
 * Shortest decimal for an 8-bit channel that renders as exactly that value both in players
 * that floor (lottie-web: `floor(v·255)`) and in players that round. Plain `n/255` rounded to
 * 3–4 decimals floors to n−1 for about half of all values.
 */
function computeUnitChannel(n: number): number {
  if (n <= 0) return 0
  if (n >= 255) return 1
  for (let d = 3; d <= 6; d++) {
    const f = 10 ** d
    for (const v of [Math.round((n / 255) * f) / f, Math.ceil((n / 255) * f) / f]) {
      if (Math.floor(v * 255) === n && Math.round(v * 255) === n) return v
    }
  }
  return n / 255
}

const UNIT_CHANNELS: readonly number[] = Array.from({ length: 256 }, (_, n) =>
  computeUnitChannel(n),
)

/** Stored value of an 8-bit channel in a given scale. */
export function encodeChannel(n: number, scale: 1 | 255 = 1): number {
  const c = Math.min(255, Math.max(0, Math.round(n)))
  return scale === 255 ? c : UNIT_CHANNELS[c]
}

/**
 * lottie-web divides fill/stroke colors by 255 when the file version is older than 4.1.9
 * (`checkColors`). A missing or unparsable version counts as modern.
 */
export function usesLegacyColorScale(anim: Pick<Animation, 'v'>): boolean {
  if (typeof anim.v !== 'string' || !anim.v) return false
  const parts = anim.v.split('.').map(Number)
  const min = [4, 1, 9]
  for (let i = 0; i < 3; i++) {
    const p = parts[i]
    if (p === undefined || Number.isNaN(p)) return false
    if (min[i] > p) return true
    if (p > min[i]) return false
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                                   Scanning                                 */
/* -------------------------------------------------------------------------- */

interface ScanContext {
  legacy: boolean
  slots: Animation['slots']
}

interface Collector {
  ctx: ScanContext
  layerPath: NodePath
  colors: ColorUsage[]
  gradients: GradientUsage[]
}

/** Where a property's value lives: the slot it is bound to (if any), then the inline copy. */
interface Source {
  node: Obj
  path: NodePath
}

function sourcesOf(prop: Obj, propPath: NodePath, ctx: ScanContext): Source[] {
  const sid = prop.sid
  const slot = typeof sid === 'string' && ctx.slots ? ctx.slots[sid] : undefined
  if (isObj(slot) && isObj(slot.p) && 'k' in slot.p) {
    return [
      { node: slot.p, path: ['slots', sid as string, 'p'] },
      { node: prop, path: propPath },
    ]
  }
  return [{ node: prop, path: propPath }]
}

function usageId(
  kind: string,
  path: NodePath,
  keyframeIndex?: number,
  end?: boolean,
  stopIndex?: number,
) {
  return `${kind}:${pathKey(path)}:${keyframeIndex ?? '-'}${end ? 'e' : ''}:${stopIndex ?? '-'}`
}

/** Array refs for the value at `sub` in every source that holds a compatible value. */
function arrayRefs(
  sources: Source[],
  subs: PathSegment[][],
  offset: number,
  scale: 1 | 255,
  alphaIndex?: number,
): ArrayColorRef[] {
  const refs: ArrayColorRef[] = []
  for (const sub of subs) {
    for (const source of sources) {
      const arr = getAt<unknown>(source.node, sub)
      if (!isColorArray(arr, offset)) continue
      const ref: ArrayColorRef = {
        type: 'array',
        path: [...source.path, ...sub],
        offset,
        scale,
        raw: [arr[offset], arr[offset + 1], arr[offset + 2]],
      }
      if (alphaIndex !== undefined && isNum(arr[alphaIndex])) {
        ref.alphaIndex = alphaIndex
        ref.rawAlpha = arr[alphaIndex]
      }
      refs.push(ref)
    }
  }
  return refs
}

interface ColorValue {
  kind: ColorKind
  path: NodePath
  nodePath: NodePath
  animated: boolean
  scale: 1 | 255
  value: number[]
  sources: Source[]
  /** Sub-paths (relative to each source) that store this value. */
  subs: PathSegment[][]
  keyframeIndex?: number
  end?: boolean
}

function addColor(c: Collector, v: ColorValue): void {
  const color = {
    r: clamp01(v.value[0] / v.scale),
    g: clamp01(v.value[1] / v.scale),
    b: clamp01(v.value[2] / v.scale),
    a: 1,
  }
  c.colors.push({
    id: usageId(v.kind, v.path, v.keyframeIndex, v.end),
    hex: rgb8ToHex(colorToRgb8(color)),
    color,
    alpha: 1,
    kind: v.kind,
    path: v.path,
    keyframeIndex: v.keyframeIndex,
    end: v.end || undefined,
    layerPath: c.layerPath,
    nodePath: v.nodePath,
    animated: v.animated,
    alphaEditable: false,
    refs: arrayRefs(v.sources, v.subs, 0, v.scale),
  })
}

function sameColor(a: number[], b: number[], scale: 1 | 255): boolean {
  return eq8(rgb8Of(a, 0, scale), rgb8Of(b, 0, scale))
}

/** Static or keyframed color property (`{ a, k }`). */
function scanColorProperty(
  prop: unknown,
  propPath: NodePath,
  kind: ColorKind,
  scale: 1 | 255,
  nodePath: NodePath,
  c: Collector,
): void {
  if (!isObj(prop) || !('k' in prop)) return
  const sources = sourcesOf(prop, propPath, c.ctx)
  const k = sources[0].node.k
  const base = { kind, path: propPath, nodePath, scale, sources }
  if (isKeyframeList(k)) {
    for (let i = 0; i < k.length; i++) {
      const kf = k[i]
      if (!isObj(kf)) continue
      const prev = k[i - 1]
      const next = k[i + 1]
      if (isColorArray(kf.s)) {
        const subs: PathSegment[][] = [['k', i, 's']]
        // Legacy files repeat this value as the previous keyframe's end value.
        if (isObj(prev) && isColorArray(prev.e) && sameColor(prev.e, kf.s, scale))
          subs.push(['k', i - 1, 'e'])
        addColor(c, { ...base, animated: true, value: kf.s, subs, keyframeIndex: i })
      }
      if (
        isColorArray(kf.e) &&
        !(isObj(next) && isColorArray(next.s) && sameColor(kf.e, next.s, scale))
      ) {
        addColor(c, {
          ...base,
          animated: true,
          value: kf.e,
          subs: [['k', i, 'e']],
          keyframeIndex: i,
          end: true,
        })
      }
    }
  } else if (isColorArray(k)) {
    addColor(c, { ...base, animated: false, value: k, subs: [['k']] })
  }
}

/** Opacity at `offset`, interpolated linearly between opacity stops (1 without stops). */
export function opacityAt(stops: readonly GradientOpacityStop[], offset: number): number {
  if (stops.length === 0) return 1
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  if (offset <= sorted[0].offset) return clamp01(sorted[0].alpha)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (offset <= b.offset) {
      const span = b.offset - a.offset
      const t = span > 0 ? (offset - a.offset) / span : 1
      return clamp01(a.alpha + (b.alpha - a.alpha) * t)
    }
  }
  return clamp01(sorted[sorted.length - 1].alpha)
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4)
}

interface GradientInfo {
  colorKind: ColorKind
  kind: GradientKind
  type: GradientType
  path: NodePath
  nodePath: NodePath
}

/** Gradient colors object `{ p, k }` (gradient fill/stroke `g`, layer style overlay `gf`). */
function scanGradient(g: unknown, info: GradientInfo, c: Collector): void {
  if (!isObj(g) || !isObj(g.k)) return
  const p = g.p
  if (!isNum(p) || !Number.isInteger(p) || p < 1) return
  const count = p
  const sources = sourcesOf(g.k, [...info.path, 'k'], c.ctx)
  const k = sources[0].node.k
  const minLength = count * 4

  const emit = (
    arr: number[],
    subs: PathSegment[][],
    animated: boolean,
    keyframeIndex?: number,
    end?: boolean,
  ) => {
    const opacity: (GradientOpacityStop & { index: number })[] = []
    for (let j = minLength; j + 1 < arr.length; j += 2) {
      opacity.push({ offset: arr[j], alpha: clamp01(arr[j + 1]), index: j + 1 })
    }
    // Only sources whose value has the same layout take part in writes.
    const compatible = sources.filter(
      (s, i) => i === 0 || subs.some((sub) => isNumberArray(getAt(s.node, sub), arr.length)),
    )
    const stops: ColorUsage[] = []
    for (let s = 0; s < count; s++) {
      const o = s * 4
      const offset = arr[o]
      let match: (typeof opacity)[number] | undefined
      for (const op of opacity) {
        const d = Math.abs(op.offset - offset)
        if (d <= 0.01 && (!match || d < Math.abs(match.offset - offset))) match = op
      }
      const alpha = opacityAt(opacity, offset)
      const color = {
        r: clamp01(arr[o + 1]),
        g: clamp01(arr[o + 2]),
        b: clamp01(arr[o + 3]),
        a: alpha,
      }
      const usage: ColorUsage = {
        id: usageId(info.colorKind, info.path, keyframeIndex, end, s),
        hex: rgb8ToHex(colorToRgb8(color)),
        color,
        alpha,
        kind: info.colorKind,
        path: info.path,
        keyframeIndex,
        end: end || undefined,
        stopIndex: s,
        stopOffset: offset,
        layerPath: c.layerPath,
        nodePath: info.nodePath,
        animated,
        alphaEditable: match !== undefined,
        refs: arrayRefs(compatible, subs, o + 1, 1, match?.index),
      }
      stops.push(usage)
      c.colors.push(usage)
    }
    const opacityStops = opacity.map(({ offset, alpha }) => ({ offset, alpha }))
    c.gradients.push({
      id: usageId(`gradient-${info.kind}`, info.path, keyframeIndex, end),
      kind: info.kind,
      type: info.type,
      path: info.path,
      keyframeIndex,
      end: end || undefined,
      animated,
      layerPath: c.layerPath,
      nodePath: info.nodePath,
      stops,
      opacity: opacityStops,
      signature: gradientSignature(stops, opacityStops),
    })
  }

  if (isKeyframeList(k)) {
    for (let i = 0; i < k.length; i++) {
      const kf = k[i]
      if (!isObj(kf)) continue
      const prev = k[i - 1]
      const next = k[i + 1]
      if (isNumberArray(kf.s, minLength)) {
        const subs: PathSegment[][] = [['k', i, 's']]
        if (isObj(prev) && isNumberArray(prev.e, minLength) && sameNumbers(prev.e, kf.s))
          subs.push(['k', i - 1, 'e'])
        emit(kf.s, subs, true, i)
      }
      if (
        isNumberArray(kf.e, minLength) &&
        !(isObj(next) && isNumberArray(next.s, minLength) && sameNumbers(kf.e, next.s))
      ) {
        emit(kf.e, [['k', i, 'e']], true, i, true)
      }
    }
  } else if (isNumberArray(k, minLength)) {
    emit(k, [['k']], false)
  }
}

function gradientSignature(
  stops: readonly ColorUsage[],
  opacity: readonly GradientOpacityStop[],
): string {
  const c = stops.map((s) => `${s.hex}@${Math.round((s.stopOffset ?? 0) * 1000)}`).join(',')
  const o = opacity
    .map((s) => `${Math.round(s.offset * 1000)}:${Math.round(s.alpha * 1000)}`)
    .join(',')
  return o ? `${c}|${o}` : c
}

function scanShapes(items: unknown, basePath: NodePath, c: Collector, depth: number): void {
  if (!Array.isArray(items) || depth > 64) return
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isObj(item)) continue
    const path = [...basePath, i]
    switch (item.ty) {
      case 'gr':
        scanShapes(item.it, [...path, 'it'], c, depth + 1)
        break
      case 'fl':
      case 'st':
        scanColorProperty(
          item.c,
          [...path, 'c'],
          item.ty === 'fl' ? 'fill' : 'stroke',
          c.ctx.legacy ? 255 : 1,
          path,
          c,
        )
        break
      case 'gf':
      case 'gs':
        scanGradient(
          item.g,
          {
            colorKind: 'gradient',
            kind: item.ty === 'gf' ? 'fill' : 'stroke',
            type: item.t === 2 ? 'radial' : 'linear',
            path: [...path, 'g'],
            nodePath: path,
          },
          c,
        )
        break
    }
  }
}

function scanText(t: unknown, textPath: NodePath, c: Collector): void {
  if (!isObj(t)) return
  const d = t.d
  if (isObj(d)) {
    const docPath = [...textPath, 'd']
    const sources = sourcesOf(d, docPath, c.ctx)
    const kfs = sources[0].node.k
    if (Array.isArray(kfs)) {
      kfs.forEach((kf, i) => {
        if (!isObj(kf) || !isObj(kf.s)) return
        const doc = kf.s
        const fields: [string, ColorKind][] = [['fc', 'text-fill']]
        // A stroke color without a stroke width is never drawn.
        if (isNum(doc.sw) && doc.sw > 0) fields.push(['sc', 'text-stroke'])
        for (const [field, kind] of fields) {
          const value = doc[field]
          if (!isColorArray(value)) continue
          addColor(c, {
            kind,
            path: docPath,
            nodePath: c.layerPath,
            animated: kfs.length > 1,
            scale: 1,
            value,
            sources,
            subs: [['k', i, 's', field]],
            keyframeIndex: i,
          })
        }
      })
    }
  }
  if (Array.isArray(t.a)) {
    t.a.forEach((animator, j) => {
      if (!isObj(animator) || !isObj(animator.a)) return
      const base: NodePath = [...textPath, 'a', j, 'a']
      scanColorProperty(animator.a.fc, [...base, 'fc'], 'text-fill', 1, c.layerPath, c)
      scanColorProperty(animator.a.sc, [...base, 'sc'], 'text-stroke', 1, c.layerPath, c)
    })
  }
}

/** Effect values: color controls (ty 2), recursing into nested effect groups. */
function scanEffectValues(
  values: unknown,
  valuesPath: NodePath,
  c: Collector,
  depth: number,
): void {
  if (!Array.isArray(values) || depth > 8) return
  values.forEach((value, j) => {
    if (!isObj(value)) return
    if (value.ty === 2)
      scanColorProperty(value.v, [...valuesPath, j, 'v'], 'effect', 1, c.layerPath, c)
    else if (Array.isArray(value.ef))
      scanEffectValues(value.ef, [...valuesPath, j, 'ef'], c, depth + 1)
  })
}

function scanStyles(styles: unknown[], stylesPath: NodePath, c: Collector): void {
  styles.forEach((style, i) => {
    if (!isObj(style)) return
    const path = [...stylesPath, i]
    for (const key of ['c', 'hc', 'sc'])
      scanColorProperty(style[key], [...path, key], 'style', 1, c.layerPath, c)
    if (isObj(style.gf) && 'p' in style.gf) {
      scanGradient(
        style.gf,
        {
          colorKind: 'style',
          kind: 'style',
          type: style.gt === 2 ? 'radial' : 'linear',
          path: [...path, 'gf'],
          nodePath: c.layerPath,
        },
        c,
      )
    }
  })
}

function scanLayer(layer: Obj, layerPath: NodePath, ctx: ScanContext): ColorScan {
  const c: Collector = { ctx, layerPath, colors: [], gradients: [] }
  if (layer.ty === 1 && typeof layer.sc === 'string') {
    const parsed = parseHexColor(layer.sc)
    if (parsed) {
      const path = [...layerPath, 'sc']
      const [r, g, b] = parsed.rgb8
      const color = { r: r / 255, g: g / 255, b: b / 255, a: parsed.alpha }
      c.colors.push({
        id: usageId('solid', path),
        hex: rgb8ToHex(parsed.rgb8),
        color,
        alpha: parsed.alpha,
        kind: 'solid',
        path,
        layerPath,
        nodePath: layerPath,
        animated: false,
        alphaEditable: false,
        refs: [{ type: 'hex', path, raw: layer.sc }],
      })
    }
  }
  if (layer.ty === 4) scanShapes(layer.shapes, [...layerPath, 'shapes'], c, 0)
  if (layer.ty === 5) scanText(layer.t, [...layerPath, 't'], c)
  if (Array.isArray(layer.ef)) {
    layer.ef.forEach((effect, i) => {
      if (isObj(effect)) scanEffectValues(effect.ef, [...layerPath, 'ef', i, 'ef'], c, 0)
    })
  }
  if (Array.isArray(layer.sy)) scanStyles(layer.sy, [...layerPath, 'sy'], c)
  return { colors: c.colors, gradients: c.gradients }
}

/** Layer arrays of the root composition and every precomp asset (malformed entries skipped). */
function compositions(anim: Animation): { layers: unknown[]; path: NodePath }[] {
  const comps: { layers: unknown[]; path: NodePath }[] = []
  if (Array.isArray(anim.layers)) comps.push({ layers: anim.layers, path: ['layers'] })
  if (Array.isArray(anim.assets)) {
    anim.assets.forEach((asset, index) => {
      const layers = isObj(asset) ? asset.layers : undefined
      if (Array.isArray(layers)) comps.push({ layers, path: ['assets', index, 'layers'] })
    })
  }
  return comps
}

interface LayerCacheEntry extends ColorScan {
  key: string
  legacy: boolean
  slots: unknown
}

// Documents from the store are frozen and structurally shared: an edit replaces only the
// objects on the edited path, so unchanged layers keep their scan results.
const layerCache = new WeakMap<object, LayerCacheEntry>()
const docCache = new WeakMap<object, ColorScan>()

/** Scans every color and gradient of the document (cached for frozen documents). */
export function scanColors(anim: Animation): ColorScan {
  const cacheable = Object.isFrozen(anim)
  if (cacheable) {
    const hit = docCache.get(anim)
    if (hit) return hit
  }
  const ctx: ScanContext = { legacy: usesLegacyColorScale(anim), slots: anim.slots }
  const colors: ColorUsage[] = []
  const gradients: GradientUsage[] = []
  for (const comp of compositions(anim)) {
    comp.layers.forEach((layer, i) => {
      if (!isObj(layer)) return
      const layerPath = [...comp.path, i]
      const key = pathKey(layerPath)
      let entry = cacheable && Object.isFrozen(layer) ? layerCache.get(layer) : undefined
      if (!entry || entry.key !== key || entry.legacy !== ctx.legacy || entry.slots !== ctx.slots) {
        entry = { key, legacy: ctx.legacy, slots: ctx.slots, ...scanLayer(layer, layerPath, ctx) }
        if (cacheable && Object.isFrozen(layer)) layerCache.set(layer, entry)
      }
      for (const u of entry.colors) colors.push(u)
      for (const g of entry.gradients) gradients.push(g)
    })
  }
  const result: ColorScan = { colors, gradients }
  if (cacheable) docCache.set(anim, result)
  return result
}

/** True if `scanColors(anim)` would return a cached result (frozen documents only). */
export function isScanCached(anim: Animation): boolean {
  return docCache.has(anim)
}

/** Every color value in the document: all compositions, all sources, static and keyframed. */
export function extractColorUsages(anim: Animation): ColorUsage[] {
  return scanColors(anim).colors
}

/** Every gradient value (gradient fills/strokes and layer style overlays). */
export function extractGradients(anim: Animation): GradientUsage[] {
  return scanColors(anim).gradients
}

/**
 * Current color of a usage in `doc`, read from its first storage place (null when that value
 * no longer exists). Used to show live colors while a list keeps the usages it started with.
 */
export function readUsageColor(doc: Animation, usage: ColorUsage): RGBA | null {
  const ref = usage.refs[0]
  if (!ref) return null
  const value = getAt<unknown>(doc, ref.path)
  if (ref.type === 'hex') {
    const parsed = typeof value === 'string' ? parseHexColor(value) : null
    if (!parsed) return null
    const [r, g, b] = parsed.rgb8
    return { r: r / 255, g: g / 255, b: b / 255, a: parsed.alpha }
  }
  if (!isColorArray(value, ref.offset)) return null
  const a =
    ref.alphaIndex !== undefined && isNum(value[ref.alphaIndex])
      ? clamp01(value[ref.alphaIndex])
      : usage.alpha
  return {
    r: clamp01(value[ref.offset] / ref.scale),
    g: clamp01(value[ref.offset + 1] / ref.scale),
    b: clamp01(value[ref.offset + 2] / ref.scale),
    a,
  }
}

/** Usages whose color is `hex` (any hex notation accepted). */
export function usagesOfColor(usages: readonly ColorUsage[], hex: string): ColorUsage[] {
  const parsed = parseHexColor(hex)
  if (!parsed) return []
  const key = rgb8ToHex(parsed.rgb8)
  return usages.filter((u) => u.hex === key)
}

/* -------------------------------------------------------------------------- */
/*                                  Grouping                                  */
/* -------------------------------------------------------------------------- */

export type ColorSort = 'usage' | 'hue'

export interface GroupOptions {
  /** Merge colors closer than this CIEDE2000 distance (off when 0 or undefined). */
  mergeSimilar?: number
  sortBy?: ColorSort
}

export interface ColorGroup {
  /** Stable key: the representative hex. */
  key: string
  /** Representative color (the most used member). */
  hex: string
  /** Representative color; `a` is the shared alpha, or 1 when usages differ. */
  color: RGBA
  /** Set when every usage has the same alpha and it is below 1. */
  alpha?: number
  /**
   * First usage of the representative color. Its id survives recoloring (it is path based),
   * so it identifies the group across edits; its live value is the group's current color.
   */
  sample: ColorUsage
  usages: ColorUsage[]
  /** Hex colors in the group, most used first (more than one when similar colors merge). */
  members: string[]
  kinds: ColorKind[]
  count: number
  animatedCount: number
  layerCount: number
  /** Position of the group's first usage in document order. */
  order: number
}

interface HexBucket {
  hex: string
  usages: ColorUsage[]
  order: number
}

/** Groups usages by 8-bit color (optionally merging similar colors) and sorts the groups. */
export function groupColors(usages: readonly ColorUsage[], opts: GroupOptions = {}): ColorGroup[] {
  const index = new Map<ColorUsage, number>()
  const buckets = new Map<string, HexBucket>()
  usages.forEach((u, i) => {
    index.set(u, i)
    let bucket = buckets.get(u.hex)
    if (!bucket) {
      bucket = { hex: u.hex, usages: [], order: i }
      buckets.set(u.hex, bucket)
    }
    bucket.usages.push(u)
  })

  const threshold = opts.mergeSimilar ?? 0
  const clusters =
    threshold > 0
      ? clusterSimilar([...buckets.values()], threshold)
      : [...buckets.values()].map((b) => [b])

  const groups = clusters.map((members) => buildGroup(members, index))
  return sortGroups(groups, opts.sortBy ?? 'usage')
}

/**
 * Greedy clustering, most used colors first: a color joins the closest cluster whose
 * representative is within `threshold` (CIEDE2000), otherwise it starts a new cluster.
 * Representatives are bucketed in a Lab grid so each color only meets nearby clusters.
 */
function clusterSimilar(buckets: HexBucket[], threshold: number): HexBucket[][] {
  // CIEDE2000 stays below ~1.5× the Euclidean Lab distance, so reps farther than 3× the
  // threshold can never match: a grid of that cell size needs only the 27 neighboring cells.
  const cell = threshold * 3
  const grid = new Map<string, { lab: Lab; members: HexBucket[] }[]>()
  const clusters: HexBucket[][] = []
  const sorted = [...buckets].sort((a, b) => b.usages.length - a.usages.length || a.order - b.order)
  for (const bucket of sorted) {
    const lab = rgbToLab(bucket.usages[0].color)
    const [cl, ca, cb] = lab.map((v) => Math.floor(v / cell))
    let best: { lab: Lab; members: HexBucket[] } | null = null
    let bestDistance = Infinity
    for (let dl = -1; dl <= 1; dl++) {
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          const reps = grid.get(`${cl + dl},${ca + da},${cb + db}`)
          if (!reps) continue
          for (const rep of reps) {
            if (deltaE76(lab, rep.lab) > cell) continue
            const d = deltaE2000(lab, rep.lab)
            if (d <= threshold && d < bestDistance) {
              best = rep
              bestDistance = d
            }
          }
        }
      }
    }
    if (best) {
      best.members.push(bucket)
      continue
    }
    const rep = { lab, members: [bucket] }
    clusters.push(rep.members)
    const key = `${cl},${ca},${cb}`
    const list = grid.get(key)
    if (list) list.push(rep)
    else grid.set(key, [rep])
  }
  return clusters
}

function buildGroup(members: HexBucket[], index: Map<ColorUsage, number>): ColorGroup {
  const lead = members[0]
  const usages =
    members.length === 1
      ? lead.usages
      : members.flatMap((m) => m.usages).sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0))
  const kindSet = new Set<ColorKind>()
  // Usages of one layer share its path array (see scanLayer), so identity counts layers.
  const layers = new Set<NodePath>()
  const firstAlpha = Math.round(usages[0].alpha * 100) / 100
  let sameAlpha = true
  let animatedCount = 0
  for (const u of usages) {
    kindSet.add(u.kind)
    layers.add(u.layerPath)
    if (sameAlpha && Math.round(u.alpha * 100) / 100 !== firstAlpha) sameAlpha = false
    if (u.animated) animatedCount++
  }
  const shared = sameAlpha ? firstAlpha : 1
  const sample = lead.usages[0]
  const first = sample.color
  return {
    key: lead.hex,
    hex: lead.hex,
    color: { r: first.r, g: first.g, b: first.b, a: shared },
    alpha: shared < 1 ? shared : undefined,
    sample,
    usages,
    members: members.map((m) => m.hex),
    kinds: COLOR_KINDS.filter((k) => kindSet.has(k)),
    count: usages.length,
    animatedCount,
    layerCount: layers.size,
    order: members.reduce((min, m) => Math.min(min, m.order), Infinity),
  }
}

/** Colors this close to gray (HSL saturation) or to black/white sort as neutrals. */
function isNeutral(c: { r: number; g: number; b: number }): boolean {
  const { s, l } = rgbToHsl(c)
  return s < 0.08 || l < 0.04 || l > 0.97
}

/** Sort key for hue ordering: chromatic colors by hue then lightness, neutrals last (light → dark). */
function hueKey(c: { r: number; g: number; b: number }): [number, number, number] {
  const { h, l } = rgbToHsl(c)
  return isNeutral(c) ? [1, 0, -l] : [0, Math.round(h * 10) / 10, -l]
}

function sortGroups<
  T extends { count: number; order: number; color: { r: number; g: number; b: number } },
>(groups: T[], sortBy: ColorSort): T[] {
  if (sortBy === 'hue') {
    const keys = new Map(groups.map((g) => [g, hueKey(g.color)]))
    return groups.sort((a, b) => {
      const ka = keys.get(a)!
      const kb = keys.get(b)!
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.order - b.order
    })
  }
  return groups.sort((a, b) => b.count - a.count || a.order - b.order)
}

export interface GradientGroup {
  /** Stable key: the shared signature. */
  key: string
  /** First gradient of the group (its stops and opacity describe every member). */
  sample: GradientUsage
  usages: GradientUsage[]
  kinds: GradientKind[]
  types: GradientType[]
  count: number
  animatedCount: number
  layerCount: number
  order: number
  /** Average color (for hue sorting). */
  color: { r: number; g: number; b: number }
}

/** Groups identical gradients (same stop colors, positions and opacity). */
export function groupGradients(
  gradients: readonly GradientUsage[],
  opts: { sortBy?: ColorSort } = {},
): GradientGroup[] {
  const map = new Map<string, GradientUsage[]>()
  const order = new Map<string, number>()
  gradients.forEach((g, i) => {
    let list = map.get(g.signature)
    if (!list) {
      list = []
      map.set(g.signature, list)
      order.set(g.signature, i)
    }
    list.push(g)
  })
  const groups: GradientGroup[] = [...map.entries()].map(([key, usages]) => {
    const sample = usages[0]
    const layers = new Set(usages.map((u) => pathKey(u.layerPath)))
    const n = sample.stops.length || 1
    const color = {
      r: sample.stops.reduce((s, st) => s + st.color.r, 0) / n,
      g: sample.stops.reduce((s, st) => s + st.color.g, 0) / n,
      b: sample.stops.reduce((s, st) => s + st.color.b, 0) / n,
    }
    return {
      key,
      sample,
      usages,
      kinds: (['fill', 'stroke', 'style'] as const).filter((k) => usages.some((u) => u.kind === k)),
      types: (['linear', 'radial'] as const).filter((t) => usages.some((u) => u.type === t)),
      count: usages.length,
      animatedCount: usages.filter((u) => u.animated).length,
      layerCount: layers.size,
      order: order.get(key) ?? 0,
      color,
    }
  })
  return sortGroups(groups, opts.sortBy ?? 'usage')
}

/* -------------------------------------------------------------------------- */
/*                                   Writing                                  */
/* -------------------------------------------------------------------------- */

/** Plain (non-draft) view of a document for reading inside or outside immer recipes. */
function snapshot(anim: Animation): Animation {
  return isDraft(anim) ? current(anim) : anim
}

function writeRef(root: unknown, ref: ColorRef, rgb8: Rgb8, alpha: number | undefined): boolean {
  if (ref.type === 'hex') {
    const cur = getAt<unknown>(root, ref.path)
    if (typeof cur !== 'string') return false
    const raw = parseHexColor(ref.raw)
    let next: string
    if (raw && eq8(raw.rgb8, rgb8)) {
      next = ref.raw
    } else {
      const parsed = parseHexColor(cur)
      if (parsed && eq8(parsed.rgb8, rgb8)) return false
      next = rgb8ToHex(rgb8) + (parsed?.alphaHex ?? '')
    }
    if (next === cur) return false
    setAt(root, ref.path, next)
    return true
  }

  const arr = getAt<unknown>(root, ref.path)
  if (!isColorArray(arr, ref.offset)) return false
  let changed = false
  // Back to the value it had when the usage was read: restore the exact original numbers.
  const restore = eq8(rgb8Of(ref.raw, 0, ref.scale), rgb8)
  for (let ch = 0; ch < 3; ch++) {
    const i = ref.offset + ch
    let next: number
    if (restore) next = ref.raw[ch]
    else if (to8(arr[i] / ref.scale) === rgb8[ch])
      continue // unchanged channel: keep its exact value
    else next = encodeChannel(rgb8[ch], ref.scale)
    if (arr[i] !== next) {
      arr[i] = next
      changed = true
    }
  }
  if (alpha !== undefined && ref.alphaIndex !== undefined && isNum(arr[ref.alphaIndex])) {
    const next =
      ref.rawAlpha !== undefined && Math.abs(ref.rawAlpha - alpha) < 0.0005
        ? ref.rawAlpha
        : round3(alpha)
    if (arr[ref.alphaIndex] !== next) {
      arr[ref.alphaIndex] = next
      changed = true
    }
  }
  return changed
}

function writeUsage(
  root: unknown,
  usage: ColorUsage,
  rgb8: Rgb8,
  alpha: number | undefined,
): boolean {
  let changed = false
  for (const ref of usage.refs) changed = writeRef(root, ref, rgb8, alpha) || changed
  return changed
}

export interface ReplaceColorOptions {
  /**
   * Also write the alpha (only gradient stops that have an opacity stop at the same
   * position can store it). By default every usage keeps its alpha.
   */
  alpha?: boolean
}

/**
 * Replaces the color of `target` usages (or of every usage of the hex color `target`) with
 * `to`, writing each source in its native format. Mutates `draft` (use inside `updateDoc`).
 * Returns the number of usages that changed.
 */
export function replaceColor(
  draft: Animation,
  target: readonly ColorUsage[] | string,
  to: RGBA,
  opts: ReplaceColorOptions = {},
): number {
  const usages =
    typeof target === 'string' ? usagesOfColor(extractColorUsages(snapshot(draft)), target) : target
  const rgb8 = colorToRgb8(to)
  const alpha = opts.alpha ? clamp01(to.a) : undefined
  let changed = 0
  for (const u of usages) if (writeUsage(draft, u, rgb8, alpha)) changed++
  return changed
}

export interface ColorAdjustment {
  /** Hue rotation in degrees. */
  hue?: number
  /** −100 (gray) … 0 … 100 (twice as saturated). */
  saturation?: number
  /** −100 (black) … 0 … 100 (white). */
  lightness?: number
  /** Luminance-preserving grayscale. */
  grayscale?: boolean
  invert?: boolean
  /** Mix towards a color; `amount` 0..1. */
  tint?: { color: Pick<RGBA, 'r' | 'g' | 'b'>; amount: number }
}

export function isIdentityAdjustment(adj: ColorAdjustment): boolean {
  return (
    !adj.hue &&
    !adj.saturation &&
    !adj.lightness &&
    !adj.grayscale &&
    !adj.invert &&
    !(adj.tint && adj.tint.amount > 0)
  )
}

/** Linear light → sRGB-encoded value. */
function encodeSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/**
 * Applies an adjustment to one color: hue/saturation/lightness (HSL), then grayscale,
 * invert and tint. Alpha is kept.
 */
export function adjustColor(c: RGBA, adj: ColorAdjustment): RGBA {
  if (isIdentityAdjustment(adj)) return c
  let r = c.r
  let g = c.g
  let b = c.b
  const hue = adj.hue ?? 0
  const sat = adj.saturation ?? 0
  const light = adj.lightness ?? 0
  if (hue || sat || light) {
    const hsl = rgbToHsl({ r, g, b })
    const s = sat ? clamp01(hsl.s * (1 + sat / 100)) : hsl.s
    const l =
      light > 0
        ? hsl.l + (1 - hsl.l) * (light / 100)
        : light < 0
          ? hsl.l * (1 + light / 100)
          : hsl.l
    ;({ r, g, b } = hslToRgb({ h: hsl.h + hue, s, l: clamp01(l) }))
  }
  if (adj.grayscale) {
    const lum =
      0.2126729 * linearize(clamp01(r)) +
      0.7151522 * linearize(clamp01(g)) +
      0.072175 * linearize(clamp01(b))
    const y = clamp01(encodeSrgb(lum))
    r = y
    g = y
    b = y
  }
  if (adj.invert) {
    r = 1 - r
    g = 1 - g
    b = 1 - b
  }
  if (adj.tint && adj.tint.amount > 0) {
    const t = clamp01(adj.tint.amount)
    r += (adj.tint.color.r - r) * t
    g += (adj.tint.color.g - g) * t
    b += (adj.tint.color.b - b) * t
  }
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: c.a }
}

/**
 * Adjusts every usage, computing from the color each usage had when it was read (so a slider
 * drag can re-apply from the same base; an identity adjustment restores that base exactly).
 * Mutates `draft`. Returns the number of usages that changed.
 */
export function adjustColors(
  draft: Animation,
  usages: readonly ColorUsage[],
  adj: ColorAdjustment,
): number {
  let changed = 0
  for (const u of usages) {
    if (writeUsage(draft, u, colorToRgb8(adjustColor(u.color, adj)), undefined)) changed++
  }
  return changed
}

/**
 * Writes back the exact values every usage had when it was read (colors and gradient stop
 * opacity), e.g. to cancel an edit that gave several different colors one new value.
 * Mutates `draft`. Returns the number of usages that changed.
 */
export function revertUsages(draft: Animation, usages: readonly ColorUsage[]): number {
  let changed = 0
  for (const u of usages) {
    let any = false
    for (const ref of u.refs) {
      const rgb8 = ref.type === 'hex' ? parseHexColor(ref.raw)?.rgb8 : rgb8Of(ref.raw, 0, ref.scale)
      if (rgb8 && writeRef(draft, ref, rgb8, ref.type === 'array' ? ref.rawAlpha : undefined))
        any = true
    }
    if (any) changed++
  }
  return changed
}

/* -------------------------------------------------------------------------- */
/*                               Original colors                              */
/* -------------------------------------------------------------------------- */

/** Path of the keyframe object a ref points into (…'k', i, 's'|'e' …), if any. */
function keyframePathOf(path: NodePath): NodePath | null {
  for (let j = path.length - 3; j >= 0; j--) {
    if (
      path[j] === 'k' &&
      typeof path[j + 1] === 'number' &&
      (path[j + 2] === 's' || path[j + 2] === 'e')
    ) {
      return path.slice(0, j + 2)
    }
  }
  return null
}

/** Heuristic identity check: the usage's layer (and shape item) are the same node in both documents. */
function sameNode(a: unknown, b: unknown, usage: ColorUsage): boolean {
  const la = getAt<unknown>(a, usage.layerPath)
  const lb = getAt<unknown>(b, usage.layerPath)
  if (!isObj(la) || !isObj(lb) || la.ty !== lb.ty || la.nm !== lb.nm || la.ind !== lb.ind)
    return false
  if (usage.nodePath.length > usage.layerPath.length) {
    const na = getAt<unknown>(a, usage.nodePath)
    const nb = getAt<unknown>(b, usage.nodePath)
    if (!isObj(na) || !isObj(nb) || na.ty !== nb.ty || na.nm !== nb.nm) return false
  }
  return true
}

function sameKeyframe(a: unknown, b: unknown, path: NodePath): boolean {
  const kf = keyframePathOf(path)
  return !kf || getAt(a, [...kf, 't']) === getAt(b, [...kf, 't'])
}

/** Reads the value `ref` points to in `source` if it has the same layout as in `root`. */
function sourceValue(
  root: unknown,
  source: unknown,
  ref: ColorRef,
): { cur: unknown; src: unknown } | null {
  if (!sameKeyframe(root, source, ref.path)) return null
  const cur = getAt<unknown>(root, ref.path)
  const src = getAt<unknown>(source, ref.path)
  if (ref.type === 'hex')
    return typeof cur === 'string' && typeof src === 'string' ? { cur, src } : null
  if (!isColorArray(cur, ref.offset) || !isColorArray(src, ref.offset) || cur.length !== src.length)
    return null
  return { cur, src }
}

function refIndices(ref: ArrayColorRef): number[] {
  const indices = [ref.offset, ref.offset + 1, ref.offset + 2]
  if (ref.alphaIndex !== undefined) indices.push(ref.alphaIndex)
  return indices
}

/**
 * Writes back the values `usages` have in `source` (normally the document as loaded).
 * Usages whose layer, shape item or keyframe no longer matches are skipped. Mutates `draft`;
 * returns the number of usages that changed.
 */
export function restoreColors(
  draft: Animation,
  usages: readonly ColorUsage[],
  source: Animation,
): number {
  let changed = 0
  for (const u of usages) {
    if (!sameNode(draft, source, u)) continue
    let any = false
    for (const ref of u.refs) {
      const values = sourceValue(draft, source, ref)
      if (!values) continue
      if (ref.type === 'hex') {
        if (values.cur !== values.src) {
          setAt(draft, ref.path, values.src)
          any = true
        }
        continue
      }
      const cur = values.cur as number[]
      const src = values.src as number[]
      for (const i of refIndices(ref)) {
        if (isNum(src[i]) && cur[i] !== src[i]) {
          cur[i] = src[i]
          any = true
        }
      }
    }
    if (any) changed++
  }
  return changed
}

/** True if the usage's value differs from the one it has in `source`. */
export function isUsageModified(doc: Animation, usage: ColorUsage, source: Animation): boolean {
  // Edits keep untouched subtrees (structural sharing): an identical layer object holds the
  // same values, which makes checking a whole document cheap.
  if (
    getAt<unknown>(doc, usage.layerPath) === getAt<unknown>(source, usage.layerPath) &&
    usage.refs.every((ref) => isPathPrefix(usage.layerPath, ref.path))
  ) {
    return false
  }
  if (!sameNode(doc, source, usage)) return false
  for (const ref of usage.refs) {
    const values = sourceValue(doc, source, ref)
    if (!values) continue
    if (ref.type === 'hex') {
      if (values.cur !== values.src) return true
      continue
    }
    const cur = values.cur as number[]
    const src = values.src as number[]
    if (refIndices(ref).some((i) => cur[i] !== src[i])) return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                                    Scope                                   */
/* -------------------------------------------------------------------------- */

/**
 * Path prefixes covered by a selection: the selected nodes, plus the compositions of selected
 * precomp layers (recursively), since their content is what the layer shows.
 */
export function selectionScope(anim: Animation, nodes: readonly NodePath[]): NodePath[] {
  const scope: NodePath[] = []
  const seen = new Set<number>()
  const visit = (path: NodePath) => {
    scope.push(path)
    const node = getAt<unknown>(anim, path)
    if (!isLayerPath(path) || !isObj(node) || node.ty !== 0 || typeof node.refId !== 'string')
      return
    const found = findPrecomp(anim, node.refId)
    if (!found || seen.has(found.index)) return
    seen.add(found.index)
    const layersPath: NodePath = ['assets', found.index, 'layers']
    scope.push(layersPath)
    found.asset.layers.forEach((layer, i) => {
      if (isObj(layer) && layer.ty === 0) visit([...layersPath, i])
    })
  }
  nodes.forEach(visit)
  return scope
}

export function isInScope(path: NodePath, scope: readonly NodePath[]): boolean {
  return scope.some((prefix) => isPathPrefix(prefix, path))
}

/* -------------------------------------------------------------------------- */
/*                                   Palette                                  */
/* -------------------------------------------------------------------------- */

const paletteCache = new WeakMap<object, string[]>()

/** Unique colors of the document (lowercase #rrggbb), most used first. */
export function documentPalette(anim: Animation): string[] {
  const cacheable = Object.isFrozen(anim)
  const hit = cacheable ? paletteCache.get(anim) : undefined
  if (hit) return hit
  // Counting is all a palette needs (much cheaper than full groups on big documents).
  const counts = new Map<string, number>()
  for (const u of extractColorUsages(anim)) counts.set(u.hex, (counts.get(u.hex) ?? 0) + 1)
  const order = [...counts.keys()]
  const rank = new Map(order.map((hex, i) => [hex, i]))
  const palette = order.sort(
    (a, b) => counts.get(b)! - counts.get(a)! || rank.get(a)! - rank.get(b)!,
  )
  if (cacheable) paletteCache.set(anim, palette)
  return palette
}

/** CSS gradient with color and opacity stops merged (`linear` uses `angle`, default 90°). */
export function gradientToCss(
  stops: readonly { offset: number; color: Pick<RGBA, 'r' | 'g' | 'b'> }[],
  opacity: readonly GradientOpacityStop[],
  type: GradientType = 'linear',
  angle = 90,
): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  if (sorted.length === 0) return 'transparent'
  const colorAt = (offset: number) => {
    if (offset <= sorted[0].offset) return sorted[0].color
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (offset <= b.offset) {
        const span = b.offset - a.offset
        const t = span > 0 ? (offset - a.offset) / span : 1
        return {
          r: a.color.r + (b.color.r - a.color.r) * t,
          g: a.color.g + (b.color.g - a.color.g) * t,
          b: a.color.b + (b.color.b - a.color.b) * t,
        }
      }
    }
    return sorted[sorted.length - 1].color
  }
  const offsets = [
    ...new Set(
      [...sorted.map((s) => s.offset), ...opacity.map((o) => o.offset)].map((o) => clamp01(o)),
    ),
  ].sort((a, b) => a - b)
  const parts = offsets.map((offset) => {
    const [r, g, b] = colorToRgb8(colorAt(offset))
    const a = Math.round(opacityAt(opacity, offset) * 1000) / 1000
    const css = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : rgb8ToHex([r, g, b])
    return `${css} ${Math.round(offset * 1000) / 10}%`
  })
  return type === 'radial'
    ? `radial-gradient(circle, ${parts.join(', ')})`
    : `linear-gradient(${angle}deg, ${parts.join(', ')})`
}

/* -------------------------------------------------------------------------- */
/*                               Perceptual color                             */
/* -------------------------------------------------------------------------- */

export type Lab = readonly [number, number, number]

const linearize = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** sRGB (0..1) → CIE L*a*b* (D65). */
export function rgbToLab(c: { r: number; g: number; b: number }): Lab {
  const r = linearize(clamp01(c.r))
  const g = linearize(clamp01(c.g))
  const b = linearize(clamp01(c.b))
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const e = 216 / 24389
  const k = 24389 / 27
  const f = (t: number) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

const DEG = Math.PI / 180

function hueAngle(b: number, a: number): number {
  if (a === 0 && b === 0) return 0
  const h = Math.atan2(b, a) / DEG
  return h < 0 ? h + 360 : h
}

/** CIEDE2000 color difference (Sharma, Wu & Dalal 2005). ~1 is a just-noticeable difference. */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cm7 = ((C1 + C2) / 2) ** 7
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = hueAngle(b1, a1p)
  const h2p = hueAngle(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG)
  const Lpm = (L1 + L2) / 2
  const Cpm = (C1p + C2p) / 2
  let hpm = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * DEG) +
    0.24 * Math.cos(2 * hpm * DEG) +
    0.32 * Math.cos((3 * hpm + 6) * DEG) -
    0.2 * Math.cos((4 * hpm - 63) * DEG)
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const Cpm7 = Cpm ** 7
  const Rc = 2 * Math.sqrt(Cpm7 / (Cpm7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2)
  const Sc = 1 + 0.045 * Cpm
  const Sh = 1 + 0.015 * Cpm * T
  const Rt = -Math.sin(2 * dTheta * DEG) * Rc
  const l = dLp / Sl
  const c = dCp / Sc
  const h = dHp / Sh
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h)
}

/** CIEDE2000 distance between two sRGB colors. */
export function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return deltaE2000(rgbToLab(a), rgbToLab(b))
}
