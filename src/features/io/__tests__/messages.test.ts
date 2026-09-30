import { describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { DotLottieError } from '@/lottie/dotlottie'
import { LottieFileError, readLottieBytes } from '@/lottie/formats'
import { FetchFileError } from '../fetchUrl'
import {
  describeOpenError,
  describeSaveError,
  describeWarning,
  summarizeOpen,
  translateRepair,
} from '../messages'
import { StorageError } from '../storage'

describe('describeOpenError', () => {
  it('explains JSON syntax errors with their position', () => {
    let error: unknown
    try {
      readLottieBytes(new TextEncoder().encode('{\n  "layers": [1,]\n}'), 'bad.json')
    } catch (e) {
      error = e
    }
    expect(describeOpenError(error, 'bad.json', en)).toEqual({
      title: 'Couldn’t open “bad.json”',
      lines: ['It isn’t valid JSON: unexpected “]” at line 2, column 16.'],
    })
    expect(describeOpenError(error, 'bad.json', ru).lines[0]).toBe(
      'Это некорректный JSON: неожиданный символ «]» (строка 2, столбец 16).',
    )
  })

  it('handles truncated files, line breaks and missing positions', () => {
    const end = new LottieFileError('invalid-json', 'x', { line: 12, column: 1, found: null })
    expect(describeOpenError(end, 'a.json', en).lines[0]).toBe(
      'It isn’t valid JSON: the file ends too early (line 12).',
    )
    const newline = new LottieFileError('invalid-json', 'x', { line: 3, column: 9, found: '\n' })
    expect(describeOpenError(newline, 'a.json', en).lines[0]).toContain(
      'unexpected line break at line 3',
    )
    expect(describeOpenError(new LottieFileError('invalid-json', 'x'), 'a.json', en).lines[0]).toBe(
      'It isn’t valid JSON.',
    )
  })

  it('adds a hint for JSON that is not an animation', () => {
    const e = new LottieFileError('not-lottie', 'x', { hint: 'dotlottie-manifest' })
    expect(describeOpenError(e, 'manifest.json', en).lines[0]).toBe(
      'This JSON isn’t a Lottie animation. It looks like the manifest of a .lottie file. Open the .lottie file itself.',
    )
  })

  it('covers every file error code in both languages', () => {
    const codes = [
      'empty',
      'corrupt-zip',
      'no-animation',
      'corrupt-gzip',
      'html',
      'image',
      'unsupported',
    ] as const
    for (const code of codes) {
      for (const t of [en, ru]) {
        const { lines } = describeOpenError(
          new LottieFileError(code, 'x', { detail: 'pdf' }),
          'f',
          t,
        )
        expect(lines[0].length).toBeGreaterThan(5)
      }
    }
    expect(
      describeOpenError(new LottieFileError('unsupported', 'x', { detail: 'pdf' }), 'f', en)
        .lines[0],
    ).toMatch(/^\.pdf files/)
  })

  it('explains download and storage failures', () => {
    expect(describeOpenError(new FetchFileError('network', 'x'), null, en)).toEqual({
      title: 'Couldn’t download the file',
      lines: [en.io.errors.network],
    })
    expect(
      describeOpenError(
        new FetchFileError('http', 'x', { status: 404, statusText: 'Not Found' }),
        null,
        en,
      ).lines[0],
    ).toBe('The server responded with 404 (Not Found).')
    expect(describeOpenError(new StorageError('quota', 'x'), 'a.json', en).lines[0]).toBe(
      en.io.errors.storageFull,
    )
    expect(describeOpenError(new Error('boom'), null, en)).toEqual({
      title: 'Couldn’t open the file',
      lines: [en.io.errors.unexpected],
    })
  })

  it('explains save failures', () => {
    expect(describeSaveError(new DotLottieError('v2-required', 'x'), en).lines[0]).toBe(
      en.io.errors.v2Required,
    )
    expect(describeSaveError(new StorageError('unavailable', 'x'), ru).lines[0]).toBe(
      ru.io.errors.storageUnavailable,
    )
  })

  it('never shows a raw (English) error message for unexpected save failures', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(describeSaveError(new RangeError('Invalid string length'), ru)).toEqual({
      title: ru.io.errors.saveFailed,
      lines: [ru.io.errors.saveUnexpected],
    })
    expect(quiet).toHaveBeenCalled()
  })
})

describe('warnings and repairs', () => {
  it('translates the repairs of normalizeAnimation', () => {
    expect(translateRepair('Invalid frame rate "0" replaced with 30.', ru)).toBe(
      'Некорректная частота кадров (0) заменена на 30 к/с.',
    )
    expect(translateRepair('Missing layers array created.', en)).toBe('Missing layer list created.')
    expect(translateRepair('Something new.', en)).toBe('Something new.')
  })

  it('keeps conveniences silent', () => {
    expect(describeWarning({ code: 'unwrapped', subject: 'data' }, en)).toBeNull()
    expect(describeWarning({ code: 'nested-folder', subject: 'x' }, en)).toBeNull()
    expect(describeWarning({ code: 'missing-asset', subject: 'image_0' }, en)).toBe(
      'Image “image_0” is missing from the file.',
    )
  })

  it('summarizes an open in one message', () => {
    expect(summarizeOpen([], [{ code: 'unwrapped' }], en)).toBeNull()
    expect(summarizeOpen(['Missing in point (ip) set to 0.'], [], en)).toEqual({
      title: 'Opened with 1 automatic repair',
      lines: ['Missing start frame set to 0.'],
    })
    const many = summarizeOpen(
      ['Invalid width replaced with 512.', 'Invalid height replaced with 512.'],
      [
        { code: 'missing-asset', subject: 'a' },
        { code: 'missing-asset', subject: 'b' },
        { code: 'missing-asset', subject: 'c' },
      ],
      en,
    )
    expect(many?.title).toBe('Opened with 2 repairs and 3 warnings')
    expect(many?.lines).toHaveLength(4)
    expect(many?.lines[3]).toBe('and 2 more')
    expect(summarizeOpen([], [{ code: 'salvaged' }, { code: 'salvaged' }], ru)?.title).toBe(
      'Открыт с 1 предупреждением',
    )
  })
})
