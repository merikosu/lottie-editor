import { describe, expect, it } from 'vitest'
import { applyMatrix, type Matrix2D } from '../bounds'
import { NAMED_COLOR_COUNT, parseColor } from '../svg/color'
import { parseDeclarations, parseStylesheet, selectorKey, selectorSpecificity } from '../svg/css'
import { parseAngle, parseFraction, parseLength, parseNumberList } from '../svg/scan'
import { parsePaint, substituteVars } from '../svg/style'
import { parseTransform } from '../svg/transform'

const rgba = (r: number, g: number, b: number, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a })

function expectColor(input: string, expected: { r: number; g: number; b: number; a: number }) {
  const c = parseColor(input)
  expect(c, input).not.toBeNull()
  expect(c!.r).toBeCloseTo(expected.r, 4)
  expect(c!.g).toBeCloseTo(expected.g, 4)
  expect(c!.b).toBeCloseTo(expected.b, 4)
  expect(c!.a).toBeCloseTo(expected.a, 4)
}

describe('CSS colors', () => {
  it('parses hex in 3, 4, 6 and 8 digits, any case', () => {
    expectColor('#f00', rgba(255, 0, 0))
    expectColor('#F00A', rgba(255, 0, 0, 0xaa / 255))
    expectColor('#0A98FD', rgba(10, 152, 253))
    expectColor('#0a98fd80', rgba(10, 152, 253, 128 / 255))
    expectColor('  #FFFFFF  ', rgba(255, 255, 255))
  })

  it('parses rgb()/rgba() in comma and space syntax, with percentages and alpha', () => {
    expectColor('rgb(255, 0, 0)', rgba(255, 0, 0))
    expectColor('rgba(255,0,0,0.5)', rgba(255, 0, 0, 0.5))
    expectColor('rgb(100%, 0%, 50%)', rgba(255, 0, 127.5))
    expectColor('rgb(255 128 0 / 25%)', rgba(255, 128, 0, 0.25))
    expectColor('RGBA(0 0 255 / .5)', rgba(0, 0, 255, 0.5))
    expectColor('rgba(255, 0, 0, 50%)', rgba(255, 0, 0, 0.5))
    expectColor('rgb(300, -20, 0)', rgba(255, 0, 0))
    expectColor('rgb(none 255 none)', rgba(0, 255, 0))
  })

  it('parses hsl()/hsla() with angle units and the modern syntax', () => {
    expectColor('hsl(120, 100%, 50%)', rgba(0, 255, 0))
    expectColor('hsla(240, 100%, 50%, 0.5)', rgba(0, 0, 255, 0.5))
    expectColor('hsl(120deg 100% 25% / 0.5)', rgba(0, 127.5, 0, 0.5))
    expectColor('hsl(0.5turn 100% 50%)', rgba(0, 255, 255))
    expectColor(`hsl(${Math.PI}rad, 100%, 50%)`, rgba(0, 255, 255))
    expectColor('hsl(0 0 100)', rgba(255, 255, 255))
  })

  it('parses hwb()', () => {
    expectColor('hwb(0 0% 0%)', rgba(255, 0, 0))
    expectColor('hwb(120 50% 50%)', rgba(127.5, 127.5, 127.5))
    expectColor('hwb(0 20% 20% / 0.5)', { r: 0.8, g: 0.2, b: 0.2, a: 0.5 })
  })

  it('knows all CSS named colors, case-insensitively', () => {
    expect(NAMED_COLOR_COUNT).toBe(148)
    expectColor('rebeccapurple', rgba(0x66, 0x33, 0x99))
    expectColor('Red', rgba(255, 0, 0))
    expectColor('WHITE', rgba(255, 255, 255))
    expectColor('grey', rgba(128, 128, 128))
    expectColor('lightgoldenrodyellow', rgba(0xfa, 0xfa, 0xd2))
    expectColor('transparent', { r: 0, g: 0, b: 0, a: 0 })
  })

  it('drops an SVG 1.1 icc-color() suffix', () => {
    expectColor('#CD853F icc-color(acmecmyk, 0.11, 0.48, 0.83, 0.00)', rgba(0xcd, 0x85, 0x3f))
  })

  it('rejects invalid colors and paint keywords', () => {
    for (const bad of [
      '',
      '#12',
      '#ggg',
      '#12345',
      'rgb(1,2)',
      'rgb(1,2,3,4,5)',
      'notacolor',
      'currentColor',
      'none',
      'hsl(10%, 1, 1)',
      'url(#a)',
    ]) {
      expect(parseColor(bad), bad).toBeNull()
    }
  })
})

describe('paint values', () => {
  it('parses none, colors, currentColor and url references with fallbacks', () => {
    expect(parsePaint('none')).toEqual({ kind: 'none' })
    expect(parsePaint('currentColor')).toEqual({ kind: 'current' })
    expect(parsePaint('url(#grad)')).toEqual({ kind: 'url', id: 'grad', fallback: null })
    expect(parsePaint("url('#g2') red")).toMatchObject({
      kind: 'url',
      id: 'g2',
      fallback: { kind: 'color' },
    })
    expect(parsePaint('url("#a b") none')).toEqual({
      kind: 'url',
      id: 'a b',
      fallback: { kind: 'none' },
    })
    expect(parsePaint('url(other.svg#x)')).toEqual({ kind: 'url', id: null, fallback: null })
    expect(parsePaint('context-fill')).toEqual({ kind: 'none' })
    expect(parsePaint('url(#a) url(#b)')).toBeNull()
    expect(parsePaint('bogus')).toBeNull()
  })

  it('substitutes CSS variables with fallbacks', () => {
    const vars = new Map([
      ['--brand', '#f00'],
      ['--alias', 'var(--brand)'],
    ])
    expect(substituteVars('var(--brand)', vars)).toBe('#f00')
    expect(substituteVars('var(--alias)', vars)).toBe('#f00')
    expect(substituteVars('var(--missing, blue)', vars)).toBe('blue')
    expect(substituteVars('var(--missing)', vars)).toBeNull()
    expect(substituteVars('rgb(var(--r, 1) 2 3)', vars)).toBe('rgb(1 2 3)')
  })
})

describe('numbers and lengths', () => {
  it('scans compact number lists', () => {
    expect(parseNumberList('1,2 3-4.5.5e1')).toEqual([1, 2, 3, -4.5, 5])
    expect(parseNumberList('10, 20 ,30 x 40')).toEqual([10, 20, 30])
    expect(parseNumberList(null)).toEqual([])
  })

  it('converts length units to user units', () => {
    expect(parseLength('12')).toBe(12)
    expect(parseLength('12px')).toBe(12)
    expect(parseLength('1in')).toBe(96)
    expect(parseLength('72pt')).toBeCloseTo(96, 9)
    expect(parseLength('25.4mm')).toBeCloseTo(96, 9)
    expect(parseLength('2.54cm')).toBeCloseTo(96, 9)
    expect(parseLength('1pc')).toBe(16)
    expect(parseLength('2em')).toBe(32)
    expect(parseLength('50%', 300)).toBe(150)
    expect(parseLength('50%')).toBeNull()
    expect(parseLength('abc')).toBeNull()
    expect(parseLength('12parsecs')).toBeNull()
  })

  it('parses fractions and angles', () => {
    expect(parseFraction('0.25')).toBe(0.25)
    expect(parseFraction('25%')).toBe(0.25)
    expect(parseFraction('%')).toBeNull()
    expect(parseFraction('')).toBeNull()
    expect(parseAngle('90')).toBe(90)
    expect(parseAngle('0.5turn')).toBe(180)
    expect(parseAngle('100grad')).toBeCloseTo(90, 9)
    expect(parseAngle(`${Math.PI}rad`)).toBeCloseTo(180, 9)
  })
})

const map = (m: Matrix2D | null, x: number, y: number) => applyMatrix(m!, x, y)

describe('transforms', () => {
  it('parses every SVG transform function', () => {
    expect(parseTransform('translate(10)')).toEqual([1, 0, 0, 1, 10, 0])
    expect(parseTransform('translate(10,20)')).toEqual([1, 0, 0, 1, 10, 20])
    expect(parseTransform('translate(10-5)')).toEqual([1, 0, 0, 1, 10, -5])
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0])
    expect(parseTransform('scale(2 3)')).toEqual([2, 0, 0, 3, 0, 0])
    expect(parseTransform('rotate(90)')).toEqual([0, 1, -1, 0, 0, 0])
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6])
    const skx = parseTransform('skewX(45)')!
    expect(skx[2]).toBeCloseTo(1, 12)
    const sky = parseTransform('skewY(45)')!
    expect(sky[1]).toBeCloseTo(1, 12)
  })

  it('rotates around a center', () => {
    const m = parseTransform('rotate(90 10 10)')
    const [x, y] = map(m, 10, 10)
    expect(x).toBeCloseTo(10, 12)
    expect(y).toBeCloseTo(10, 12)
    const [x2, y2] = map(m, 20, 10)
    expect(x2).toBeCloseTo(10, 12)
    expect(y2).toBeCloseTo(20, 12)
  })

  it('composes left to right (the last function applies first)', () => {
    const m = parseTransform('translate(10 0) scale(2)')
    expect(map(m, 1, 0)).toEqual([12, 0])
    const n = parseTransform('scale(2),translate(10 0)')
    expect(map(n, 1, 0)).toEqual([22, 0])
  })

  it('understands CSS transform syntax and units', () => {
    expect(parseTransform('rotate(0.25turn)')).toEqual(parseTransform('rotate(90)'))
    expect(parseTransform('translateX(5px) translateY(-2px)')).toEqual([1, 0, 0, 1, 5, -2])
    expect(parseTransform('rotate(45deg)')![0]).toBeCloseTo(Math.SQRT1_2, 12)
    const sk = parseTransform('skew(45deg, 0deg)')!
    expect(sk[2]).toBeCloseTo(1, 12)
    expect(parseTransform('scaleX(2) scaleY(3)')).toEqual([2, 0, 0, 3, 0, 0])
    expect(parseTransform('translate3d(1px, 2px, 3px)')).toEqual([1, 0, 0, 1, 1, 2])
  })

  it('returns identity for none/empty and null for invalid lists', () => {
    expect(parseTransform(null)).toEqual([1, 0, 0, 1, 0, 0])
    expect(parseTransform('  ')).toEqual([1, 0, 0, 1, 0, 0])
    expect(parseTransform('none')).toEqual([1, 0, 0, 1, 0, 0])
    for (const bad of [
      'rotate(',
      'foo(1)',
      'translate(1 2 3)',
      'matrix(1 2 3)',
      'rotate(1 2)',
      'scale()',
      'translate(1) garbage',
    ]) {
      expect(parseTransform(bad), bad).toBeNull()
    }
  })
})

describe('CSS parsing', () => {
  it('parses declarations with !important, empty parts and url() containing semicolons', () => {
    expect(parseDeclarations('fill:red; stroke : blue !important;;')).toEqual([
      { prop: 'fill', value: 'red', important: false },
      { prop: 'stroke', value: 'blue', important: true },
    ])
    const d = parseDeclarations('fill:url("data:image/png;base64,AAA=");opacity:.5')
    expect(d).toHaveLength(2)
    expect(d[0].value).toBe('url("data:image/png;base64,AAA=")')
    expect(parseDeclarations('/* c */ FILL: Red')).toEqual([
      { prop: 'fill', value: 'Red', important: false },
    ])
  })

  it('parses rules, grouped selectors, comments and skips at-rules', () => {
    const { rules, skippedAtRules } = parseStylesheet(`
      @import url(x.css);
      /* comment { with braces } */
      .st0, .st1 { fill: #fff }
      @media (prefers-color-scheme: dark) { .st0 { fill: #000 } }
      @font-face { font-family: x; src: url(a.woff) }
      #logo path { stroke: red; stroke-width: 2 }
      .s{fill:url("data:x;y}")}
    `)
    expect(rules.map((r) => r.selector)).toEqual(['.st0', '.st1', '#logo path', '.s'])
    expect(rules[0].decls).toEqual([{ prop: 'fill', value: '#fff', important: false }])
    expect(rules[2].decls).toHaveLength(2)
    expect(rules[3].decls[0].value).toBe('url("data:x;y}")')
    expect(rules.map((r) => r.order)).toEqual([0, 1, 2, 3])
    expect(skippedAtRules).toEqual(['@media'])
  })

  it('continues source order across sheets and ignores HTML comment tokens', () => {
    const { rules } = parseStylesheet('<!-- .a{fill:red} -->', 10)
    expect(rules[0].order).toBe(10)
  })

  it('computes specificity', () => {
    expect(selectorSpecificity('*')).toBe(0)
    expect(selectorSpecificity('path')).toBe(1)
    expect(selectorSpecificity('g path')).toBe(2)
    expect(selectorSpecificity('.a')).toBe(1000)
    expect(selectorSpecificity('.a.b')).toBe(2000)
    expect(selectorSpecificity('#x')).toBe(1e6)
    expect(selectorSpecificity('#x .a > path')).toBe(1e6 + 1000 + 1)
    expect(selectorSpecificity('path[fill]')).toBe(1001)
    expect(selectorSpecificity('path:first-child')).toBe(1001)
    expect(selectorSpecificity('path::before')).toBe(2)
    expect(selectorSpecificity(':not(#x)')).toBe(1e6)
    expect(selectorSpecificity(':is(.a, #b) path')).toBe(1e6 + 1)
    expect(selectorSpecificity(':where(#x) .a')).toBe(1000)
    expect(selectorSpecificity('path:nth-child(2n+1)')).toBe(1001)
  })

  it('extracts a pre-filter key from the rightmost compound selector', () => {
    expect(selectorKey('.st0')).toEqual({ classes: ['st0'] })
    expect(selectorKey('g .a.b')).toEqual({ classes: ['a', 'b'] })
    expect(selectorKey('#x')).toEqual({ id: 'x', classes: [] })
    expect(selectorKey('svg > path.c')).toEqual({ tag: 'path', classes: ['c'] })
    expect(selectorKey('a:hover')).toEqual({ classes: [] })
    expect(selectorKey('[data-x]')).toEqual({ classes: [] })
  })
})
