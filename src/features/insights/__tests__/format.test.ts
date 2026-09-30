import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import type { Animation } from '@/lottie/types'
import { validate, type Issue } from '@/lottie/validate'
import {
  doc,
  ellipse,
  fill,
  group,
  kf,
  layer,
  p,
  precompLayer,
  rect,
  stroke,
  type J,
} from '@/lottie/__tests__/insights.fixtures'
import {
  canShow,
  describeIssue,
  formatCount,
  formatParams,
  issueAbout,
  issueTitle,
  locate,
  locationText,
  placesSummary,
  playerChips,
  propertyName,
  showTarget,
  toolAction,
  type FormatOptions,
} from '../format'

const EN: FormatOptions = { t: en, lang: 'en' }
const RU: FormatOptions = { t: ru, lang: 'ru' }

function issue(code: Issue['code'], extra: Partial<Issue> = {}): Issue {
  return { id: code, severity: 'warning', code, params: {}, paths: [[]], count: 1, ...extra }
}

/** Root: a shape layer with a group (rect, fill with animated color); a precomp with one layer. */
function sample(): Animation {
  const inner = layer(1, { nm: 'Inner' })
  const shapes = layer(2, {
    nm: 'Shapes',
    shapes: [
      group([rect(), fill({ c: kf([0, [1, 0, 0, 1]], [10, [0, 0, 1, 1]]) }), stroke()], {
        nm: 'Body',
      }),
      ellipse(),
    ],
    masksProperties: [
      { mode: 'a', pt: p({ v: [], i: [], o: [], c: true }), o: p(100), x: p(0), nm: 'Cut' },
    ],
    ef: [{ ty: 5, nm: 'Slider Control', en: 1, ef: [{ ty: 0, nm: 'Slider', v: p(5) }] }],
  })
  return doc([shapes, precompLayer(3, 'comp_1')], {
    assets: [
      { id: 'comp_1', nm: 'Splash', layers: [inner] },
      { id: 'image_0', w: 10, h: 10, u: 'images/', p: 'img_0.png', e: 0 },
    ],
  })
}

describe('numbers and parameters', () => {
  it('groups digits per language', () => {
    expect(formatCount(12345, 'en')).toBe('12,345')
    expect(formatCount(12345, 'ru').replace(/\s/g, ' ')).toBe('12 345')
    expect(formatCount(29.976, 'en')).toBe('29.98')
    expect(formatCount(3.5, 'ru')).toBe('3,5')
  })

  it('formats sizes, counts and flags', () => {
    const out = formatParams(
      issue('perf.fileSize', { params: { bytes: 6 * 1024 * 1024 } }),
      EN,
      null,
    )
    expect(out.bytes).toBe('6 MB')
    expect(formatParams(issue('perf.layers', { params: { count: 1500 } }), EN, null).count).toBe(
      '1,500',
    )
    expect(
      formatParams(
        issue('doc.legacyVersion', { params: { version: '4.1.0', colors: 1 } }),
        EN,
        null,
      ).colors,
    ).toBe('1')
  })

  it('names the missing property from its path', () => {
    const d = sample()
    const missing = issue('prop.missing', {
      params: { key: 'c' },
      paths: [['layers', 0, 'shapes', 0, 'it', 1, 'c']],
    })
    expect(issueTitle(missing, EN, d)).toBe('Color is missing')
    expect(issueTitle(missing, RU, d)).toContain('Цвет')
    // Without a document the raw key is quoted.
    expect(issueTitle(missing, EN, null)).toBe('“c” is missing')
  })
})

describe('messages', () => {
  it('renders every issue of a broken document in both languages', () => {
    const broken = doc(
      [
        layer(1, { parent: 9, ks: undefined }),
        layer(1, { ty: 5, t: { d: { k: [{ t: 0, s: { t: 'a\nb', f: 'Nope', s: 10 } }] } } }),
        layer(3, { tt: 1, shapes: [group([rect({ r: undefined })])] }),
      ],
      { fr: 24, w: 400, h: 300, v: '4.0' },
    )
    const issues = validate(broken)
    expect(issues.length).toBeGreaterThan(5)
    for (const o of [EN, RU]) {
      for (const i of issues) {
        const title = issueTitle(i, o, broken)
        expect(title, i.code).toBeTruthy()
        expect(title).not.toMatch(/undefined|NaN|\[object/)
        expect(issueAbout(i, o, broken), i.code).not.toMatch(/undefined|NaN|\[object/)
      }
    }
  })

  it('uses the feature name for compatibility issues', () => {
    const compat = issue('compat', { params: { feature: 'expressions' } })
    expect(issueTitle(compat, EN, null)).toBe('Expressions')
    expect(issueAbout(compat, EN, null)).toContain('lottie-web')
    expect(issueTitle(compat, RU, null)).toBe('Выражения')
  })

  it('builds Telegram titles from the canvas size and duration', () => {
    const d = doc([layer(1)], { w: 400, h: 300, fr: 30, op: 120 })
    const all = validate(d)
    const size = all.find((i) => i.code === 'telegram.size')!
    expect(issueTitle(size, EN, d)).toBe('Canvas is 400 × 300, not 512 × 512')
    const duration = all.find((i) => i.code === 'telegram.duration')!
    expect(issueTitle(duration, EN, d)).toBe('Longer than 3 seconds (4 s)')
  })
})

describe('locations', () => {
  const d = sample()
  const text = (path: (string | number)[]) => locationText(locate(d, path, en))

  it('names document-level places and assets', () => {
    expect(text([])).toBe('Animation')
    expect(text(['w'])).toBe('Animation')
    expect(text(['assets', 0])).toBe('Precomp “Splash”')
    expect(text(['assets', 1])).toBe('Image “image_0”')
    expect(text(['chars'])).toBe('Glyphs')
  })

  it('walks layers, groups, shape items and their properties', () => {
    expect(text(['layers', 0])).toBe('Shapes')
    expect(text(['layers', 0, 'shapes', 0])).toBe('Shapes › Body')
    expect(text(['layers', 0, 'shapes', 0, 'it', 0, 'r'])).toBe(
      'Shapes › Body › Rectangle › Roundness',
    )
    expect(text(['layers', 0, 'shapes', 0, 'it', 1, 'c', 'k', 1, 's', 0])).toBe(
      'Shapes › Body › Fill › Color › Keyframe 2',
    )
    expect(text(['layers', 0, 'shapes', 0, 'it', 2, 'w'])).toBe('Shapes › Body › Stroke › Width')
    expect(text(['layers', 0, 'ks', 'p'])).toBe('Shapes › Position')
    expect(text(['layers', 0, 'ks', 'p', 'x'])).toBe('Shapes › X position')
    expect(text(['layers', 0, 'ks'])).toBe('Shapes › Transform')
  })

  it('names masks, effects and text parts', () => {
    expect(text(['layers', 0, 'masksProperties', 0])).toBe('Shapes › Cut')
    expect(text(['layers', 0, 'masksProperties', 0, 'pt'])).toBe('Shapes › Cut › Path')
    expect(text(['layers', 0, 'ef', 0])).toBe('Shapes › Slider Control')
    expect(text(['layers', 0, 'ef', 0, 'ef', 0, 'v'])).toBe('Shapes › Slider Control › Slider')
    expect(text(['layers', 0, 'sy', 0])).toBe('Shapes › Style 1')
  })

  it('prefixes layers inside precompositions with the composition', () => {
    const loc = locate(d, ['assets', 0, 'layers', 0, 'shapes', 0], en)
    expect(loc.comp).toBe('Splash')
    expect(locationText(loc)).toBe('Splash › Inner › Group')
  })

  it('translates property names', () => {
    expect(propertyName(d, ['layers', 0, 'shapes', 0, 'it', 1, 'c'], ru)).toBe('Цвет')
    expect(locationText(locate(d, ['layers', 0, 'ks', 'r'], ru))).toBe('Shapes › Поворот')
  })

  it('names the nodes of damaged files', () => {
    const odd = doc([
      layer(1, {
        nm: 42,
        shapes: [
          { ty: 'constructor', nm: 7, c: p(1) },
          { ty: 'gr', it: [{ ty: 'toString' }] },
        ],
      }),
      layer(2, { nm: { x: 1 }, ty: 'x' }),
    ])
    const at = (path: (string | number)[]) => locationText(locate(odd, path, en))
    expect(at(['layers', 0])).toBe('42')
    expect(at(['layers', 0, 'shapes', 0])).toBe('42 › 7')
    expect(at(['layers', 0, 'shapes', 0, 'c'])).toBe('42 › 7')
    expect(at(['layers', 0, 'shapes', 1, 'it', 0])).toBe('42 › Group › Shape item')
    expect(at(['layers', 1])).toBe('Layer 2')
  })

  it('does not throw on paths that no longer exist', () => {
    expect(() => text(['layers', 7, 'shapes', 3, 'it', 9])).not.toThrow()
    expect(() => text(['assets', 9, 'layers', 0])).not.toThrow()
  })
})

describe('place summaries', () => {
  const d = doc([layer(1), layer(2), layer(3, { nm: 'Third' }), precompLayer(4, 'c')], {
    assets: [
      { id: 'c', layers: [layer(1)] },
      { id: 'x', layers: [] },
    ],
  })

  it('shows the location of a single place', () => {
    expect(placesSummary(issue('layer.missingInd', { paths: [['layers', 2]] }), d, en)).toBe(
      'Third',
    )
    expect(placesSummary(issue('doc.range'), d, en)).toBe('Animation')
  })

  it('lists two layers by name and counts more', () => {
    const two = issue('layer.duplicateInd', {
      paths: [
        ['layers', 0],
        ['layers', 2],
      ],
      count: 2,
    })
    expect(placesSummary(two, d, en)).toBe('Layer 1, Third')
    const many = issue('compat', {
      paths: [
        ['layers', 0],
        ['layers', 1],
        ['layers', 2],
      ],
      count: 3,
    })
    expect(placesSummary(many, d, en)).toBe('in 3 layers')
    expect(placesSummary(many, d, ru)).toBe('в 3 слоях')
  })

  it('counts places per layer and assets', () => {
    const places = issue('prop.singleKeyframe', {
      paths: [
        ['layers', 0, 'ks', 'p'],
        ['layers', 0, 'ks', 'r'],
        ['layers', 1, 'ks', 'o'],
      ],
      count: 3,
    })
    expect(placesSummary(places, d, en)).toBe('3 places in 2 layers')
    const perLayer = issue('compat', {
      paths: [
        ['layers', 0, 'ks', 'r'],
        ['layers', 1, 'ks', 'r'],
        ['layers', 2, 'ks', 'r'],
      ],
      count: 3,
    })
    expect(placesSummary(perLayer, d, en)).toBe('in 3 layers')
    const assets = issue('asset.unused', {
      paths: [
        ['assets', 0],
        ['assets', 1],
      ],
      count: 2,
    })
    expect(placesSummary(assets, d, en)).toBe('2 assets')
  })

  it('draws parent loops as a closed chain', () => {
    const loop = issue('layer.parentCycle', {
      paths: [
        ['layers', 0],
        ['layers', 2],
      ],
      count: 1,
    })
    expect(placesSummary(loop, d, en)).toBe('Layer 1 → Third → Layer 1')
  })
})

describe('players', () => {
  it('merges lottie-web renderers into one chip with the worst level', () => {
    const chips = playerChips(
      [
        { player: 'ios', level: 'n' },
        { player: 'web-canvas', level: 'x' },
        { player: 'web-svg', level: 'p' },
      ],
      en,
    )
    expect(chips.map((c) => `${c.label}:${c.level}`)).toEqual(['Web:x', 'iOS:n'])
    expect(chips[0].full).toContain('canvas')
  })

  it('keeps a single web renderer as it is', () => {
    const chips = playerChips([{ player: 'web-canvas', level: 'p' }], en)
    expect(chips.map((c) => c.label)).toEqual(['Canvas'])
  })
})

describe('targets and actions', () => {
  const d = sample()

  it('selects the owner of a property and its keyframe', () => {
    const target = showTarget(d, ['layers', 0, 'shapes', 0, 'it', 1, 'c', 'k', 1, 's', 0])
    expect(target.node).toEqual(['layers', 0, 'shapes', 0, 'it', 1])
    expect(target.property).toEqual(['layers', 0, 'shapes', 0, 'it', 1, 'c'])
    expect(target.keyframe).toEqual({ path: ['layers', 0, 'shapes', 0, 'it', 1, 'c'], index: 1 })
  })

  it('selects layers for masks and effects, assets by index', () => {
    const mask = showTarget(d, ['layers', 0, 'masksProperties', 0, 'pt'])
    expect(mask.node).toEqual(['layers', 0])
    expect(mask.property).toEqual(['layers', 0, 'masksProperties', 0, 'pt'])
    expect(showTarget(d, ['assets', 1]).asset).toBe(1)
    expect(showTarget(d, ['layers', 9]).node).toBeNull()
    expect(showTarget(d, []).node).toBeNull()
  })

  it('knows which issues can be shown and which tool helps', () => {
    expect(canShow(issue('doc.range'))).toBe(false)
    expect(canShow(issue('asset.unused', { paths: [['assets', 0]] }))).toBe(true)
    expect(toolAction(issue('telegram.size'))).toBe('resize')
    expect(toolAction(issue('image.external', { params: { kind: 'file' } }))).toBe('locate')
    expect(toolAction(issue('image.external', { params: { kind: 'url' } }))).toBeNull()
    expect(toolAction(issue('layer.missingInd'))).toBeNull()
  })
})

describe('copy text', () => {
  it('describes the issue, its players and places', () => {
    const d = doc([layer(1, { ks: { ...(layer(1).ks as J), r: { ...p(0), x: 'time * 10' } } })])
    const expr = validate(d).find((i) => i.code === 'compat' && i.params.feature === 'expressions')!
    const text = describeIssue(expr, EN, d)
    expect(text.split('\n')[0]).toMatch(/^(Error|Warning|Note): Expressions$/)
    expect(text).toContain('- lottie-ios: Ignored')
    expect(text).toContain('Layer 1 › Rotation')
  })
})
