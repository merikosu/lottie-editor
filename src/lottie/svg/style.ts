/**
 * Computed SVG styles: presentation attributes < CSS rules (specificity, order) < inline
 * `style`, with `!important`, inheritance, `inherit`/`initial`/`unset`, CSS custom properties
 * (`var(--x, fallback)`) and `currentColor`. Invalid declarations are skipped so the next one in
 * the cascade applies, as in browsers.
 */
import type { RGBA } from '@/lib/color'
import { parseColor } from './color'
import { keyAllows, parseDeclarations, type CssDeclaration, type CssRule } from './css'
import { parseLength } from './scan'

export type Paint =
  | { kind: 'none' }
  | { kind: 'color'; color: RGBA }
  /** `currentColor`: resolved with the element's own `color` when painting. */
  | { kind: 'current' }
  /** Paint server reference (`url(#id)`), with the optional fallback after it. */
  | { kind: 'url'; id: string | null; fallback: Paint | null }

export type LineCap = 'butt' | 'round' | 'square'
export type LineJoin = 'miter' | 'round' | 'bevel'

export interface ComputedStyle {
  /* Inherited */
  fill: Paint
  fillOpacity: number
  fillRule: 'nonzero' | 'evenodd'
  stroke: Paint
  /** User units (percentages resolved against the viewport). */
  strokeWidth: number
  strokeOpacity: number
  lineCap: LineCap
  lineJoin: LineJoin
  miterLimit: number
  /** Even-length dash pattern in user units, or null for a solid stroke. */
  dashArray: number[] | null
  dashOffset: number
  color: RGBA
  visible: boolean
  /** Paint the stroke below the fill (`paint-order: stroke`). */
  strokeFirst: boolean
  /** A marker is set (`marker-start/mid/end`). */
  markers: boolean
  /** Custom properties (`--name` → value). */
  vars: ReadonlyMap<string, string>
  /* Not inherited */
  display: boolean
  opacity: number
  nonScalingStroke: boolean
  /** Lottie blend mode index (0 = normal). */
  blendMode: number
  clipPath: string | null
  mask: string | null
  filter: string | null
  stopColor: Paint
  stopOpacity: number
  /** `overflow: visible | auto`: a nested viewport (svg, symbol) does not clip its content. */
  overflowVisible: boolean
  /** CSS `transform` property (overrides the attribute), raw. */
  transform: string | null
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }

/** Initial values (the style of the root's parent). */
export const INITIAL_STYLE: ComputedStyle = {
  fill: { kind: 'color', color: BLACK },
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: { kind: 'none' },
  strokeWidth: 1,
  strokeOpacity: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 4,
  dashArray: null,
  dashOffset: 0,
  color: BLACK,
  visible: true,
  strokeFirst: false,
  markers: false,
  vars: new Map(),
  display: true,
  opacity: 1,
  nonScalingStroke: false,
  blendMode: 0,
  clipPath: null,
  mask: null,
  filter: null,
  stopColor: { kind: 'color', color: BLACK },
  stopOpacity: 1,
  overflowVisible: false,
  transform: null,
}

/** Properties that can be given as presentation attributes. */
const PRESENTATION = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'color',
  'visibility',
  'display',
  'opacity',
  'paint-order',
  'vector-effect',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'stop-color',
  'stop-opacity',
  'overflow',
])

const BLEND_MODES: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
}

/* -------------------------------------------------------------------------- */
/*                                   Parsing                                  */
/* -------------------------------------------------------------------------- */

const URL_RE = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)\s*(.*)$/is

/** Parses a paint value (`none`, color, `currentColor`, `url(#id) [fallback]`), or null. */
export function parsePaint(value: string): Paint | null {
  const v = value.trim()
  const lower = v.toLowerCase()
  if (lower === 'none') return { kind: 'none' }
  if (lower === 'currentcolor') return { kind: 'current' }
  // Context paint only has meaning inside markers / use shadow trees (SVG 2): nothing to draw.
  if (lower === 'context-fill' || lower === 'context-stroke') return { kind: 'none' }
  const url = URL_RE.exec(v)
  if (url) {
    const ref = (url[1] ?? url[2] ?? url[3] ?? '').trim()
    const hash = ref.indexOf('#')
    const id = hash === 0 ? decodeRef(ref.slice(1)) : null
    const rest = url[4].trim()
    let fallback: Paint | null = null
    if (rest) {
      fallback = parsePaint(rest)
      if (!fallback || fallback.kind === 'url') return null
    }
    return { kind: 'url', id, fallback }
  }
  const color = parseColor(v)
  return color ? { kind: 'color', color } : null
}

function decodeRef(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

/** Number or percentage in 0..1. */
function parseOpacity(value: string): number | null {
  const v = value.trim()
  const pct = v.endsWith('%')
  const n = Number(pct ? v.slice(0, -1) : v)
  if (v === '' || v === '%' || !Number.isFinite(n)) return null
  const x = pct ? n / 100 : n
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function parseDashArray(value: string, diag: number): number[] | null | undefined {
  const v = value.trim()
  if (v.toLowerCase() === 'none') return null
  const parts = v.split(/[\s,]+/).filter(Boolean)
  if (parts.length === 0) return undefined
  const out: number[] = []
  for (const p of parts) {
    const n = parseLength(p, diag)
    if (n === null) return undefined
    // A negative value makes the whole list invalid: the stroke is drawn solid.
    if (n < 0) return null
    out.push(n)
  }
  if (out.every((n) => n === 0)) return null
  return out.length % 2 === 1 ? [...out, ...out] : out
}

/** `var(--name, fallback)` substitution; null when a variable is missing without fallback. */
export function substituteVars(
  value: string,
  vars: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  if (!value.includes('var(') || depth > 16) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const start = value.indexOf('var(', i)
    if (start < 0) {
      out += value.slice(i)
      break
    }
    out += value.slice(i, start)
    let depthParen = 0
    let end = start + 3
    for (; end < value.length; end++) {
      if (value[end] === '(') depthParen++
      else if (value[end] === ')' && --depthParen === 0) break
    }
    const inner = value.slice(start + 4, end)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim()
    const resolved = vars.get(name) ?? fallback
    if (resolved === null) return null
    const sub = substituteVars(resolved, vars, depth + 1)
    if (sub === null) return null
    out += sub
    i = end + 1
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                   Cascade                                  */
/* -------------------------------------------------------------------------- */

interface Candidate {
  value: string
  /** 0 attribute, 1 rule, 2 inline, 3 !important rule, 4 !important inline. */
  level: number
  specificity: number
  order: number
}

/** Matches elements against the document's rules (memoized per element). */
export class StyleSheetSet {
  readonly rules: CssRule[]
  /** Selectors that threw in `matches()` (reported once). */
  readonly invalidSelectors = new Set<string>()
  private readonly cache = new WeakMap<Element, Array<{ rule: CssRule; decl: CssDeclaration }>>()

  constructor(rules: CssRule[]) {
    this.rules = rules
  }

  matched(el: Element): Array<{ rule: CssRule; decl: CssDeclaration }> {
    const cached = this.cache.get(el)
    if (cached) return cached
    const out: Array<{ rule: CssRule; decl: CssDeclaration }> = []
    for (const rule of this.rules) {
      if (this.invalidSelectors.has(rule.selector) || !keyAllows(rule.key, el)) continue
      let ok = false
      try {
        ok = el.matches(rule.selector)
      } catch {
        this.invalidSelectors.add(rule.selector)
      }
      if (ok) for (const decl of rule.decls) out.push({ rule, decl })
    }
    this.cache.set(el, out)
    return out
  }
}

/** All declared values per property, highest precedence first. */
function cascade(el: Element, sheets: StyleSheetSet): Map<string, Candidate[]> {
  const map = new Map<string, Candidate[]>()
  const add = (prop: string, c: Candidate) => {
    const list = map.get(prop)
    if (list) list.push(c)
    else map.set(prop, [c])
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.localName.toLowerCase()
    if (!attr.namespaceURI && PRESENTATION.has(name))
      add(name, { value: attr.value, level: 0, specificity: 0, order: 0 })
  }
  for (const { rule, decl } of sheets.matched(el)) {
    add(decl.prop, {
      value: decl.value,
      level: decl.important ? 3 : 1,
      specificity: rule.specificity,
      order: rule.order,
    })
  }
  parseDeclarations(el.getAttribute('style')).forEach((decl, n) => {
    add(decl.prop, { value: decl.value, level: decl.important ? 4 : 2, specificity: 0, order: n })
  })
  // The shorthand `marker` sets the three marker properties.
  const marker = map.get('marker')
  if (marker)
    for (const p of ['marker-start', 'marker-mid', 'marker-end']) for (const c of marker) add(p, c)
  for (const list of map.values()) {
    list.sort((a, b) => b.level - a.level || b.specificity - a.specificity || b.order - a.order)
  }
  return map
}

/* -------------------------------------------------------------------------- */
/*                               Computed values                              */
/* -------------------------------------------------------------------------- */

/** Parser accepting one of the given keywords (case-insensitive). */
const oneOf =
  <T extends string>(...allowed: T[]) =>
  (v: string): T | null => {
    const lower = v.trim().toLowerCase() as T
    return allowed.includes(lower) ? lower : null
  }

type Keyword = 'inherit' | 'initial' | 'unset'

/**
 * Computes the style of `el` from its parent's computed style. `diag` is the normalized
 * diagonal of the current viewport (for percentage stroke widths and dashes).
 */
export function computeStyle(
  el: Element,
  parent: ComputedStyle,
  sheets: StyleSheetSet,
  diag: number,
): ComputedStyle {
  const declared = cascade(el, sheets)

  // Custom properties first: other values may reference them.
  let vars = parent.vars
  for (const [prop, list] of declared) {
    if (!prop.startsWith('--')) continue
    if (vars === parent.vars) vars = new Map(parent.vars)
    ;(vars as Map<string, string>).set(prop, list[0].value)
  }

  /**
   * First declared value that parses, as the parsed value or a CSS-wide keyword;
   * undefined when nothing valid is declared.
   */
  const pick = <T>(
    prop: string,
    parse: (v: string) => T | null | undefined,
  ): T | Keyword | undefined => {
    const list = declared.get(prop)
    if (!list) return undefined
    for (const c of list) {
      const raw = substituteVars(c.value, vars)
      if (raw === null) continue
      const lower = raw.trim().toLowerCase()
      if (lower === 'inherit' || lower === 'initial' || lower === 'unset') return lower
      const parsed = parse(raw)
      if (parsed !== null && parsed !== undefined) return parsed
    }
    return undefined
  }

  /** Resolves a property: inherited ones default to the parent's value. */
  const get = <K extends keyof ComputedStyle>(
    prop: string,
    key: K,
    inherited: boolean,
    parse: (v: string) => ComputedStyle[K] | null | undefined,
  ): ComputedStyle[K] => {
    const v = pick(prop, parse)
    if (v === 'inherit') return parent[key]
    if (v === 'initial') return INITIAL_STYLE[key]
    if (v === 'unset' || v === undefined) return inherited ? parent[key] : INITIAL_STYLE[key]
    return v as ComputedStyle[K]
  }

  const lengthNonNegative = (v: string) => {
    const n = parseLength(v, diag)
    return n !== null && n >= 0 ? n : null
  }

  const color = get('color', 'color', true, (v) => {
    if (v.trim().toLowerCase() === 'currentcolor') return parent.color
    return parseColor(v)
  })

  const paintOrder = pick('paint-order', (v) => {
    const words = v.trim().toLowerCase().split(/\s+/)
    if (words.length === 1 && words[0] === 'normal') return 'fill-first'
    if (!words.every((w) => w === 'fill' || w === 'stroke' || w === 'markers')) return null
    const fi = words.indexOf('fill')
    const si = words.indexOf('stroke')
    // Unlisted keywords follow the listed ones in the default order (fill, stroke, markers).
    const fillPos = fi >= 0 ? fi : 3
    const strokePos = si >= 0 ? si : fi >= 0 ? 4 : 3.5
    return strokePos < fillPos ? 'stroke-first' : 'fill-first'
  })
  const strokeFirst =
    paintOrder === 'inherit' || paintOrder === undefined || paintOrder === 'unset'
      ? parent.strokeFirst
      : paintOrder === 'initial'
        ? false
        : paintOrder === 'stroke-first'

  const hasMarker = ['marker-start', 'marker-mid', 'marker-end'].some((p) => {
    const v = pick(p, (s) => s.trim())
    if (v === undefined || v === 'inherit' || v === 'unset') return parent.markers
    return v !== 'initial' && v.toLowerCase() !== 'none'
  })

  const blend = pick('mix-blend-mode', (v) => BLEND_MODES[v.trim().toLowerCase()])
  const vectorEffect = pick(
    'vector-effect',
    oneOf('none', 'non-scaling-stroke', 'non-scaling-size', 'non-rotation', 'fixed-position'),
  )
  const reference = (prop: string) => {
    const v = pick(prop, (s) => s.trim())
    return v === undefined ||
      v === 'inherit' ||
      v === 'initial' ||
      v === 'unset' ||
      v.toLowerCase() === 'none'
      ? null
      : v
  }

  return {
    fill: get('fill', 'fill', true, parsePaint),
    fillOpacity: get('fill-opacity', 'fillOpacity', true, parseOpacity),
    fillRule: get('fill-rule', 'fillRule', true, oneOf('nonzero', 'evenodd')),
    stroke: get('stroke', 'stroke', true, parsePaint),
    strokeWidth: get('stroke-width', 'strokeWidth', true, lengthNonNegative),
    strokeOpacity: get('stroke-opacity', 'strokeOpacity', true, parseOpacity),
    lineCap: get('stroke-linecap', 'lineCap', true, oneOf('butt', 'round', 'square')),
    lineJoin: get('stroke-linejoin', 'lineJoin', true, (v) => {
      const j = oneOf('miter', 'round', 'bevel', 'miter-clip', 'arcs')(v)
      return j === 'miter-clip' || j === 'arcs' ? 'miter' : j
    }),
    miterLimit: get('stroke-miterlimit', 'miterLimit', true, (v) => {
      const n = Number(v.trim())
      return Number.isFinite(n) && n >= 1 ? n : null
    }),
    dashArray: get('stroke-dasharray', 'dashArray', true, (v) => parseDashArray(v, diag)),
    dashOffset: get('stroke-dashoffset', 'dashOffset', true, (v) => parseLength(v, diag)),
    color,
    visible: get('visibility', 'visible', true, (v) => {
      const k = oneOf('visible', 'hidden', 'collapse')(v)
      return k === null ? null : k === 'visible'
    }),
    strokeFirst,
    markers: hasMarker,
    vars,
    display: get('display', 'display', false, (v) => v.trim().toLowerCase() !== 'none'),
    opacity: get('opacity', 'opacity', false, parseOpacity),
    nonScalingStroke: vectorEffect === 'non-scaling-stroke',
    blendMode: typeof blend === 'number' ? blend : 0,
    clipPath: reference('clip-path'),
    mask: reference('mask'),
    filter: reference('filter'),
    stopColor: get('stop-color', 'stopColor', false, (v) => {
      const p = parsePaint(v)
      return p && (p.kind === 'color' || p.kind === 'current') ? p : null
    }),
    stopOpacity: get('stop-opacity', 'stopOpacity', false, parseOpacity),
    overflowVisible: get('overflow', 'overflowVisible', false, (v) => {
      const k = oneOf('visible', 'auto', 'hidden', 'scroll', 'clip')(v)
      return k === null ? null : k === 'visible' || k === 'auto'
    }),
    transform: (() => {
      const t = pick('transform', (s) => s.trim())
      return t === undefined || t === 'inherit' || t === 'initial' || t === 'unset' ? null : t
    })(),
  }
}

/** Resolves a solid paint to a color (`currentColor` → the element's `color`). */
export function paintColor(paint: Paint, style: ComputedStyle): RGBA | null {
  if (paint.kind === 'color') return paint.color
  if (paint.kind === 'current') return style.color
  return null
}
