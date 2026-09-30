// @vitest-environment jsdom
/**
 * Robustness of the remix engine: suggesting, measuring and replacing elements of a damaged file
 * must never fail with anything but a `ReplaceError`, and the SVG importer must never fail with
 * anything but an `SvgImportError` (damaged markup), nor produce non-finite geometry.
 */
import { describe, expect, it } from 'vitest'
import like from '../../samples/like.json'
import orbit from '../../samples/orbit.json'
import typing from '../../samples/typing.json'
import {
  findReplaceableElements,
  measureElement,
  ReplaceError,
  replaceWithImage,
  replaceWithShapes,
} from '../replace'
import { importSvg, SvgImportError } from '../svg'
import type { Animation } from '../types'
import { damage, seeded } from './fixtures/optimizer/damage'
import { fixture } from './fixtures/remix/helpers'

const SAMPLES: Record<string, unknown> = { like, orbit, typing }
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <rect width="10" height="10" rx="2" fill="#f00"/><circle cx="5" cy="5" r="3" fill="#fff"/></svg>`

/** Runs `fn`; engine errors of the expected kind are fine, anything else is a failure. */
function tolerate(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    if (!(err instanceof ReplaceError)) throw err
  }
}

describe('damaged files', () => {
  const logo = importSvg(LOGO)
  for (const [name, sample] of Object.entries(SAMPLES)) {
    it(`suggests and replaces elements of damaged copies of "${name}"`, () => {
      const failures: string[] = []
      for (let seed = 1; seed <= 40; seed++) {
        const doc = structuredClone(sample) as Animation
        damage(doc, seeded(seed * 104729), 1 + (seed % 5))
        try {
          for (const c of findReplaceableElements(doc).slice(0, 3)) {
            measureElement(doc, c.path)
            tolerate(() =>
              replaceWithShapes(structuredClone(doc), c.path, {
                shapes: structuredClone(logo.shapes),
              }),
            )
            tolerate(() =>
              replaceWithImage(structuredClone(doc), c.path, {
                dataUri: 'data:image/png;base64,AAAA',
                w: 10,
                h: 10,
              }),
            )
          }
        } catch (err) {
          failures.push(`${seed}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      expect(failures).toEqual([])
    })
  }
})

describe('damaged SVG markup', () => {
  const FIXTURES = ['icon-figma', 'icon-stroke', 'logo-illustrator', 'use-symbol'].map((f) =>
    fixture(`${f}.svg`),
  )
  const TOKENS = ['<', '>', '"', 'NaN', '1e999', '-', '.', 'url(#x)', 'transform="scale(0)"']
  TOKENS.push('viewBox="0 0 0 0"', '<use href="#a"/>', 'id="a"', 'rx="-5"', 'r="Infinity"', '%')

  it('fails only with SvgImportError and never yields non-finite bounds', () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 300; seed++) {
      const rand = seeded(seed)
      let text = FIXTURES[Math.floor(rand() * FIXTURES.length)]
      for (let edit = 0; edit < 1 + (seed % 6); edit++) {
        const at = Math.floor(rand() * text.length)
        text =
          rand() < 0.4
            ? text.slice(0, at) + text.slice(at + 1 + Math.floor(rand() * 8))
            : text.slice(0, at) + TOKENS[Math.floor(rand() * TOKENS.length)] + text.slice(at)
      }
      try {
        const { bounds } = importSvg(text)
        if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite))
          failures.push(`${seed}: bounds ${JSON.stringify(bounds)}`)
      } catch (err) {
        if (!(err instanceof SvgImportError)) failures.push(`${seed}: ${String(err)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
