import { describe, expect, it } from 'vitest'
import {
  commonNumber,
  commonValue,
  compareVersions,
  decodeColor,
  encodeColor,
  expressionSummary,
  usesLegacyColorScale,
} from '../values'

describe('commonNumber / commonValue', () => {
  it('returns the shared value or null when mixed', () => {
    expect(commonNumber([1, 1, 1])).toBe(1)
    expect(commonNumber([1, 1.0000001])).toBe(1)
    expect(commonNumber([1, 2])).toBeNull()
    expect(commonNumber([])).toBeNull()
    expect(commonNumber([1, undefined])).toBeNull()
    expect(commonNumber([Number.NaN])).toBeNull()
  })
  it('compares other values strictly', () => {
    expect(commonValue(['a', 'a'])).toBe('a')
    expect(commonValue([true, false])).toBeNull()
    expect(commonValue([])).toBeNull()
  })
})

describe('versions', () => {
  it('compares dotted versions', () => {
    expect(compareVersions('5.5.2', '4.1.9')).toBeGreaterThan(0)
    expect(compareVersions('4.1.9', '4.1.9')).toBe(0)
    expect(compareVersions('4.1', '4.1.9')).toBeLessThan(0)
    expect(compareVersions('4.10.0', '4.9.9')).toBeGreaterThan(0)
  })
  it('detects the legacy 0–255 color scale', () => {
    expect(usesLegacyColorScale('4.0.3')).toBe(true)
    expect(usesLegacyColorScale('4.1.9')).toBe(false)
    expect(usesLegacyColorScale('5.12.2')).toBe(false)
    // lottie-web treats a missing version as modern.
    expect(usesLegacyColorScale(undefined)).toBe(false)
    expect(usesLegacyColorScale('')).toBe(false)
  })
})

describe('expressionSummary', () => {
  it('skips bodymovin boilerplate', () => {
    const src = [
      'var $bm_rt;',
      'var amp, freq, decay, n, t, v;',
      'try {',
      "    amp = $bm_div(effect('Elastic')(1), 200);",
      '} catch (e$$4) {}',
    ].join('\n')
    expect(expressionSummary(src)).toBe("amp = $bm_div(effect('Elastic')(1), 200);")
  })
  it('keeps simple expressions and truncates long ones', () => {
    expect(expressionSummary('wiggle(2, 30)')).toBe('wiggle(2, 30)')
    expect(expressionSummary('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(expressionSummary('')).toBe('')
  })
})

describe('encodeColor / decodeColor', () => {
  it('writes channels that floor and round to the picked 8-bit value', () => {
    for (let n = 0; n <= 255; n++) {
      const [r] = encodeColor({ r: n / 255, g: 0, b: 0 }, 1, 3)
      expect(Math.floor(r * 255)).toBe(n)
      expect(Math.round(r * 255)).toBe(n)
    }
  })
  it('keeps arity and alpha', () => {
    expect(encodeColor({ r: 1, g: 0, b: 0 }, 0.5, 4)).toEqual([1, 0, 0, 0.5])
    expect(encodeColor({ r: 1, g: 0, b: 0 }, 0.5, 3)).toEqual([1, 0, 0])
  })
  it('uses the 0-255 scale of legacy files, alpha included', () => {
    expect(encodeColor({ r: 1, g: 128 / 255, b: 0 }, 1, 4, true)).toEqual([255, 128, 0, 255])
    // A dark legacy color is not mistaken for a 0..1 one.
    const dark = decodeColor([0, 0, 1, 255], true)
    expect(dark.b).toBeCloseTo(1 / 255)
    expect(dark.a).toBe(1)
    expect(decodeColor([0, 0, 1, 1]).b).toBe(1)
  })
})
