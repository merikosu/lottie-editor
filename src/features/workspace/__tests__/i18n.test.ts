import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/workspace'
import ru from '@/i18n/locales/ru/workspace'

/** Paths of empty string values in a dictionary. */
function emptyStrings(node: unknown, path: string): string[] {
  if (typeof node === 'string') return node.trim() ? [] : [path]
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => emptyStrings(v, `${path}.${k}`))
  }
  return []
}

describe('workspace strings', () => {
  it('pluralizes in English', () => {
    expect(en.palette.moreLayers(1)).toBe('1 more layer')
    expect(en.palette.moreLayers(8)).toBe('8 more layers')
    expect(en.history.steps(0)).toBe('0 changes')
    expect(en.history.steps(1)).toBe('1 change')
  })

  it('pluralizes in Russian', () => {
    expect(ru.palette.moreLayers(1)).toBe('Ещё 1 слой')
    expect(ru.palette.moreLayers(3)).toBe('Ещё 3 слоя')
    expect(ru.palette.moreLayers(11)).toBe('Ещё 11 слоёв')
    expect(ru.history.steps(21)).toBe('21 изменение')
    expect(ru.history.steps(24)).toBe('24 изменения')
    expect(ru.history.steps(0)).toBe('0 изменений')
  })

  it('interpolates values', () => {
    expect(en.palette.goToFrame('42')).toBe('Go to frame 42')
    expect(ru.palette.goToFrame('42')).toBe('Перейти к кадру 42')
    expect(ru.palette.empty('abc')).toBe('По запросу «abc» ничего не найдено')
    expect(en.about.version('1.2.3')).toBe('Version 1.2.3')
  })

  it('has no empty strings', () => {
    expect(emptyStrings(en, 'en')).toEqual([])
    expect(emptyStrings(ru, 'ru')).toEqual([])
  })
})
