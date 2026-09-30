import { describe, expect, it } from 'vitest'
import { createFormatter } from '../format'

const en = createFormatter('en', ['B', 'KB', 'MB', 'GB'])
const ru = createFormatter('ru', ['Б', 'КБ', 'МБ', 'ГБ'])

describe('export number formatting', () => {
  it('uses the language decimal separator and drops trailing zeros', () => {
    expect(en.decimal(2.98)).toBe('2.98')
    expect(ru.decimal(2.98)).toBe('2,98')
    expect(ru.decimal(29.97)).toBe('29,97')
    expect(en.decimal(30)).toBe('30')
    expect(en.decimal(2.9833333)).toBe('2.98')
    expect(en.decimal(12345.5, 1)).toBe('12345.5')
    expect(en.decimal(Number.NaN)).toBe('—')
  })

  it('formats file sizes with 1024-based units', () => {
    expect(en.size(807)).toBe('807 B')
    expect(en.size(24_281)).toBe('23.7 KB')
    expect(ru.size(24_281)).toBe('23,7 КБ')
    expect(en.size(64 * 1024, 0)).toBe('64 KB')
    expect(en.size(150 * 1024)).toBe('150 KB')
    expect(ru.size(8.2 * 1024 * 1024)).toBe('8,2 МБ')
    expect(en.size(-1)).toBe('—')
  })

  it('formats percentages', () => {
    expect(en.percent(0.045)).toBe('4.5%')
    expect(ru.percent(0.045)).toBe('4,5 %')
    expect(en.percent(0.38)).toBe('38%')
    expect(en.percent(0)).toBe('0%')
  })
})
