/** dotLottie export of themes (the Themes option of the dotLottie panel). */
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  createDotLottieContainer,
  readDotLottie,
  writeDotLottie,
  type DotLottieContainer,
} from '@/lottie/dotlottie'
import { applyTheme, bindColorSlot, colorRule, readThemeRules } from '@/lottie/slots'
import { extractColorUsages } from '@/lottie/colors'
import { produce } from 'immer'
import type { Animation } from '@/lottie/types'
import {
  buildDotLottie,
  exportContainer,
  exportNeedsV2,
  includesThemes,
  packageInfo,
  resolveDotLottieVersion,
  type DotLottieOptions,
} from '../lottie-files'
import { loadBounce, loadOrbit } from './fixtures'

const dotOptions = (patch: Partial<DotLottieOptions> = {}): DotLottieOptions => ({
  version: 'auto',
  extractImages: true,
  includePackage: true,
  themes: true,
  loop: true,
  autoplay: true,
  speed: 1,
  bounce: false,
  ...patch,
})

/** The bouncing ball with its orange bound to slot `ball`. */
function themedBounce(): Animation {
  const doc = loadBounce()
  return produce(doc, (d) => {
    const usages = extractColorUsages(doc).filter((u) => u.hex === '#ff6b4a')
    bindColorSlot(d, usages, 'ball')
  })
}

/** What the themes feature makes for a JSON document: one animation and a Dark theme. */
function jsonPackage(): DotLottieContainer {
  return {
    kind: 'dotlottie',
    version: 1,
    manifest: null,
    activeId: 'bounce',
    animations: [{ id: 'bounce', meta: { initialTheme: 'dark' } }],
    themes: [
      {
        id: 'dark',
        name: 'Dark',
        data: { rules: [colorRule('ball', { r: 0, g: 0, b: 1, a: 1 })] },
      },
    ],
    stateMachines: [],
    extraFiles: {},
  }
}

const entries = (bytes: Uint8Array) => Object.keys(unzipSync(bytes))
const manifestOf = (bytes: Uint8Array) =>
  JSON.parse(strFromU8(unzipSync(bytes)['manifest.json'])) as Record<string, unknown>

describe('dotLottie themes', () => {
  it('writes the themes of a JSON document as dotLottie 2', () => {
    const doc = themedBounce()
    const pkg = jsonPackage()
    expect(packageInfo(pkg)).toMatchObject({
      themes: 1,
      themeNames: ['Dark'],
      needsV2: true,
      needsV2WithoutThemes: false,
    })
    const { bytes } = buildDotLottie(doc, dotOptions(), 'bounce.json', pkg)
    expect(entries(bytes)).toEqual(['manifest.json', 't/dark.json', 'a/bounce.json'])
    expect(manifestOf(bytes)).toEqual({
      version: '2',
      generator: 'Lottie Editor',
      animations: [{ id: 'bounce', initialTheme: 'dark' }],
      themes: [{ id: 'dark', name: 'Dark' }],
    })
    // Read back: the theme turns the ball blue in a player.
    const read = readDotLottie(bytes)
    const rules = readThemeRules(read.themes[0].data)
    expect(rules).toEqual([{ id: 'ball', type: 'Color', value: [0, 0, 1] }])
    const themed = applyTheme(read.animations[0].data, rules, read.activeId)
    expect(themed.slots?.ball.p).toEqual({ a: 0, k: [0, 0, 1] })
  })

  it('leaves themes out when asked (and writes dotLottie 1 again)', () => {
    const doc = themedBounce()
    const opts = dotOptions({ themes: false })
    expect(resolveDotLottieVersion(opts, packageInfo(jsonPackage()))).toBe(1)
    const { bytes } = buildDotLottie(doc, opts, 'bounce.json', jsonPackage())
    expect(entries(bytes)).toEqual(['manifest.json', 'animations/bounce.json'])
    const manifest = manifestOf(bytes)
    expect(manifest.version).toBe('1')
    expect(JSON.stringify(manifest)).not.toContain('dark')
  })

  it('writes themes without the rest of a package', () => {
    const second = loadOrbit()
    const source = readDotLottie(
      writeDotLottie({
        animations: [
          { id: 'main', data: themedBounce() },
          { id: 'second', data: second },
        ],
        container: {
          ...jsonPackage(),
          activeId: 'main',
          animations: [
            { id: 'main', meta: { initialTheme: 'dark' } },
            { id: 'second', meta: {} },
          ],
          stateMachines: [{ id: 'sm', data: { initial: 'a', states: [] } }],
        },
      }),
    )
    const container = createDotLottieContainer(source, 'main')
    const info = packageInfo(container)!
    expect(info).toMatchObject({ otherAnimations: 1, stateMachines: 1, needsV2WithoutThemes: true })

    const opts = dotOptions({ includePackage: false })
    expect(includesThemes(opts)).toBe(true)
    const only = exportContainer(container, opts)!
    expect(only.animations).toEqual([{ id: 'main', meta: { initialTheme: 'dark' } }])
    expect(only.stateMachines).toEqual([])
    const { bytes } = buildDotLottie(themedBounce(), opts, 'edited.lottie', container)
    expect(entries(bytes)).toEqual(['manifest.json', 't/dark.json', 'a/main.json'])

    // The whole package without its themes still needs v2 (state machine): no initialTheme.
    const noThemes = dotOptions({ themes: false })
    expect(exportNeedsV2(noThemes, info)).toBe(true)
    const rest = buildDotLottie(themedBounce(), noThemes, 'edited.lottie', container).bytes
    expect(entries(rest).sort()).toEqual(
      ['a/main.json', 'a/second.json', 'manifest.json', 's/sm.json'].sort(),
    )
    expect(JSON.stringify(manifestOf(rest))).not.toContain('initialTheme')
  })

  it('keeps the old behaviour when the option is unset (themes follow the package)', () => {
    const info = packageInfo(jsonPackage())
    expect(includesThemes({ includePackage: false })).toBe(false)
    expect(resolveDotLottieVersion({ version: 'auto', includePackage: false }, info)).toBe(1)
    expect(resolveDotLottieVersion({ version: 'auto', includePackage: true }, info)).toBe(2)
    expect(
      resolveDotLottieVersion({ version: '1', includePackage: true, themes: true }, info),
    ).toBe(2)
    expect(exportContainer(jsonPackage(), { includePackage: false })).toBeUndefined()
    expect(exportContainer({ kind: 'tgs' }, { includePackage: true })).toBeUndefined()
  })
})
