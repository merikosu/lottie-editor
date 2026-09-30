// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyMatrix, pathBounds, shapeContentMatrix, shapeItemsBounds } from '../bounds'
import { importSvg, SvgImportError, type SvgImportResult } from '../svg'
import type {
  FillShape,
  GradientFillShape,
  GradientStrokeShape,
  GroupShape,
  PathShape,
  RectShape,
  ShapeItem,
  StrokeShape,
} from '../types'
import {
  asGroup,
  findItems,
  fixture,
  groupsWithoutTransform,
  maxDecimals,
  samplePath,
} from './fixtures/remix/helpers'

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`

/** Items of the root group without its transform. */
function content(r: SvgImportResult): ShapeItem[] {
  const root = asGroup(r.shapes[0])
  return root.it.slice(0, -1)
}

/** The single drawable group of a one-element SVG. */
function only(body: string, attrs?: string): GroupShape {
  const items = content(importSvg(svg(body, attrs)))
  expect(items).toHaveLength(1)
  return asGroup(items[0])
}

const fillOf = (g: GroupShape) => g.it.find((i): i is FillShape => i.ty === 'fl')
const strokeOf = (g: GroupShape) => g.it.find((i): i is StrokeShape => i.ty === 'st')
const pathsOf = (g: GroupShape) => g.it.filter((i): i is PathShape => i.ty === 'sh')
const hex = (c: number[]) =>
  '#' +
  c
    .slice(0, 3)
    .map((v) =>
      Math.floor(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
const opacity = (s: { o: { k: unknown } }) => s.o.k as number

/** Fill color of a one-element SVG. */
const fillFor = (body: string) => hex(fillOf(only(body))!.c.k as number[])
/** Fill color of the element inside the first top-level group. */
const nestedFillFor = (body: string) =>
  hex(fillOf(asGroup(asGroup(content(importSvg(svg(body)))[0]).it[0]))!.c.k as number[])
/** The element group inside the first top-level group. */
const inner = (body: string) => asGroup(asGroup(content(importSvg(svg(body)))[0]).it[0])
const gradientFill = (r: SvgImportResult) => findItems(r.shapes, 'gf')[0] as GradientFillShape

/** Error code of an import (or "ok"). */
function errorCode(text: string): string {
  try {
    importSvg(text)
    return 'ok'
  } catch (e) {
    return e instanceof SvgImportError ? e.code : 'other'
  }
}

describe('importSvg: structure', () => {
  it('wraps content in one root group named after the option, <title> or "SVG"', () => {
    expect(importSvg(svg('<rect width="10" height="10"/>')).shapes[0].nm).toBe('SVG')
    expect(
      importSvg(svg('<title>Acme logo</title><rect width="10" height="10"/>')).shapes[0].nm,
    ).toBe('Acme logo')
    expect(
      importSvg(svg('<rect width="10" height="10"/>'), { name: 'logo.svg' }).shapes[0].nm,
    ).toBe('logo.svg')
  })

  it('turns an element into a group of geometry, stroke, fill and an identity transform', () => {
    const g = only('<path d="M0 0H10V10Z" fill="red" stroke="blue"/>')
    expect(g.it.map((i) => i.ty)).toEqual(['sh', 'st', 'fl', 'tr'])
    const tr = g.it[3]
    expect(tr).toMatchObject({
      ty: 'tr',
      p: { k: [0, 0] },
      a: { k: [0, 0] },
      s: { k: [100, 100] },
      r: { k: 0 },
      o: { k: 100 },
    })
  })

  it('reverses sibling order (the last SVG element is the first Lottie item)', () => {
    const items = content(
      importSvg(
        svg('<rect id="bottom" width="10" height="10"/><rect id="top" width="5" height="5"/>'),
      ),
    )
    expect(items.map((i) => i.nm)).toEqual(['top', 'bottom'])
  })

  it('names elements from inkscape:label, data-name, <title>, id, else by type and number', () => {
    const r = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10">
        <rect width="1" height="1"/><rect width="1" height="1"/><circle r="1"/>
        <path id="p1" d="M0 0H1V1Z"/><path data-name="Leaf shape" id="leaf" d="M0 0H1V1Z"/>
        <g inkscape:label="Layer A" id="layer1"><path d="M0 0H1V1Z"/></g>
        <path d="M0 0H1V1Z"><title>Titled</title></path>
      </svg>`,
    )
    expect(
      content(r)
        .map((i) => i.nm)
        .reverse(),
    ).toEqual(['Rectangle 1', 'Rectangle 2', 'Circle 1', 'p1', 'Leaf shape', 'Layer A', 'Titled'])
  })

  it('nests <g> as groups and keeps every group transform identity (geometry is flattened)', () => {
    const r = importSvg(
      svg(
        '<g transform="translate(10,10)"><g transform="scale(2)"><rect width="10" height="10"/></g></g>',
      ),
    )
    const outer = asGroup(content(r)[0])
    const middle = asGroup(outer.it[0])
    const rectGroup = asGroup(middle.it[0])
    const rc = rectGroup.it[0] as RectShape
    expect(rc.ty).toBe('rc')
    expect(rc.p.k).toEqual([20, 20])
    expect(rc.s.k).toEqual([20, 20])
    for (const g of [outer, middle, rectGroup])
      expect((g.it[g.it.length - 1] as { p: { k: number[] } }).p.k).toEqual([0, 0])
    expect(groupsWithoutTransform(r.shapes)).toEqual([])
  })

  it('drops empty groups and invisible elements', () => {
    const r = importSvg(
      svg(
        '<g></g><g><rect width="0" height="5"/></g><rect width="5" height="5" fill="none"/><rect width="5" height="5"/>',
      ),
    )
    expect(content(r)).toHaveLength(1)
  })
})

describe('importSvg: geometry', () => {
  it('emits an editable rc for axis-aligned rectangles', () => {
    const g = only('<rect x="10" y="20" width="30" height="40" rx="5"/>')
    expect(g.it[0]).toMatchObject({ ty: 'rc', p: { k: [25, 40] }, s: { k: [30, 40] }, r: { k: 5 } })
  })

  it('uses ry = rx when only one radius is given and clamps radii to half the size', () => {
    const g = only('<rect width="10" height="40" ry="30"/>')
    // rx auto = ry = 30 → clamped to 5 (w/2); ry clamped to 20 (h/2): unequal → path with elliptical corners.
    expect(g.it[0].ty).toBe('sh')
    const b = pathBounds((g.it[0] as PathShape).ks.k as never)!
    expect(b.x).toBeCloseTo(0, 9)
    expect(b.y).toBeCloseTo(0, 9)
    expect(b.w).toBeCloseTo(10, 9)
    expect(b.h).toBeCloseTo(40, 9)
  })

  it('converts rotated rectangles to exact paths', () => {
    const g = only('<rect x="-5" y="-5" width="10" height="10" transform="rotate(45)"/>')
    const p = (g.it[0] as PathShape).ks.k as unknown as { v: number[][] }
    expect(g.it[0].ty).toBe('sh')
    const d = 5 * Math.SQRT2
    const xs = p.v.map((v) => v[0])
    expect(Math.max(...xs)).toBeCloseTo(d, 2)
    expect(Math.min(...xs)).toBeCloseTo(-d, 2)
  })

  it('draws circles and ellipses with four cubic arcs (exact extremes, tiny radial error)', () => {
    const c = only('<circle cx="50" cy="40" r="30"/>')
    const path = (c.it[0] as PathShape).ks.k as unknown as {
      v: number[][]
      i: number[][]
      o: number[][]
      c: boolean
    }
    expect(path.v).toHaveLength(4)
    expect(path.c).toBe(true)
    expect(path.v[0]).toEqual([80, 40])
    const err = Math.max(
      ...samplePath(path).map(([x, y]) => Math.abs(Math.hypot(x - 50, y - 40) - 30)),
    )
    expect(err).toBeLessThan(0.01)
    expect(pathBounds(path)).toEqual({ x: 20, y: 10, w: 60, h: 60 })
    const e = only('<ellipse cx="0" cy="0" rx="20" ry="10"/>')
    expect(pathBounds((e.it[0] as PathShape).ks.k as never)).toEqual({
      x: -20,
      y: -10,
      w: 40,
      h: 20,
    })
  })

  it('never fills lines; polylines stay open, polygons close', () => {
    const line = only('<line x1="0" y1="0" x2="10" y2="10" stroke="black" fill="red"/>')
    expect(line.it.map((i) => i.ty)).toEqual(['sh', 'st', 'tr'])
    const pl = only('<polyline points="0,0 10,0 10,10" fill="red"/>')
    expect(((pl.it[0] as PathShape).ks.k as { c: boolean }).c).toBe(false)
    const pg = only('<polygon points="0 0 10 0 10 10 5" fill="red"/>')
    const k = (pg.it[0] as PathShape).ks.k as { c: boolean; v: number[][] }
    expect(k.c).toBe(true)
    expect(k.v).toHaveLength(3)
  })

  it('emits one sh per subpath inside the element group', () => {
    const g = only('<path d="M0 0H10V10H0Z M2 2H8V8H2Z" fill-rule="evenodd"/>')
    expect(pathsOf(g)).toHaveLength(2)
    expect(fillOf(g)!.r).toBe(2)
  })

  it('resolves percentage and unit lengths against the viewport', () => {
    const g = only('<rect width="50%" height="50%"/>', 'viewBox="0 0 200 100"')
    expect(g.it[0]).toMatchObject({ s: { k: [100, 50] } })
    const r = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="0.5in"><rect width="100%" height="1in"/></svg>',
    )
    expect(r.width).toBe(96)
    expect(r.height).toBe(48)
    expect(content(r)[0]).toMatchObject({ it: [{ s: { k: [96, 96] } }, {}, {}] })
  })

  it('keeps more decimals for SVGs drawn in tiny units', () => {
    const r = importSvg(
      svg(
        '<path d="M0.12345 0.5 L0.98765 0.25" stroke="#000" stroke-width="0.01234"/>',
        'viewBox="0 0 1 1"',
      ),
    )
    const sh = findItems(r.shapes, 'sh')[0]
    const v = (sh.ks.k as { v: number[][] }).v
    expect(v[0][0]).toBe(0.1235)
    expect(v[1][0]).toBe(0.9877)
    expect(findItems(r.shapes, 'st')[0].w.k).toBe(0.0123)
  })

  it('rounds every coordinate to 3 decimals', () => {
    const r = importSvg(
      svg(
        '<path d="M0.123456 1.987654 C 3.333333 4.444444 5.555555 6.666666 7.777777 8.888888" stroke="#000"/>',
      ),
    )
    const sh = findItems(r.shapes, 'sh')[0]
    expect(maxDecimals(sh.ks.k)).toBeLessThanOrEqual(3)
  })
})

describe('importSvg: viewBox and viewports', () => {
  it('outputs viewBox units with the origin at the viewBox top-left', () => {
    const r = importSvg(
      svg(
        '<rect x="10" y="20" width="100" height="50"/>',
        'viewBox="10 20 100 50" width="400" height="200"',
      ),
    )
    expect(r.viewBox).toEqual([10, 20, 100, 50])
    expect(r.width).toBe(100)
    expect(r.height).toBe(50)
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 100, h: 50 })
  })

  it('falls back to width/height, then to the content bounds, without a viewBox', () => {
    const r = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="10" height="10"/></svg>',
    )
    expect(r.viewBox).toEqual([0, 0, 30, 20])
    const n = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="10" height="20"/></svg>',
    )
    expect(n.width).toBe(15)
    expect(n.height).toBe(25)
  })

  it('maps nested <svg> viewports with preserveAspectRatio', () => {
    // 10×10 viewBox into a 40×20 viewport: meet → scale 2, centered (xMid) → x offset 10.
    const g = content(
      importSvg(
        svg(
          '<svg x="0" y="0" width="40" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        ),
      ),
    )
    const rect = asGroup(asGroup(g[0]).it[0]).it[0]
    expect(rect).toMatchObject({ ty: 'rc', p: { k: [20, 10] }, s: { k: [20, 20] } })
    const none = content(
      importSvg(
        svg(
          '<svg width="40" height="20" viewBox="0 0 10 10" preserveAspectRatio="none"><rect width="10" height="10"/></svg>',
        ),
      ),
    )
    expect(asGroup(asGroup(none[0]).it[0]).it[0]).toMatchObject({
      p: { k: [20, 10] },
      s: { k: [40, 20] },
    })
    const slice = content(
      importSvg(
        svg(
          '<svg width="40" height="20" viewBox="0 0 10 10" preserveAspectRatio="xMinYMin slice"><rect width="10" height="10"/></svg>',
        ),
      ),
    )
    expect(asGroup(asGroup(slice[0]).it[0]).it[0]).toMatchObject({
      p: { k: [20, 20] },
      s: { k: [40, 40] },
    })
  })
})

describe('importSvg: paint and styles', () => {
  it('defaults to a black fill and no stroke', () => {
    const g = only('<rect width="10" height="10"/>')
    expect(fillOf(g)!.c.k).toEqual([0, 0, 0, 1])
    expect(strokeOf(g)).toBeUndefined()
  })

  it('stores colors so lottie-web floors them back to the exact 8-bit values', () => {
    const g = only('<rect width="10" height="10" fill="#0A98FD"/>')
    expect(hex(fillOf(g)!.c.k as number[])).toBe('#0a98fd')
    for (let n = 0; n < 256; n++) {
      const h = n.toString(16).padStart(2, '0')
      const c = fillOf(only(`<rect width="1" height="1" fill="#${h}${h}${h}"/>`))!.c.k as number[]
      expect(Math.floor(c[0] * 255)).toBe(n)
      expect(Math.round(c[0] * 255)).toBe(n)
    }
  })

  it('applies Illustrator-style CSS classes', () => {
    const r = importSvg(
      svg(`<style>.st0{fill:#FF0000;}.st1{fill:none;stroke:#00FF00;stroke-width:2;}</style>
        <rect class="st0" width="10" height="10"/><rect class="st1" width="10" height="10"/>`),
    )
    const [b, a] = content(r).map(asGroup)
    expect(hex(fillOf(a)!.c.k as number[])).toBe('#ff0000')
    expect(fillOf(b)).toBeUndefined()
    expect(hex(strokeOf(b)!.c.k as number[])).toBe('#00ff00')
    expect(strokeOf(b)!.w.k).toBe(2)
  })

  it('follows the cascade: attribute < class < id < inline < !important', () => {
    const css =
      '<style>.c{fill:#ff0000} #x{fill:#0000ff} .imp{fill:#00ff00 !important} rect{fill:#111111}</style>'
    expect(fillFor(`${css}<rect class="c" fill="#ffffff" width="1" height="1"/>`)).toBe('#ff0000')
    expect(fillFor(`${css}<rect id="x" class="c" width="1" height="1"/>`)).toBe('#0000ff')
    expect(
      fillFor(`${css}<rect id="x" class="c" style="fill:#abcdef" width="1" height="1"/>`),
    ).toBe('#abcdef')
    expect(fillFor(`${css}<rect class="imp" style="fill:#abcdef" width="1" height="1"/>`)).toBe(
      '#00ff00',
    )
    expect(
      fillFor(`${css}<rect style="fill:#abcdef !important" class="imp" width="1" height="1"/>`),
    ).toBe('#abcdef')
    expect(fillFor(`${css}<rect width="1" height="1" fill="#ffffff"/>`)).toBe('#111111')
  })

  it('supports descendant, child and multi-class selectors, and later rules win on ties', () => {
    expect(
      nestedFillFor(
        '<style>g .a{fill:#ff0000}</style><g><rect class="a" width="1" height="1"/></g>',
      ),
    ).toBe('#ff0000')
    expect(
      nestedFillFor(
        '<style>g > .a.b{fill:#00ff00}</style><g><rect class="b a" width="1" height="1"/></g>',
      ),
    ).toBe('#00ff00')
    expect(
      nestedFillFor(
        '<style>.a{fill:#ff0000}.a{fill:#0000ff}</style><g><rect class="a" width="1" height="1"/></g>',
      ),
    ).toBe('#0000ff')
  })

  it('skips invalid declarations so the next one in the cascade applies', () => {
    const g = only(
      '<style>.a{fill:#ff0000}</style><rect class="a" style="fill:bogus" width="1" height="1"/>',
    )
    expect(hex(fillOf(g)!.c.k as number[])).toBe('#ff0000')
  })

  it('inherits paint from ancestors, with inherit and currentColor', () => {
    expect(
      hex(fillOf(inner('<g fill="#ff0000"><rect width="1" height="1"/></g>'))!.c.k as number[]),
    ).toBe('#ff0000')
    expect(
      hex(
        fillOf(inner('<g style="fill:#ff0000"><rect fill="inherit" width="1" height="1"/></g>'))!.c
          .k as number[],
      ),
    ).toBe('#ff0000')
    expect(
      hex(
        fillOf(inner('<g color="#0000ff"><rect fill="currentColor" width="1" height="1"/></g>'))!.c
          .k as number[],
      ),
    ).toBe('#0000ff')
    // currentColor is resolved with the element's own color, even when inherited as a keyword.
    expect(
      hex(
        fillOf(
          inner(
            '<g fill="currentColor" color="#ff0000"><rect color="#00ff00" width="1" height="1"/></g>',
          ),
        )!.c.k as number[],
      ),
    ).toBe('#00ff00')
  })

  it('supports CSS custom properties', () => {
    const g = only(
      '<style>:root{--brand:#123456}</style><rect style="fill:var(--brand)" width="1" height="1"/>',
    )
    expect(hex(fillOf(g)!.c.k as number[])).toBe('#123456')
    const f = only('<rect style="fill:var(--nope, #654321)" width="1" height="1"/>')
    expect(hex(fillOf(f)!.c.k as number[])).toBe('#654321')
  })

  it('multiplies color alpha into fill/stroke opacity and puts element opacity on the group', () => {
    const g = only(
      '<rect width="1" height="1" fill="rgba(255,0,0,0.5)" fill-opacity="0.5" stroke="#000" stroke-opacity="25%" opacity="0.8"/>',
    )
    expect(opacity(fillOf(g)!)).toBe(25)
    expect(opacity(strokeOf(g)!)).toBe(25)
    expect((g.it[g.it.length - 1] as { o: { k: number } }).o.k).toBe(80)
    const nested = asGroup(
      content(importSvg(svg('<g opacity=".5"><rect width="1" height="1"/></g>')))[0],
    )
    expect((nested.it[nested.it.length - 1] as { o: { k: number } }).o.k).toBe(50)
  })

  it('maps stroke caps, joins, miter limit and dashes (odd lists repeat)', () => {
    const g = only(
      '<path d="M0 0H10" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="7" stroke-dasharray="1 2 3" stroke-dashoffset="4"/>',
    )
    const st = strokeOf(g)!
    expect(st.lc).toBe(2)
    expect(st.lj).toBe(3)
    expect(st.ml).toBe(7)
    expect(st.w.k).toBe(3)
    expect(st.d!.map((d) => [d.n, d.v.k])).toEqual([
      ['d', 1],
      ['g', 2],
      ['d', 3],
      ['g', 1],
      ['d', 2],
      ['g', 3],
      ['o', 4],
    ])
    const svgDefaults = strokeOf(only('<path d="M0 0H10" stroke="#000"/>'))!
    expect([svgDefaults.lc, svgDefaults.lj, svgDefaults.ml, svgDefaults.w.k]).toEqual([1, 1, 4, 1])
  })

  it('names dashes uniquely (lottie-web drops the layer on a repeated dash name)', () => {
    const st = strokeOf(only('<path d="M0 0H10" stroke="#000" stroke-dasharray="1 2 3 4 5 6"/>'))!
    expect(st.d!.map((d) => d.nm)).toEqual([
      'dash',
      'gap',
      'dash2',
      'gap2',
      'dash3',
      'gap3',
      'offset',
    ])
  })

  it('scales stroke width and dashes with transforms, warning on non-uniform scale', () => {
    const r = importSvg(
      svg(
        '<path d="M0 10H10" stroke="#000" stroke-width="2" stroke-dasharray="1 1" transform="scale(3)"/>',
      ),
    )
    const st = findItems(r.shapes, 'st')[0]
    expect(st.w.k).toBe(6)
    expect(st.d![0].v.k).toBe(3)
    expect(r.warnings).toEqual([])
    const skew = importSvg(svg('<path id="s" d="M0 10H10" stroke="#000" transform="scale(4 1)"/>'))
    expect(findItems(skew.shapes, 'st')[0].w.k).toBe(2)
    expect(skew.warnings).toMatchObject([{ code: 'stroke', id: 's' }])
    const fixed = importSvg(
      svg(
        '<path d="M0 10H10" stroke="#000" vector-effect="non-scaling-stroke" transform="scale(4 1)"/>',
      ),
    )
    expect(findItems(fixed.shapes, 'st')[0].w.k).toBe(1)
    expect(fixed.warnings).toEqual([])
  })

  it('orders stroke and fill by paint-order', () => {
    expect(only('<rect width="1" height="1" stroke="#000"/>').it.map((i) => i.ty)).toEqual([
      'rc',
      'st',
      'fl',
      'tr',
    ])
    expect(
      only('<rect width="1" height="1" stroke="#000" paint-order="stroke"/>').it.map((i) => i.ty),
    ).toEqual(['rc', 'fl', 'st', 'tr'])
    expect(
      only(
        '<rect width="1" height="1" stroke="#000" style="paint-order: markers stroke fill"/>',
      ).it.map((i) => i.ty),
    ).toEqual(['rc', 'fl', 'st', 'tr'])
  })

  it('skips display:none subtrees and invisible elements; visibility can be re-enabled', () => {
    expect(() => importSvg(svg('<g display="none"><rect width="1" height="1"/></g>'))).toThrow(
      SvgImportError,
    )
    const r = importSvg(
      svg(
        '<style>.h{display:none}</style><rect class="h" width="1" height="1"/><g visibility="hidden"><rect width="2" height="2"/><rect visibility="visible" width="3" height="3"/></g>',
      ),
    )
    const items = content(r)
    expect(items).toHaveLength(1)
    expect(asGroup(items[0]).it).toHaveLength(2)
  })

  it('maps mix-blend-mode to the group blend mode', () => {
    expect(only('<rect width="1" height="1" style="mix-blend-mode:multiply"/>').bm).toBe(1)
  })
})

describe('importSvg: gradients', () => {
  it('maps an objectBoundingBox linear gradient to output coordinates', () => {
    const r = importSvg(
      svg(
        '<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient><rect x="10" y="10" width="100" height="50" fill="url(#g)"/>',
      ),
    )
    const gf = gradientFill(r)
    expect(gf.t).toBe(1)
    expect(gf.s.k).toEqual([10, 10])
    expect(gf.e.k).toEqual([110, 10])
    expect(gf.g.p).toBe(2)
    expect(gf.g.k.k).toEqual([0, 1, 0, 0, 1, 0, 0, 1])
  })

  it('keeps linear isolines exact under non-uniform bounding boxes', () => {
    const r = importSvg(
      svg(
        '<linearGradient id="g" x2="1" y2="1"><stop offset="0"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="200" height="100" fill="url(#g)"/>',
        'viewBox="0 0 200 100"',
      ),
    )
    const gf = gradientFill(r)
    expect(gf.s.k).toEqual([0, 0])
    // The t = 1 isoline passes through (200,100) with direction (-200,100); E − S is its normal.
    expect(gf.e.k).toEqual([80, 160])
  })

  it('applies userSpaceOnUse coordinates, gradientTransform and element transforms', () => {
    const r = importSvg(
      svg(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0" gradientTransform="rotate(90)">
        <stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <rect width="10" height="10" fill="url(#g)" transform="translate(5 5)"/>`),
    )
    const gf = gradientFill(r)
    expect(gf.s.k).toEqual([5, 5])
    expect(gf.e.k).toEqual([5, 15])
  })

  it('follows href chains for stops and attributes; stop styles come from CSS; opacity stops when translucent', () => {
    const r = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
        <style>.s1{stop-color:#00ff00;stop-opacity:.5}</style>
        <linearGradient id="base"><stop offset="0" style="stop-color:#ff0000"/><stop offset="0.5" class="s1"/><stop offset="0.25" stop-color="#0000ff"/></linearGradient>
        <linearGradient id="derived" xlink:href="#base" x1="0" x2="0" y1="0" y2="1"/>
        <rect width="10" height="20" fill="url(#derived)"/>
      </svg>`,
    )
    const gf = gradientFill(r)
    expect(gf.s.k).toEqual([0, 0])
    expect(gf.e.k).toEqual([0, 20])
    expect(gf.g.p).toBe(3)
    // Offsets never decrease (0.25 after 0.5 becomes 0.5); opacity stops follow the color stops.
    const k = gf.g.k.k as number[]
    expect(k.slice(0, 12).filter((_, n) => n % 4 === 0)).toEqual([0, 0.5, 0.5])
    expect(k.slice(12)).toEqual([0, 1, 0.5, 0.5, 0.5, 1])
  })

  it('converts radial gradients with focal points', () => {
    const r = importSvg(
      svg(
        '<radialGradient id="r" cx="50" cy="50" r="40" fx="70" fy="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><circle cx="50" cy="50" r="40" fill="url(#r)"/>',
      ),
    )
    const gf = gradientFill(r)
    expect(gf.t).toBe(2)
    expect(gf.s.k).toEqual([50, 50])
    expect(gf.e.k).toEqual([90, 50])
    expect(gf.h!.k).toBe(50)
    expect(gf.a!.k).toBe(0)
    expect(r.warnings).toEqual([])
  })

  it('paints elliptical radial fills exactly in a sub-group carrying the gradient transform', () => {
    const r = importSvg(
      svg(
        '<radialGradient id="r"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><rect width="200" height="50" fill="url(#r)" stroke="#f00"/>',
        'viewBox="-5 -5 210 60"',
      ),
    )
    expect(r.warnings).toEqual([])
    const el = asGroup(content(r)[0])
    // [stroke group (identity, uniform width), fill group (gradient space), transform]
    expect(el.it.map((i) => i.nm)).toEqual(['Stroke', 'Fill', 'Transform'])
    const fillGroup = asGroup(el.it[1])
    const gf = findItems([fillGroup], 'gf')[0]
    const m = shapeContentMatrix(
      { layers: [{ ty: 4, ip: 0, op: 1, st: 0, ks: {}, shapes: [fillGroup] }] } as never,
      ['layers', 0, 'shapes', 0],
      0,
    )
    // Center → (105, 30) (viewBox origin −5); x radius → 100 (half width), y radius → 25.
    const [s0, s1] = gf.s.k as number[]
    const [e0, e1] = gf.e.k as number[]
    const radius = Math.hypot(e0 - s0, e1 - s1)
    expect(applyMatrix(m, s0, s1).map((v) => Math.round(v * 1000) / 1000)).toEqual([105, 30])
    const [xr] = applyMatrix(m, s0 + radius, s1)
    const [, yr] = applyMatrix(m, s0, s1 + radius)
    expect(xr).toBeCloseTo(205, 2)
    expect(yr).toBeCloseTo(55, 2)
    // The fill group's paths, transformed, are the rect.
    expect(shapeItemsBounds([fillGroup], 0)).toEqual({ x: 5, y: 5, w: 200, h: 50 })
    expect(groupsWithoutTransform(r.shapes)).toEqual([])
  })

  it('approximates elliptical radial gradient strokes with a warning', () => {
    const r = importSvg(
      svg(
        '<radialGradient id="r"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><rect width="200" height="50" fill="none" stroke="url(#r)" stroke-width="4"/>',
        'viewBox="-5 -5 210 60"',
      ),
    )
    const gs = findItems(r.shapes, 'gs')[0]
    expect(gs.s.k).toEqual([105, 30])
    expect((gs.e.k as number[])[0]).toBeCloseTo(105 + 0.5 * Math.sqrt(200 * 50), 2)
    expect(r.warnings).toMatchObject([{ code: 'gradient', id: 'r' }])
  })

  it('paints single-stop gradients solid and gradients without stops not at all', () => {
    const one = only(
      '<linearGradient id="g"><stop offset="0" stop-color="#abcdef" stop-opacity="0.5"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>',
    )
    expect(hex(fillOf(one)!.c.k as number[])).toBe('#abcdef')
    expect(opacity(fillOf(one)!)).toBe(50)
    expect(() =>
      importSvg(svg('<linearGradient id="g"/><rect width="1" height="1" fill="url(#g)"/>')),
    ).toThrow(SvgImportError)
  })

  it('creates gradient strokes', () => {
    const r = importSvg(
      svg(
        '<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><path d="M0 0H10V10" fill="none" stroke="url(#g)" stroke-width="2"/>',
      ),
    )
    const gs = findItems(r.shapes, 'gs')[0] as GradientStrokeShape
    expect(gs).toBeDefined()
    expect(gs.w.k).toBe(2)
    expect(gs.s.k).toEqual([0, 0])
    expect(gs.e.k).toEqual([10, 0])
  })

  it('uses the fallback color for missing paint servers and warns on spread methods', () => {
    expect(
      hex(fillOf(only('<rect width="1" height="1" fill="url(#nope) #ff0000"/>'))!.c.k as number[]),
    ).toBe('#ff0000')
    const r = importSvg(
      svg(
        '<linearGradient id="g" spreadMethod="reflect" x2="0.5"><stop offset="0"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>',
      ),
    )
    expect(r.warnings.map((w) => w.code)).toEqual(['gradient'])
  })
})

describe('importSvg: use, symbols and switch', () => {
  it('instantiates <use> with x/y, symbols with viewBox and styles inherited from the use', () => {
    const r = importSvg(fixture('use-symbol.svg'))
    const items = content(r)
    expect(items).toHaveLength(2)
    const [pair, dot] = items.map(asGroup)
    // The symbol: a 10×10 viewBox shown at 20×20 at (10,10): circle center (20,20), radius 10.
    const circle = findItems([dot], 'sh')[0]
    expect(pathBounds(circle.ks.k as never)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
    expect(hex(findItems([dot], 'fl')[0].c.k as number[])).toBe('#ff0000')
    // The pair: two triangles translated by (50,50) and (70,50), blue from the outer use.
    const tris = findItems([pair], 'sh')
    expect(tris).toHaveLength(2)
    const boxes = tris.map((t) => pathBounds(t.ks.k as never)!).sort((a, b) => a.x - b.x)
    expect(boxes).toEqual([
      { x: 50, y: 50, w: 10, h: 8 },
      { x: 70, y: 50, w: 10, h: 8 },
    ])
    for (const fl of findItems([pair], 'fl')) expect(hex(fl.c.k as number[])).toBe('#0000ff')
    expect(r.warnings).toMatchObject([{ code: 'use', element: 'use' }])
  })

  it('detects circular references', () => {
    const r = importSvg(svg('<g id="a"><use href="#a"/><rect width="1" height="1"/></g>'))
    expect(r.warnings.map((w) => w.code)).toEqual(['use'])
    const loop = importSvg(
      svg(
        '<defs><use id="x" href="#y"/><use id="y" href="#x"/></defs><use href="#x"/><rect width="1" height="1"/>',
      ),
    )
    expect(loop.warnings.some((w) => w.code === 'use')).toBe(true)
  })

  it('renders the first valid child of <switch> (Illustrator foreignObject fallback)', () => {
    const r = importSvg(fixture('logo-illustrator.svg'))
    expect(r.warnings).toEqual([])
    const names = findItems(r.shapes, 'gr').map((g) => g.nm)
    expect(names).toContain('Brand Mark')
    expect(names).toContain('Word')
  })
})

describe('importSvg: real-world exports', () => {
  it('imports an Illustrator logo (entities, classes, switch, gradient)', () => {
    const r = importSvg(fixture('logo-illustrator.svg'), { name: 'Acme' })
    expect(r.viewBox).toEqual([0, 0, 200, 100])
    expect(r.shapes[0].nm).toBe('Acme')
    // Circle: blue fill; inner path: white fill + blue 4px stroke; word: gradient rect.
    const fills = findItems(r.shapes, 'fl').map((f) => hex(f.c.k as number[]))
    expect(fills.sort()).toEqual(['#0a98fd', '#ffffff'])
    const st = findItems(r.shapes, 'st')
    expect(st).toHaveLength(1)
    expect(hex(st[0].c.k as number[])).toBe('#0a98fd')
    expect(st[0].w.k).toBe(4)
    expect(st[0].ml).toBe(10)
    const gf = findItems(r.shapes, 'gf')[0]
    expect(gf.s.k).toEqual([100, 50])
    expect(gf.e.k).toEqual([190, 50])
    expect(findItems(r.shapes, 'rc')[0]).toMatchObject({
      p: { k: [145, 50] },
      s: { k: [90, 30] },
      r: { k: 6 },
    })
    expect(r.bounds.x).toBeCloseTo(10, 6)
    expect(r.bounds.w).toBeCloseTo(180, 6)
    expect(groupsWithoutTransform(r.shapes)).toEqual([])
  })

  it('imports a Figma icon: artboard clip is harmless, even-odd holes are kept', () => {
    const r = importSvg(fixture('icon-figma.svg'))
    expect(r.warnings).toEqual([])
    expect(r.width).toBe(24)
    const ring = findItems(r.shapes, 'fl').find((f) => hex(f.c.k as number[]) === '#111827')!
    expect(ring.r).toBe(2)
    expect(findItems(r.shapes, 'sh')).toHaveLength(2)
    // The rounded 4×4 square with rx=2 is a circle-like rc.
    expect(findItems(r.shapes, 'rc')[0]).toMatchObject({
      p: { k: [12, 12] },
      s: { k: [4, 4] },
      r: { k: 2 },
    })
  })

  it('imports a stroke icon (Lucide): currentColor strokes, round caps, no fills', () => {
    const r = importSvg(fixture('icon-stroke.svg'))
    expect(findItems(r.shapes, 'fl')).toHaveLength(0)
    const strokes = findItems(r.shapes, 'st')
    expect(strokes).toHaveLength(2)
    for (const st of strokes) {
      expect(st.c.k).toEqual([0, 0, 0, 1])
      expect(st.w.k).toBe(2)
      expect(st.lc).toBe(2)
      expect(st.lj).toBe(2)
    }
    // Visual bounds include half the stroke width.
    expect(r.bounds.x).toBeCloseTo(2, 6)
    expect(r.bounds.y).toBeCloseTo(2, 6)
  })

  it('reports unsupported features with codes and element ids', () => {
    const r = importSvg(fixture('unsupported.svg'))
    const got = r.warnings.map((w) => `${w.code}:${w.id ?? w.element}`).sort()
    expect(got).toEqual(
      [
        'animation:animateTransform',
        'clip-path:clipped',
        'filter:blurred',
        'image:photo',
        'mask:masked',
        'pattern:dots',
        'text:title',
      ].sort(),
    )
    expect(r.warnings.find((w) => w.code === 'text')!.message).toMatch(/outlines/)
    // The pattern falls back to its color; the masked/filtered/clipped shapes are imported.
    expect(findItems(r.shapes, 'fl').some((f) => hex(f.c.k as number[]) === '#00ff00')).toBe(true)
    expect(content(r)).toHaveLength(5)
  })

  it('warns about markers', () => {
    const r = importSvg(
      svg(
        '<marker id="m"><path d="M0 0L1 1"/></marker><path id="arrow" d="M0 0H10" stroke="#000" marker-end="url(#m)"/>',
      ),
    )
    expect(r.warnings).toMatchObject([{ code: 'marker', id: 'arrow' }])
  })
})

describe('importSvg: viewport clipping', () => {
  it('warns when content spills out of a clipping viewport (symbol slice, root viewBox)', () => {
    const slice = importSvg(
      svg(
        '<defs><symbol id="s" viewBox="0 0 20 10" preserveAspectRatio="xMaxYMax slice"><rect width="20" height="10"/></symbol></defs><use id="u" href="#s" x="10" y="10" width="40" height="40"/>',
      ),
    )
    // The slice overflows both the use viewport and (to the left) the root viewBox.
    expect(slice.warnings.map((w) => `${w.code}:${w.id ?? w.element}`)).toEqual([
      'clip-path:u',
      'clip-path:svg',
    ])
    const root = importSvg(svg('<rect x="-20" y="10" width="50" height="50"/>'))
    expect(root.warnings).toMatchObject([{ code: 'clip-path', element: 'svg' }])
  })

  it('stays quiet for fitting content, overflow: visible and stroke fringes', () => {
    expect(importSvg(svg('<rect x="0" y="0" width="100" height="100"/>')).warnings).toEqual([])
    expect(
      importSvg(
        svg('<rect x="-20" width="50" height="50"/>', 'viewBox="0 0 100 100" overflow="visible"'),
      ).warnings,
    ).toEqual([])
    expect(
      importSvg(svg('<path d="M0 50H100" stroke="#000" stroke-width="10"/>')).warnings,
    ).toEqual([])
    const meet = importSvg(
      svg(
        '<svg x="10" y="10" width="80" height="40" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9"/></svg>',
      ),
    )
    expect(meet.warnings).toEqual([])
  })
})

describe('importSvg: robustness', () => {
  it('parses HTML-flavoured markup (entities, undeclared xlink prefix) with the lenient parser', () => {
    const r = importSvg(
      '<svg viewBox="0 0 10 10"><defs><path id="p" d="M0 0H5V5Z"/></defs><use xlink:href="#p" fill="red"/>&nbsp;</svg>',
    )
    expect(findItems(r.shapes, 'sh')).toHaveLength(1)
    const html = importSvg(
      '<!doctype html><html><body><p>Logo:</p><svg viewBox="0 0 10 10"><rect width=5 height=5></svg></body></html>',
    )
    expect(findItems(html.shapes, 'rc')).toHaveLength(1)
  })

  it('accepts SVG without a namespace, a BOM and an XML declaration', () => {
    const r = importSvg(
      '﻿<?xml version="1.0"?><svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>',
    )
    expect(findItems(r.shapes, 'rc')).toHaveLength(1)
  })

  it('ignores foreign namespaces (Inkscape/Sodipodi metadata)', () => {
    const r = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 10 10">
        <sodipodi:namedview pagecolor="#fff"><rect width="9" height="9"/></sodipodi:namedview><metadata><rect width="9" height="9"/></metadata>
        <rect width="5" height="5"/></svg>`,
    )
    expect(findItems(r.shapes, 'rc')).toHaveLength(1)
  })

  it('throws coded errors for invalid, non-SVG and empty input', () => {
    expect(errorCode('')).toBe('invalid')
    expect(errorCode('<html><body>hi</body></html>')).toBe('not-svg')
    expect(errorCode('{"v":"5.7"}')).toBe('not-svg')
    expect(errorCode(svg(''))).toBe('empty')
    try {
      importSvg(svg('<text id="t">Hello</text>'))
    } catch (e) {
      expect((e as SvgImportError).warnings).toMatchObject([{ code: 'text', id: 't' }])
    }
  })

  it('imports the part of malformed path data before the error, with a warning', () => {
    const r = importSvg(svg('<path id="p" d="M0 0 L10 0 L10 10 Z L" />'))
    expect(findItems(r.shapes, 'sh')).toHaveLength(1)
    expect(r.warnings).toMatchObject([{ code: 'path-data', id: 'p' }])
  })

  it('reports visual bounds that match shapeItemsBounds with strokes', () => {
    const r = importSvg(
      svg('<rect x="10" y="10" width="20" height="20" stroke="#000" stroke-width="4"/>'),
    )
    expect(r.bounds).toEqual({ x: 8, y: 8, w: 24, h: 24 })
    expect(shapeItemsBounds(r.shapes, 0)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
  })

  it('handles a large document quickly', () => {
    const rects = Array.from(
      { length: 2000 },
      (_, i) =>
        `<rect class="c${i % 50}" x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1"/>`,
    ).join('')
    const css = Array.from(
      { length: 50 },
      (_, i) => `.c${i}{fill:#${(i * 5).toString(16).padStart(2, '0')}0000}`,
    ).join('')
    const t0 = performance.now()
    const r = importSvg(svg(`<style>${css}</style>${rects}`))
    expect(content(r)).toHaveLength(2000)
    // Generous bound: this guards against quadratic blow-ups, not machine speed (CI runners vary).
    expect(performance.now() - t0).toBeLessThan(15000)
  })
})
