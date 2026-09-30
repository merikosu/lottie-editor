import { afterEach, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { setNumberLocale } from '@/lib/format'
import { readValue } from '../format'
import type { PropNode } from '../model'

const node = (k: unknown, meta: PropNode['meta']): PropNode => ({
  kind: 'property',
  id: 'p',
  path: ['layers', 0, 'ks', 'p'],
  label: 'Position',
  owner: ['layers', 0],
  prop: { a: 0, k } as PropNode['prop'],
  meta,
  textKeys: false,
})

afterEach(() => setNumberLocale('en'))

describe('value readouts', () => {
  it('formats vectors, units and colors', () => {
    const position = node([256.54, 150, 0], { value: 'number', unit: '', precision: 1 })
    expect(readValue(position, 0, en).text).toBe('256.5, 150')
    const opacity = node(62.4, { value: 'number', unit: '%', precision: 0 })
    expect(readValue(opacity, 0, en).text).toBe('62%')
    const color = node([1, 0.5, 0, 1], { value: 'color', unit: '', precision: 0 })
    expect(readValue(color, 0, en)).toEqual({ text: 'FF8000', swatch: '#FF8000' })
  })

  it('never shows negative zero', () => {
    const rotation = node(-0.01, { value: 'number', unit: '°', precision: 1 })
    expect(readValue(rotation, 0, en).text).toBe('0°')
  })

  it('uses the decimal comma and a semicolon between components in Russian', () => {
    setNumberLocale('ru')
    const position = node([256.54, -12.26, 0], { value: 'number', unit: '', precision: 1 })
    expect(readValue(position, 0, ru).text).toBe('256,5; -12,3')
    const scale = node([100, 100], { value: 'number', unit: '%', precision: 0 })
    expect(readValue(scale, 0, ru).text).toBe('100; 100%')
  })
})
