import { describe, expect, it } from 'vitest'
import { documentExtension, renamedFileName, stemLength } from '../file-name'

describe('documentExtension', () => {
  it('finds the extensions the editor opens', () => {
    expect(documentExtension('intro.json')).toBe('.json')
    expect(documentExtension('sticker.TGS')).toBe('.TGS')
    expect(documentExtension('bundle.lottie')).toBe('.lottie')
    expect(documentExtension('export.zip')).toBe('.zip')
  })

  it('ignores other dots', () => {
    expect(documentExtension('logo.v2')).toBe('')
    expect(documentExtension('animation')).toBe('')
    expect(documentExtension('my.json.backup')).toBe('')
  })
})

describe('stemLength', () => {
  it('covers the name without its extension', () => {
    expect(stemLength('intro.json')).toBe(5)
    expect(stemLength('logo.v2.lottie')).toBe(7)
    expect(stemLength('animation')).toBe(9)
  })
})

describe('renamedFileName', () => {
  it('keeps the extension when only the name was typed', () => {
    expect(renamedFileName('intro.json', 'Logo reveal')).toBe('Logo reveal.json')
    expect(renamedFileName('bundle.lottie', 'hero')).toBe('hero.lottie')
    expect(renamedFileName('sticker.tgs', 'cat.v2')).toBe('cat.v2.tgs')
  })

  it('does not double or change the extension', () => {
    expect(renamedFileName('intro.json', 'outro.json')).toBe('outro.json')
    expect(renamedFileName('intro.json', 'outro.JSON')).toBe('outro.json')
    // Renaming does not convert: a JSON document stays .json.
    expect(renamedFileName('intro.json', 'outro.lottie')).toBe('outro.json')
  })

  it('trims whitespace', () => {
    expect(renamedFileName('intro.json', '  outro  ')).toBe('outro.json')
    expect(renamedFileName('intro.json', ' outro .json')).toBe('outro.json')
  })

  it('rejects empty names', () => {
    expect(renamedFileName('intro.json', '')).toBeNull()
    expect(renamedFileName('intro.json', '   ')).toBeNull()
    expect(renamedFileName('intro.json', '.json')).toBeNull()
  })

  it('leaves names without a known extension as typed', () => {
    expect(renamedFileName('animation', 'hero')).toBe('hero')
    expect(renamedFileName('animation', 'hero.json')).toBe('hero.json')
  })
})
