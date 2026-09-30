/**
 * SVG → Lottie shape items.
 *
 * The document is parsed with DOMParser (XML first, then the lenient HTML parser for
 * "almost SVG" such as markup pasted from web pages), styled with a small CSS engine and
 * walked like a renderer would: every affine transform (element, group, nested viewport,
 * `<use>`, viewBox) is flattened into the path coordinates, so produced group transforms are
 * identity (they only carry opacity / blend mode) — except the "Fill" sub-group of an elliptical
 * radial gradient, which carries the gradient's own transform so the gradient stays exact.
 * Output coordinates are viewBox user units with the origin at the viewBox top-left.
 *
 * Structure: each drawable element → `{ ty: 'gr', it: [paths…, stroke?, fill?, tr] }` (the
 * stroke first: Lottie paints the first style on top, like SVG's default paint order); each
 * `<g>`/`<a>`/`<svg>`/`<symbol>` instance → a nested group; siblings are reversed because the
 * last SVG element paints on top while the first Lottie item does.
 */
import {
  BoundsAccumulator,
  composeMatrices,
  IDENTITY_MATRIX,
  invertMatrix,
  matrixSingularValues,
  multiplyMatrices,
  pathBounds,
  shapeItemsBounds,
  transformBox,
  translationMatrix,
  type Box,
  type Matrix2D,
} from '../bounds'
import type { ShapeItem } from '../types'
import {
  geometryDecimals,
  makeFill,
  makeGradientFill,
  makeGradientStroke,
  makeGroup,
  makePath,
  makeRect,
  makeStroke,
  withGeometryDecimals,
  type StrokeStyle,
} from './build'
import { parseStylesheet, type CssRule } from './css'
import {
  gradientToLottie,
  isGradientElement,
  localRef,
  resolveGradient,
  type ResolvedGradient,
} from './gradient'
import { arcTo, parsePathData, PathBuilder, subpathToBezier, type AbsSubpath } from './path-data'
import { parseLength, parseNumberList } from './scan'
import {
  computeStyle,
  INITIAL_STYLE,
  paintColor,
  StyleSheetSet,
  type ComputedStyle,
  type Paint,
} from './style'
import { parseTransform } from './transform'
import {
  SvgImportError,
  type SvgImportOptions,
  type SvgImportResult,
  type SvgWarning,
  type SvgWarningCode,
} from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape'

/** Elements that are never rendered directly (definitions, metadata, resources). */
const NON_RENDERING = new Set([
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'style',
  'script',
  'title',
  'desc',
  'metadata',
  'filter',
  'font',
  'font-face',
  'glyph',
  'missing-glyph',
  'view',
  'cursor',
  'color-profile',
])

const ANIMATION = new Set(['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set'])
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const GRAPHICS = new Set([
  ...SHAPES,
  'g',
  'a',
  'svg',
  'use',
  'switch',
  'text',
  'image',
  'foreignObject',
])

const LABELS: Record<string, string> = {
  path: 'Path',
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  polyline: 'Polyline',
  polygon: 'Polygon',
  g: 'Group',
  a: 'Link',
  svg: 'Group',
  switch: 'Group',
  use: 'Use',
  symbol: 'Symbol',
}

type Viewport = { w: number; h: number }

interface State {
  /** Parent user space → output space. */
  ctm: Matrix2D
  /** Computed style of the parent (or of the `<use>` for referenced content). */
  style: ComputedStyle
  /** Size of the nearest viewport (percentage lengths). */
  vp: Viewport
  /** Elements being instantiated through `<use>` (cycle guard). */
  refs: readonly Element[]
}

const diagonal = (vp: Viewport) => Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2)

/* -------------------------------------------------------------------------- */
/*                                   Parsing                                  */
/* -------------------------------------------------------------------------- */

function findSvgRoot(doc: Document): Element | null {
  const root = doc.documentElement
  if (root && root.localName === 'svg') return root
  return doc.querySelector('svg')
}

function parseDocument(text: string): Element {
  if (typeof DOMParser === 'undefined') {
    throw new SvgImportError('unsupported-environment', 'DOMParser is not available.')
  }
  const source = text.replace(/^﻿/, '').trim()
  if (!source) throw new SvgImportError('invalid', 'The file is empty.')
  let xmlRoot: Element | null = null
  try {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (doc.getElementsByTagName('parsererror').length === 0) xmlRoot = findSvgRoot(doc)
  } catch {
    xmlRoot = null
  }
  if (xmlRoot) return xmlRoot
  // Lenient fallback: HTML entities, undeclared prefixes, unquoted attributes, inline <svg> in HTML.
  let htmlRoot: Element | null = null
  try {
    htmlRoot = new DOMParser().parseFromString(source, 'text/html').querySelector('svg')
  } catch {
    htmlRoot = null
  }
  if (htmlRoot) return htmlRoot
  if (!/<svg[\s>]/i.test(source))
    throw new SvgImportError('not-svg', 'This file is not an SVG image.')
  throw new SvgImportError('invalid', 'The SVG markup could not be parsed.')
}

/* -------------------------------------------------------------------------- */
/*                                  Viewports                                 */
/* -------------------------------------------------------------------------- */

type ViewBox = [number, number, number, number]

function parseViewBox(value: string | null): ViewBox | null {
  const n = parseNumberList(value)
  return n.length === 4 && n[2] > 0 && n[3] > 0 ? [n[0], n[1], n[2], n[3]] : null
}

/** viewBox → viewport mapping for `preserveAspectRatio` (default xMidYMid meet). */
export function viewBoxTransform(vb: ViewBox, par: string | null, w: number, h: number): Matrix2D {
  const sx = w / vb[2]
  const sy = h / vb[3]
  const words = (par ?? '')
    .trim()
    .split(/\s+/)
    .filter((s) => s && s !== 'defer')
  const align = words[0] ?? 'xMidYMid'
  if (align === 'none')
    return composeMatrices([sx, 0, 0, sy, 0, 0], translationMatrix(-vb[0], -vb[1]))
  const slice = words[1] === 'slice'
  const s = slice ? Math.max(sx, sy) : Math.min(sx, sy)
  let tx = -vb[0] * s
  let ty = -vb[1] * s
  const ax = /^x(Min|Mid|Max)/.exec(align)?.[1] ?? 'Mid'
  const ay = /Y(Min|Mid|Max)$/.exec(align)?.[1] ?? 'Mid'
  if (ax === 'Mid') tx += (w - vb[2] * s) / 2
  else if (ax === 'Max') tx += w - vb[2] * s
  if (ay === 'Mid') ty += (h - vb[3] * s) / 2
  else if (ay === 'Max') ty += h - vb[3] * s
  return [s, 0, 0, s, tx, ty]
}

/* -------------------------------------------------------------------------- */
/*                                  Importer                                  */
/* -------------------------------------------------------------------------- */

class Importer {
  readonly ids = new Map<string, Element>()
  readonly sheets: StyleSheetSet
  readonly warnings = new Map<string, SvgWarning>()
  private readonly gradients = new Map<Element, ResolvedGradient | null>()
  private readonly domStyles = new WeakMap<Element, ComputedStyle>()
  private readonly rootVp: Viewport
  readonly root: Element

  constructor(root: Element, rootVp: Viewport) {
    this.root = root
    this.rootVp = rootVp
    for (const el of Array.from(root.querySelectorAll('[id]'))) {
      const id = el.getAttribute('id')
      if (id && !this.ids.has(id)) this.ids.set(id, el)
    }
    const rules: CssRule[] = []
    let skipped = false
    for (const styleEl of Array.from(root.getElementsByTagName('style'))) {
      const type = styleEl.getAttribute('type')
      if (type && type.trim() && type.trim().toLowerCase() !== 'text/css') continue
      const parsed = parseStylesheet(styleEl.textContent ?? '', rules.length)
      rules.push(...parsed.rules)
      if (parsed.skippedAtRules.length > 0) skipped = true
    }
    this.sheets = new StyleSheetSet(rules)
    if (skipped) this.warn('css', null, 'Conditional CSS (@media, @supports) is not applied.')
  }

  warn(code: SvgWarningCode, el: Element | null, message: string): void {
    const id = el?.getAttribute('id') || undefined
    const key = `${code}|${id ?? ''}|${id ? '' : (el?.localName ?? '')}`
    const existing = this.warnings.get(key)
    if (existing) {
      existing.count++
      return
    }
    const w: SvgWarning = { code, message, count: 1 }
    if (id) w.id = id
    if (el) w.element = el.localName
    this.warnings.set(key, w)
  }

  lookup = (id: string): Element | null => this.ids.get(id) ?? null

  /** Style of an element inherited through the DOM tree (gradient stops, symbols' defaults). */
  domStyle = (el: Element): ComputedStyle => {
    const cached = this.domStyles.get(el)
    if (cached) return cached
    const parent =
      el.parentElement && el !== this.root ? this.domStyle(el.parentElement) : INITIAL_STYLE
    const style = computeStyle(el, parent, this.sheets, diagonal(this.rootVp))
    this.domStyles.set(el, style)
    return style
  }

  private gradient(el: Element): ResolvedGradient | null {
    if (!this.gradients.has(el))
      this.gradients.set(el, resolveGradient(el, this.lookup, this.domStyle))
    return this.gradients.get(el) ?? null
  }

  /* ------------------------------ Traversal ------------------------------ */

  renderChildren(parent: Element, state: State): ShapeItem[] {
    const out: ShapeItem[] = []
    const counters = new Map<string, number>()
    for (const child of Array.from(parent.children)) {
      const item = this.render(child, state, counters)
      if (item) out.push(item)
    }
    // Later SVG siblings paint on top; in Lottie the first item is on top.
    return out.reverse()
  }

  private name(
    el: Element,
    counters: Map<string, number>,
    fallbackTag = el.localName,
    fallbackEl?: Element,
  ): string {
    const label = labelOf(el) ?? (fallbackEl ? labelOf(fallbackEl) : null)
    if (label) return label
    const base = LABELS[fallbackTag] ?? 'Group'
    const n = (counters.get(base) ?? 0) + 1
    counters.set(base, n)
    return `${base} ${n}`
  }

  render(el: Element, state: State, counters: Map<string, number>): ShapeItem | null {
    if (el.namespaceURI !== SVG_NS && el.namespaceURI !== null) return null
    const tag = el.localName
    if (ANIMATION.has(tag)) {
      this.warn('animation', el, 'SVG animation is ignored; the static image is imported.')
      return null
    }
    if (NON_RENDERING.has(tag) || !GRAPHICS.has(tag) || !conditionsPass(el)) return null
    const style = computeStyle(el, state.style, this.sheets, diagonal(state.vp))
    if (!style.display) return null
    switch (tag) {
      case 'text':
        if (style.visible || el.querySelector('[visibility="visible"]')) {
          this.warn(
            'text',
            el,
            'Text is not imported. Convert text to outlines (paths) before exporting the SVG.',
          )
        }
        return null
      case 'image':
        if (style.visible) this.warn('image', el, 'Embedded raster images are not imported.')
        return null
      case 'foreignObject':
        this.warn('unsupported', el, 'foreignObject (HTML content) is not imported.')
        return null
      default:
        break
    }
    const local =
      style.transform !== null
        ? (parseTransform(style.transform) ?? parseTransform(el.getAttribute('transform')))
        : parseTransform(el.getAttribute('transform'))
    const ctm = multiplyMatrices(state.ctm, local ?? IDENTITY_MATRIX)
    this.checkEffects(el, style)
    if (SHAPES.has(tag)) return this.drawable(el, tag, style, ctm, state.vp, counters)
    switch (tag) {
      case 'g':
      case 'a': {
        const items = this.renderChildren(el, { ...state, ctm, style })
        return items.length > 0
          ? makeGroup(this.name(el, counters), items, style.opacity, style.blendMode)
          : null
      }
      case 'switch': {
        const child = Array.from(el.children).find(
          (c) => GRAPHICS.has(c.localName) && conditionsPass(c),
        )
        const item = child ? this.render(child, { ...state, ctm, style }, new Map()) : null
        return item
          ? makeGroup(this.name(el, counters), [item], style.opacity, style.blendMode)
          : null
      }
      case 'svg':
        return this.nestedSvg(el, el, style, ctm, state, counters)
      case 'use':
        return this.use(el, style, ctm, state, counters)
      default:
        return null
    }
  }

  private checkEffects(el: Element, style: ComputedStyle): void {
    if (style.clipPath && !this.isHarmlessClip(el, style.clipPath)) {
      this.warn('clip-path', el, 'Clipping paths are ignored; the content is imported unclipped.')
    }
    if (style.mask) this.warn('mask', el, 'Masks are ignored; the content is imported unmasked.')
    if (style.filter) this.warn('filter', el, 'Filters (blur, shadows…) are ignored.')
  }

  /**
   * Design tools wrap artwork in a clip equal to the artboard (Figma's `clip0`); such a clip
   * changes nothing when it is a plain rectangle that contains the whole element.
   */
  private isHarmlessClip(el: Element, ref: string): boolean {
    const id = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(ref.trim())?.[1]
    const clip = id ? this.lookup(id) : null
    if (
      !clip ||
      clip.localName !== 'clipPath' ||
      clip.getAttribute('clipPathUnits') === 'objectBoundingBox'
    )
      return false
    const shapes = Array.from(clip.children).filter(
      (c) => SHAPES.has(c.localName) || c.localName === 'use',
    )
    if (
      shapes.length !== 1 ||
      shapes[0].localName !== 'rect' ||
      shapes[0].hasAttribute('transform')
    )
      return false
    if (clip.hasAttribute('transform')) return false
    const vp = this.rootVp
    const r = shapes[0]
    const x = parseLength(r.getAttribute('x'), vp.w) ?? 0
    const y = parseLength(r.getAttribute('y'), vp.h) ?? 0
    const w = parseLength(r.getAttribute('width'), vp.w) ?? 0
    const h = parseLength(r.getAttribute('height'), vp.h) ?? 0
    // The clip lives in the element's user space: measure the element there.
    const content = this.userSpaceBounds(el)
    if (content === undefined) return false
    if (content === null) return true
    const eps = 1e-6 * Math.max(1, w, h)
    return (
      content.x >= x - eps &&
      content.y >= y - eps &&
      content.x + content.w <= x + w + eps &&
      content.y + content.h <= y + h + eps
    )
  }

  /**
   * Geometric bounds of an element in its own user space (for clip containment tests), null
   * when it draws nothing, undefined when it cannot be measured simply (`<use>`, nested `<svg>`).
   */
  private userSpaceBounds(el: Element): Box | null | undefined {
    const acc = new BoundsAccumulator()
    let measurable = true
    const visit = (node: Element, m: Matrix2D, depth: number) => {
      const tag = node.localName
      if (!measurable || depth > 64 || NON_RENDERING.has(tag)) return
      if (
        tag === 'use' ||
        tag === 'svg' ||
        tag === 'text' ||
        tag === 'image' ||
        tag === 'foreignObject'
      ) {
        measurable = false
        return
      }
      if (SHAPES.has(tag)) {
        for (const sp of this.geometry(node, tag, this.rootVp, true).subpaths)
          acc.addBox(pathBounds(subpathToBezier(sp), m))
        return
      }
      for (const child of Array.from(node.children)) {
        visit(
          child,
          multiplyMatrices(m, parseTransform(child.getAttribute('transform')) ?? IDENTITY_MATRIX),
          depth + 1,
        )
      }
    }
    if (SHAPES.has(el.localName)) visit(el, IDENTITY_MATRIX, 0)
    else
      for (const child of Array.from(el.children))
        visit(child, parseTransform(child.getAttribute('transform')) ?? IDENTITY_MATRIX, 1)
    return measurable ? acc.toBox() : undefined
  }

  /** Nested `<svg>` (or an `<svg>` instantiated by `<use>`): a new viewport. */
  private nestedSvg(
    el: Element,
    sizeFrom: Element,
    style: ComputedStyle,
    ctm: Matrix2D,
    state: State,
    counters: Map<string, number>,
  ): ShapeItem | null {
    const vp = state.vp
    const x = parseLength(el.getAttribute('x'), vp.w) ?? 0
    const y = parseLength(el.getAttribute('y'), vp.h) ?? 0
    const w =
      parseLength(sizeFrom.getAttribute('width'), vp.w) ??
      parseLength(el.getAttribute('width'), vp.w) ??
      vp.w
    const h =
      parseLength(sizeFrom.getAttribute('height'), vp.h) ??
      parseLength(el.getAttribute('height'), vp.h) ??
      vp.h
    if (!(w > 0) || !(h > 0)) return null
    const vb = parseViewBox(el.getAttribute('viewBox'))
    const inner = vb
      ? viewBoxTransform(vb, el.getAttribute('preserveAspectRatio'), w, h)
      : IDENTITY_MATRIX
    const items = this.renderChildren(el, {
      ...state,
      ctm: composeMatrices(ctm, translationMatrix(x, y), inner),
      style,
      vp: vb ? { w: vb[2], h: vb[3] } : { w, h },
    })
    this.checkOverflow(el, style, items, transformBox({ x, y, w, h }, ctm))
    return items.length > 0
      ? makeGroup(this.name(el, counters), items, style.opacity, style.blendMode)
      : null
  }

  /**
   * Nested viewports clip their content unless `overflow: visible`; Lottie shape groups cannot
   * clip, so content spilling out is imported whole — say so.
   */
  checkOverflow(el: Element, style: ComputedStyle, items: ShapeItem[], viewport: Box): void {
    if (style.overflowVisible || items.length === 0) return
    // Geometry only: stroke fringes at the edge are common and the stroke reach is conservative.
    const content = shapeItemsBounds(items, 0)
    if (!content) return
    const tol = 0.01 * Math.max(viewport.w, viewport.h)
    const outside =
      content.x < viewport.x - tol ||
      content.y < viewport.y - tol ||
      content.x + content.w > viewport.x + viewport.w + tol ||
      content.y + content.h > viewport.y + viewport.h + tol
    if (outside) {
      this.warn(
        'clip-path',
        el,
        'Content outside the viewport is not clipped (Lottie shapes cannot clip).',
      )
    }
  }

  private use(
    el: Element,
    style: ComputedStyle,
    ctm: Matrix2D,
    state: State,
    counters: Map<string, number>,
  ): ShapeItem | null {
    const id = localRef(el)
    const target = id ? this.lookup(id) : null
    if (!target) {
      this.warn('use', el, 'A <use> element references a missing or external element.')
      return null
    }
    if (
      state.refs.includes(target) ||
      state.refs.length >= 32 ||
      target === el ||
      target.contains(el)
    ) {
      this.warn('use', el, 'A <use> element creates a circular reference.')
      return null
    }
    const vp = state.vp
    const x = parseLength(el.getAttribute('x'), vp.w) ?? 0
    const y = parseLength(el.getAttribute('y'), vp.h) ?? 0
    const at = multiplyMatrices(ctm, translationMatrix(x, y))
    const refs = [...state.refs, target]
    let item: ShapeItem | null = null
    if (target.localName === 'symbol') {
      const symbolStyle = computeStyle(target, style, this.sheets, diagonal(vp))
      const vb = parseViewBox(target.getAttribute('viewBox'))
      const w =
        parseLength(el.getAttribute('width'), vp.w) ??
        parseLength(target.getAttribute('width'), vp.w) ??
        (vb ? vb[2] : vp.w)
      const h =
        parseLength(el.getAttribute('height'), vp.h) ??
        parseLength(target.getAttribute('height'), vp.h) ??
        (vb ? vb[3] : vp.h)
      if (!(w > 0) || !(h > 0) || !symbolStyle.display) return null
      const inner = vb
        ? viewBoxTransform(vb, target.getAttribute('preserveAspectRatio'), w, h)
        : IDENTITY_MATRIX
      const items = this.renderChildren(target, {
        ctm: multiplyMatrices(at, inner),
        style: symbolStyle,
        vp: vb ? { w: vb[2], h: vb[3] } : { w, h },
        refs,
      })
      if (items.length === 0) return null
      this.checkOverflow(el, symbolStyle, items, transformBox({ x: 0, y: 0, w, h }, at))
      return makeGroup(
        this.name(el, counters, 'symbol', target),
        items,
        style.opacity * symbolStyle.opacity,
        style.blendMode,
      )
    }
    if (target.localName === 'svg') {
      const symbolStyle = computeStyle(target, style, this.sheets, diagonal(vp))
      if (!symbolStyle.display) return null
      item = this.nestedSvg(target, el, symbolStyle, at, { ...state, refs }, new Map())
    } else {
      item = this.render(target, { ctm: at, style, vp, refs }, counters)
    }
    if (!item) return null
    const named = !!(
      el.getAttribute('id') ||
      el.getAttribute('data-name') ||
      el.getAttributeNS(INKSCAPE_NS, 'label')
    )
    if (!named && style.opacity >= 1 && !style.blendMode) return item
    return makeGroup(this.name(el, counters), [item], style.opacity, style.blendMode)
  }

  /* ------------------------------- Geometry ------------------------------ */

  /**
   * Subpaths of a basic shape in its user space; `rect` also reports its parameters so an
   * axis-aligned rectangle can become an editable `rc`.
   */
  geometry(
    el: Element,
    tag: string,
    vp: Viewport,
    quiet = false,
  ): {
    subpaths: AbsSubpath[]
    rect?: { x: number; y: number; w: number; h: number; rx: number; ry: number }
  } {
    const len = (name: string, base: number) => parseLength(el.getAttribute(name), base)
    const diag = diagonal(vp)
    switch (tag) {
      case 'path': {
        const parsed = parsePathData(el.getAttribute('d'))
        if (parsed.error && !quiet)
          this.warn(
            'path-data',
            el,
            'Path data is malformed; the part before the error is imported.',
          )
        return { subpaths: parsed.subpaths }
      }
      case 'rect': {
        const x = len('x', vp.w) ?? 0
        const y = len('y', vp.h) ?? 0
        const w = len('width', vp.w) ?? 0
        const h = len('height', vp.h) ?? 0
        if (!(w > 0) || !(h > 0)) return { subpaths: [] }
        let rx = len('rx', vp.w)
        let ry = len('ry', vp.h)
        if (rx !== null && rx < 0) rx = null
        if (ry !== null && ry < 0) ry = null
        // "auto": a missing radius takes the other one's value.
        const rxv = Math.min(w / 2, rx ?? ry ?? 0)
        const ryv = Math.min(h / 2, ry ?? rx ?? 0)
        return {
          subpaths: [rectSubpath(x, y, w, h, rxv, ryv)],
          rect: { x, y, w, h, rx: rxv, ry: ryv },
        }
      }
      case 'circle': {
        const r = len('r', diag) ?? 0
        if (!(r > 0)) return { subpaths: [] }
        return { subpaths: [ellipseSubpath(len('cx', vp.w) ?? 0, len('cy', vp.h) ?? 0, r, r)] }
      }
      case 'ellipse': {
        let rx = len('rx', vp.w)
        let ry = len('ry', vp.h)
        if (rx === null || rx < 0) rx = ry
        if (ry === null || ry < 0) ry = rx
        if (!rx || !ry || !(rx > 0) || !(ry > 0)) return { subpaths: [] }
        return { subpaths: [ellipseSubpath(len('cx', vp.w) ?? 0, len('cy', vp.h) ?? 0, rx, ry)] }
      }
      case 'line': {
        const b = new PathBuilder()
        b.moveTo(len('x1', vp.w) ?? 0, len('y1', vp.h) ?? 0)
        b.lineTo(len('x2', vp.w) ?? 0, len('y2', vp.h) ?? 0)
        return { subpaths: b.result() }
      }
      case 'polyline':
      case 'polygon': {
        const nums = parseNumberList(el.getAttribute('points'))
        const b = new PathBuilder()
        for (let k = 0; k + 1 < nums.length; k += 2) {
          if (k === 0) b.moveTo(nums[0], nums[1])
          else b.lineTo(nums[k], nums[k + 1])
        }
        if (tag === 'polygon') b.close()
        return { subpaths: b.result() }
      }
      default:
        return { subpaths: [] }
    }
  }

  private drawable(
    el: Element,
    tag: string,
    style: ComputedStyle,
    ctm: Matrix2D,
    vp: Viewport,
    counters: Map<string, number>,
  ): ShapeItem | null {
    // Shapes are leaves for rendering, but may carry SMIL animation children.
    for (const child of Array.from(el.children)) {
      if (ANIMATION.has(child.localName))
        this.warn('animation', child, 'SVG animation is ignored; the static image is imported.')
    }
    if (!style.visible) return null
    const geo = this.geometry(el, tag, vp)
    if (geo.subpaths.length === 0) return null
    const bboxAcc = new BoundsAccumulator()
    for (const sp of geo.subpaths) bboxAcc.addBox(pathBounds(subpathToBezier(sp)))
    const bbox = bboxAcc.toBox()

    const fill =
      tag === 'line' ? null : this.paintItem('fill', style.fill, style, el, bbox, ctm, vp)
    const stroke =
      style.strokeWidth > 0
        ? this.paintItem('stroke', style.stroke, style, el, bbox, ctm, vp)
        : null
    if (!fill && !stroke) return null
    if (style.markers && tag !== 'rect' && tag !== 'circle' && tag !== 'ellipse') {
      this.warn('marker', el, 'Markers (arrow heads, dots) are not imported.')
    }

    // An `rc` starts at a different corner than SVG's rect path: keep a path when dashes show it.
    const dashed = !!stroke && !!style.dashArray
    const geometry = (m: Matrix2D): ShapeItem[] => {
      const r = geo.rect
      const axisAligned = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9
      if (
        r &&
        axisAligned &&
        !dashed &&
        Math.abs(r.rx * Math.abs(m[0]) - r.ry * Math.abs(m[3])) < 1e-6 * Math.max(1, r.w, r.h)
      ) {
        const cx = m[0] * (r.x + r.w / 2) + m[4]
        const cy = m[3] * (r.y + r.h / 2) + m[5]
        const size: [number, number] = [r.w * Math.abs(m[0]), r.h * Math.abs(m[3])]
        return [makeRect([cx, cy], size, r.rx * Math.abs(m[0]), 'Rectangle Path 1')]
      }
      return geo.subpaths.map((sp, n) => makePath(subpathToBezier(sp, m), `Path ${n + 1}`))
    }
    const name = this.name(el, counters)
    const toSpace = fill?.space ? invertMatrix(fill.space) : null
    if (fill?.space && toSpace) {
      // Elliptical radial gradient: the fill lives in a group carrying the gradient's own
      // transform (circular there, exact after it); the stroke keeps a uniform width outside.
      const fillGroup = makeGroup(
        'Fill',
        [...geometry(multiplyMatrices(toSpace, ctm)), fill.item],
        1,
        0,
        fill.space,
      )
      const parts: ShapeItem[] = [fillGroup]
      if (stroke) {
        const strokeGroup = makeGroup('Stroke', [...geometry(ctm), stroke.item])
        parts.splice(style.strokeFirst ? 1 : 0, 0, strokeGroup)
      }
      return makeGroup(name, parts, style.opacity, style.blendMode)
    }
    // The first style item in a Lottie group paints on top: the stroke, unless paint-order says otherwise.
    const styles = [stroke?.item, fill?.item].filter((s): s is ShapeItem => !!s)
    if (style.strokeFirst) styles.reverse()
    return makeGroup(name, [...geometry(ctm), ...styles], style.opacity, style.blendMode)
  }

  private strokeStyle(style: ComputedStyle, ctm: Matrix2D, el: Element): StrokeStyle {
    const [big, small] = matrixSingularValues(ctm)
    let k = 1
    if (!style.nonScalingStroke) {
      k = Math.sqrt(big * small)
      if (small > 0 && big / small > 1.01) {
        this.warn(
          'stroke',
          el,
          'A stroke under non-uniform scaling is approximated with a uniform width.',
        )
      }
    }
    return {
      width: style.strokeWidth * k,
      cap: style.lineCap,
      join: style.lineJoin,
      miterLimit: style.miterLimit,
      dashes: style.dashArray ? style.dashArray.map((d) => d * k) : null,
      dashOffset: style.dashOffset * k,
    }
  }

  private paintItem(
    kind: 'fill' | 'stroke',
    paint: Paint,
    style: ComputedStyle,
    el: Element,
    bbox: Box | null,
    ctm: Matrix2D,
    vp: Viewport,
  ): { item: ShapeItem; space?: Matrix2D } | null {
    let p = paint
    const evenOdd = style.fillRule === 'evenodd'
    const opacity = kind === 'fill' ? style.fillOpacity : style.strokeOpacity
    if (p.kind === 'url') {
      const target = p.id ? this.lookup(p.id) : null
      if (target && isGradientElement(target)) {
        const g = this.gradient(target)
        // Fills can live in a transformed sub-group, so elliptical radial fills stay exact.
        const lg = g ? gradientToLottie(g, bbox, ctm, vp, { ownSpace: kind === 'fill' }) : null
        if (!lg) return null
        if (lg.kind === 'gradient') {
          if (lg.approximate)
            this.warn(
              'gradient',
              target,
              'A gradient was approximated (elliptical radial stroke, focal radius or repeat).',
            )
          if (kind === 'stroke') {
            return { item: makeGradientStroke(lg, opacity, this.strokeStyle(style, ctm, el)) }
          }
          const item = makeGradientFill(lg, opacity, evenOdd)
          return lg.space ? { item, space: lg.space } : { item }
        }
        p = { kind: 'color', color: lg.color }
      } else {
        if (target?.localName === 'pattern')
          this.warn(
            'pattern',
            target,
            'Pattern fills are not supported; the fallback color is used.',
          )
        else if (target)
          this.warn('unsupported', target, `Paint server <${target.localName}> is not supported.`)
        p = p.fallback ?? { kind: 'none' }
      }
    }
    const color = paintColor(p, style)
    if (!color) return null
    return {
      item:
        kind === 'fill'
          ? makeFill(color, opacity, evenOdd)
          : makeStroke(color, opacity, this.strokeStyle(style, ctm, el)),
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/** Human name of an element: Inkscape label, Illustrator `data-name`, `<title>` or `id`. */
function labelOf(el: Element): string | null {
  const label =
    el.getAttributeNS(INKSCAPE_NS, 'label') ??
    el.getAttribute('inkscape:label') ??
    el.getAttribute('data-name') ??
    titleOf(el) ??
    el.getAttribute('id')
  return label && label.trim() ? label.trim() : null
}

/** `<title>` child text, used as a readable name. */
function titleOf(el: Element): string | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === 'title') return child.textContent?.trim() || null
  }
  return null
}

/** Conditional processing attributes (we support no extensions; languages are accepted). */
function conditionsPass(el: Element): boolean {
  const ext = el.getAttribute('requiredExtensions')
  if (ext !== null) return false
  const lang = el.getAttribute('systemLanguage')
  return lang === null || lang.trim() !== ''
}

/** The rect outline per SVG 2 (starts at the top edge, clockwise), with elliptical corners. */
function rectSubpath(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): AbsSubpath {
  const b = new PathBuilder()
  if (rx > 0 && ry > 0) {
    b.moveTo(x + rx, y)
    b.lineTo(x + w - rx, y)
    arcTo(b, x + w - rx, y, rx, ry, 0, false, true, x + w, y + ry)
    b.lineTo(x + w, y + h - ry)
    arcTo(b, x + w, y + h - ry, rx, ry, 0, false, true, x + w - rx, y + h)
    b.lineTo(x + rx, y + h)
    arcTo(b, x + rx, y + h, rx, ry, 0, false, true, x, y + h - ry)
    b.lineTo(x, y + ry)
    arcTo(b, x, y + ry, rx, ry, 0, false, true, x + rx, y)
  } else {
    b.moveTo(x, y)
    b.lineTo(x + w, y)
    b.lineTo(x + w, y + h)
    b.lineTo(x, y + h)
  }
  b.close()
  return dedupe(b.result()[0])
}

/** Removes zero-length straight segments (e.g. between full-size rounded corners). */
function dedupe(sp: AbsSubpath): AbsSubpath {
  const out: AbsSubpath = { closed: sp.closed, vertices: [] }
  for (const v of sp.vertices) {
    const prev = out.vertices[out.vertices.length - 1]
    const straight =
      prev && prev.ox === prev.x && prev.oy === prev.y && v.ix === v.x && v.iy === v.y
    if (prev && straight && prev.x === v.x && prev.y === v.y) {
      prev.ox = v.ox
      prev.oy = v.oy
      continue
    }
    out.vertices.push(v)
  }
  return out
}

/** Ellipse outline per SVG 2: starts at (cx + rx, cy), clockwise, four cubic quarter arcs. */
function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): AbsSubpath {
  const b = new PathBuilder()
  b.moveTo(cx + rx, cy)
  arcTo(b, cx + rx, cy, rx, ry, 0, false, true, cx, cy + ry)
  arcTo(b, cx, cy + ry, rx, ry, 0, false, true, cx - rx, cy)
  arcTo(b, cx - rx, cy, rx, ry, 0, false, true, cx, cy - ry)
  arcTo(b, cx, cy - ry, rx, ry, 0, false, true, cx + rx, cy)
  b.close()
  return b.result()[0]
}

function rootName(root: Element): string | null {
  return titleOf(root) ?? root.getAttribute('data-name') ?? null
}

/* -------------------------------------------------------------------------- */
/*                                  Public API                                */
/* -------------------------------------------------------------------------- */

/**
 * Converts SVG markup into Lottie shape items (one root group), ready to be inserted into a
 * shape layer or passed to `replaceWithShapes`. Throws `SvgImportError` when the markup is
 * not an SVG or contains nothing convertible (`error.warnings` then says why, e.g. text only).
 */
export function importSvg(svgText: string, opts: SvgImportOptions = {}): SvgImportResult {
  const root = parseDocument(svgText)
  const vb = parseViewBox(root.getAttribute('viewBox'))
  const width = parseLength(root.getAttribute('width'))
  const height = parseLength(root.getAttribute('height'))
  const artboard: Viewport | null = vb
    ? { w: vb[2], h: vb[3] }
    : width !== null && width > 0 && height !== null && height > 0
      ? { w: width, h: height }
      : null
  // Percentages need a viewport even when the SVG does not declare one (CSS default 300 × 150).
  const vp = artboard ?? {
    w: width && width > 0 ? width : 300,
    h: height && height > 0 ? height : 150,
  }
  const importer = new Importer(root, vp)
  const rootStyle = computeStyle(root, INITIAL_STYLE, importer.sheets, diagonal(vp))
  const state: State = {
    ctm: vb ? translationMatrix(-vb[0], -vb[1]) : IDENTITY_MATRIX,
    style: rootStyle,
    vp,
    refs: [],
  }
  // Coordinates keep 3 decimals, more when the SVG is drawn in tiny units.
  const digits = geometryDecimals(Math.max(vp.w, vp.h))
  const items = withGeometryDecimals(digits, () =>
    rootStyle.display ? importer.renderChildren(root, state) : [],
  )
  for (const selector of importer.sheets.invalidSelectors) {
    importer.warn('css', null, `CSS selector "${selector}" is not supported.`)
  }
  if (items.length === 0) {
    const warnings = [...importer.warnings.values()]
    throw new SvgImportError('empty', 'The SVG contains no shapes that can be imported.', warnings)
  }
  if (artboard) {
    importer.checkOverflow(root, rootStyle, items, { x: 0, y: 0, w: artboard.w, h: artboard.h })
  }
  const name = opts.name?.trim() || rootName(root) || 'SVG'
  const group = withGeometryDecimals(digits, () =>
    makeGroup(name, items, rootStyle.opacity, rootStyle.blendMode),
  )
  const bounds = shapeItemsBounds([group], 0, { includeStroke: true }) ?? { x: 0, y: 0, w: 0, h: 0 }
  const size = artboard ?? {
    w: Math.max(0, bounds.x + bounds.w),
    h: Math.max(0, bounds.y + bounds.h),
  }
  return {
    shapes: [group],
    width: size.w,
    height: size.h,
    viewBox: vb ?? [0, 0, size.w, size.h],
    bounds,
    warnings: [...importer.warnings.values()],
  }
}
