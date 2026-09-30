import { describe, expect, it } from 'vitest'
import { formatClockTime, formatDuration, formatFileSize, formatRelativeTime } from '../format'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)

describe('formatRelativeTime', () => {
  it('uses "just now" for the first minute', () => {
    expect(formatRelativeTime(NOW - 20_000, 'en', 'just now', NOW)).toBe('just now')
    expect(formatRelativeTime(NOW + 5000, 'en', 'just now', NOW)).toBe('just now')
  })

  it('formats minutes, hours and days in the UI language', () => {
    expect(formatRelativeTime(NOW - 3 * 60_000, 'en', 'just now', NOW)).toBe('3 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 60_000, 'ru', 'только что', NOW)).toBe('3 минуты назад')
    expect(formatRelativeTime(NOW - 2 * 3_600_000, 'en', 'just now', NOW)).toBe('2 hours ago')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, 'en', 'just now', NOW)).toBe('yesterday')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, 'ru', 'только что', NOW)).toBe('вчера')
    expect(formatRelativeTime(NOW - 15 * 86_400_000, 'en', 'just now', NOW)).toBe('2 weeks ago')
  })

  it('falls back to a date for old entries', () => {
    expect(formatRelativeTime(Date.UTC(2025, 0, 15, 12), 'en', 'just now', NOW)).toMatch(/2025/)
  })
})

describe('formatClockTime / formatDuration', () => {
  it('formats with the UI language', () => {
    expect(formatClockTime(NOW, 'ru')).toMatch(/^\d{1,2}:\d{2}$/)
    expect(formatDuration(90, 60, 'en')).toBe('1.5')
    expect(formatDuration(90, 60, 'ru')).toBe('1,5')
    expect(formatDuration(100, 30, 'en')).toBe('3.33')
    expect(formatDuration(10, 0, 'en')).toBe('0')
  })
})

describe('formatFileSize', () => {
  const en = { B: 'B', KB: 'KB', MB: 'MB', GB: 'GB' }
  const ru = { B: 'Б', KB: 'КБ', MB: 'МБ', GB: 'ГБ' }

  it('uses 1024-byte units with one decimal below 100', () => {
    expect(formatFileSize(0, 'en', en)).toBe('0 B')
    expect(formatFileSize(1023, 'en', en)).toBe('1023 B')
    expect(formatFileSize(3277, 'en', en)).toBe('3.2 KB')
    expect(formatFileSize(145_479, 'en', en)).toBe('142 KB')
    expect(formatFileSize(5 * 1024 * 1024, 'en', en)).toBe('5.0 MB')
    expect(formatFileSize(3 * 1024 ** 4, 'en', en)).toBe('3,072 GB')
  })

  it('localizes the separator and the units', () => {
    expect(formatFileSize(3277, 'ru', ru)).toBe('3,2 КБ')
    expect(formatFileSize(512, 'ru', ru)).toBe('512 Б')
    expect(formatFileSize(Number.NaN, 'ru', ru)).toBe('—')
  })
})
