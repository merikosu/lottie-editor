import { describe, expect, it } from 'vitest'
import { formatStorageSize, preferenceKeys } from '../storage'

function fakeStorage(keys: string[]): Pick<Storage, 'length' | 'key'> {
  return { length: keys.length, key: (i: number) => keys[i] ?? null }
}

describe('preferenceKeys', () => {
  it('selects editor preferences and panel layouts only (not saved-session state)', () => {
    const storage = fakeStorage([
      'lottie-editor:prefs',
      'lottie-editor:timeline',
      'lottie-editor:palette',
      'lottie-editor:layer-locks',
      'react-resizable-panels:le-layout-h',
      'react-resizable-panels:le-layout-v:left:center',
      'react-resizable-panels:other-app',
      'some-other-site-key',
      'lottie-editorX',
    ])
    expect(preferenceKeys(storage)).toEqual([
      'lottie-editor:prefs',
      'lottie-editor:timeline',
      'lottie-editor:palette',
      'react-resizable-panels:le-layout-h',
      'react-resizable-panels:le-layout-v:left:center',
    ])
  })

  it('handles an empty storage', () => {
    expect(preferenceKeys(fakeStorage([]))).toEqual([])
  })
})

describe('formatStorageSize', () => {
  const en = ['B', 'KB', 'MB', 'GB']
  const ru = ['Б', 'КБ', 'МБ', 'ГБ']

  it('uses binary units with one decimal below 100', () => {
    expect(formatStorageSize(512, 'en', en)).toBe('512 B')
    expect(formatStorageSize(80 * 1024, 'en', en)).toBe('80 KB')
    expect(formatStorageSize(3.62 * 1024, 'en', en)).toBe('3.6 KB')
    expect(formatStorageSize(150.4 * 1024 * 1024, 'en', en)).toBe('150 MB')
    expect(formatStorageSize(5 * 1024 ** 4, 'en', en)).toBe('5,120 GB')
  })

  it('follows the language for the decimal separator', () => {
    expect(formatStorageSize(3.62 * 1024, 'ru', ru)).toBe('3,6 КБ')
  })

  it('treats negative sizes as empty', () => {
    expect(formatStorageSize(-5, 'en', en)).toBe('0 B')
  })
})
