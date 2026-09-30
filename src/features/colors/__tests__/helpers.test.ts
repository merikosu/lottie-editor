import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { extractColorUsages, extractGradients, groupColors, groupGradients } from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { paintedNodes } from '../actions'
import { formatPalette, gradientGroupCss } from '../palette-export'
import { describeGradientUsage, describeUsage } from '../usage-label'

const doc = {
  v: '5.7.0',
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  layers: [
    {
      ty: 4,
      nm: 'Ball',
      ind: 1,
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      shapes: [
        {
          ty: 'gr',
          nm: 'Body',
          it: [
            {
              ty: 'fl',
              nm: 'Body fill',
              c: {
                a: 1,
                k: [
                  { t: 0, s: [1, 0, 0, 1] },
                  { t: 9, s: [1, 0, 0, 1] },
                ],
              },
            },
            {
              ty: 'gf',
              nm: 'Shine',
              t: 2,
              g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0] } },
            },
            { ty: 'tr' },
          ],
        },
        { ty: 'st', nm: 'Outline', c: { a: 0, k: [0, 0, 0, 1] } },
      ],
      ef: [
        { ty: 21, nm: 'Tint', ef: [{ ty: 2, nm: 'Map white to', v: { a: 0, k: [1, 0, 0, 1] } }] },
      ],
    },
  ],
  assets: [
    {
      id: 'comp_1',
      nm: 'Icon',
      layers: [{ ty: 1, nm: 'Bg', sc: '#ffffff', ip: 0, op: 60, st: 0, ks: {} }],
    },
  ],
} as unknown as Animation

const usages = extractColorUsages(doc)
const colorGroups = groupColors(usages)
const gradientGroups = groupGradients(extractGradients(doc))

describe('formatPalette', () => {
  it('lists hex colors in palette order', () => {
    expect(formatPalette(colorGroups, gradientGroups, 'hex')).toBe('#FF0000\n#FFFFFF\n#000000')
  })

  it('writes CSS custom properties for colors and gradients', () => {
    expect(formatPalette(colorGroups, gradientGroups, 'css')).toBe(
      [
        ':root {',
        '  --color-1: #ff0000;',
        '  --color-2: #ffffff;',
        '  --color-3: #000000;',
        '  --gradient-1: radial-gradient(circle, #ffffff 0%, rgba(0, 0, 0, 0) 100%);',
        '}',
      ].join('\n'),
    )
  })

  it('writes JSON with usage details', () => {
    const data = JSON.parse(formatPalette(colorGroups, gradientGroups, 'json'))
    expect(data.colors[0]).toEqual({ hex: '#ff0000', uses: 3, kinds: ['fill', 'effect'] })
    expect(data.gradients[0]).toMatchObject({
      type: 'radial',
      uses: 1,
      stops: [
        { offset: 0, hex: '#ffffff' },
        { offset: 1, hex: '#000000' },
      ],
      opacity: [
        { offset: 0, alpha: 1 },
        { offset: 1, alpha: 0 },
      ],
    })
  })

  it('builds gradient CSS from a group', () => {
    expect(gradientGroupCss(gradientGroups[0])).toContain('radial-gradient(circle')
  })
})

describe('describeUsage', () => {
  it('names the nodes that hold a color, with keyframe and stop details', () => {
    const [kf0, kf1, stop0] = usages
    expect(describeUsage(doc, kf0, en)).toEqual({
      crumbs: ['Ball', 'Body', 'Body fill'],
      kind: 'Fill',
      detail: 'Key 1',
    })
    expect(describeUsage(doc, kf1, ru).detail).toBe('Ключ 2')
    expect(describeUsage(doc, stop0, en)).toEqual({
      crumbs: ['Ball', 'Body', 'Shine'],
      kind: 'Gradient',
      detail: 'Stop 1 at 0%',
    })
  })

  it('names effects and precomp layers', () => {
    const effect = usages.find((u) => u.kind === 'effect')!
    expect(describeUsage(doc, effect, en).crumbs).toEqual(['Ball', 'Tint', 'Map white to'])
    const solid = usages.find((u) => u.kind === 'solid')!
    expect(describeUsage(doc, solid, en)).toEqual({
      crumbs: ['Icon', 'Bg'],
      kind: 'Solid layer',
      detail: '',
    })
  })

  it('describes gradients', () => {
    expect(describeGradientUsage(doc, gradientGroups[0].usages[0], en)).toEqual({
      crumbs: ['Ball', 'Body', 'Shine'],
      kind: 'Gradient fill',
      detail: '',
    })
  })
})

describe('paintedNodes', () => {
  it('highlights the group (or layer) a color paints', () => {
    expect(paintedNodes(usages)).toEqual([
      ['layers', 0, 'shapes', 0],
      ['layers', 0],
      ['assets', 0, 'layers', 0],
    ])
  })
})
