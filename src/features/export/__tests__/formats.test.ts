import { describe, expect, it } from 'vitest'
import bounceJson from '../../../samples/bounce.json?raw'
import type { Animation } from '@/lottie/types'
import {
  FORMAT_ORDER,
  defaultBaseName,
  exportKeepsDocument,
  formatExtension,
  joinFileName,
} from '../formats'
import { DEFAULT_PREFS, EXPORT_FORMATS, type ExportPrefs } from '../store'

const bounce = () => JSON.parse(bounceJson) as Animation
const prefs = (patch: Partial<ExportPrefs> = {}): ExportPrefs => ({ ...DEFAULT_PREFS, ...patch })

describe('export formats', () => {
  it('lists every format once, in the dialog order', () => {
    expect([...FORMAT_ORDER].sort()).toEqual([...EXPORT_FORMATS].sort())
    expect(new Set(FORMAT_ORDER).size).toBe(FORMAT_ORDER.length)
  })

  it('counts only faithful Lottie exports as saving the document', () => {
    const doc = bounce()
    expect(exportKeepsDocument('json', prefs(), doc)).toBe(true)
    expect(
      exportKeepsDocument(
        'json',
        prefs({ json: { ...DEFAULT_PREFS.json, stripNames: true } }),
        doc,
      ),
    ).toBe(false)
    expect(
      exportKeepsDocument('json', prefs({ json: { ...DEFAULT_PREFS.json, precision: '2' } }), doc),
    ).toBe(false)
    expect(
      exportKeepsDocument(
        'json',
        prefs({ json: { ...DEFAULT_PREFS.json, images: 'files', pretty: true } }),
        doc,
      ),
    ).toBe(true)
    expect(exportKeepsDocument('dotlottie', prefs(), doc)).toBe(true)
    // The bounce sample is 30 fps: the default sticker converts it to 60 fps.
    expect(exportKeepsDocument('tgs', prefs(), doc)).toBe(false)
    expect(
      exportKeepsDocument('tgs', prefs({ tgs: { ...DEFAULT_PREFS.tgs, fixFps: false } }), doc),
    ).toBe(true)
    for (const format of ['gif', 'mp4', 'webm', 'png', 'framePng', 'frameSvg'] as const) {
      expect(exportKeepsDocument(format, prefs(), doc), format).toBe(false)
    }
    // The embed download is the .json / .lottie the snippet loads; inline snippets download a page.
    expect(exportKeepsDocument('embed', prefs(), doc)).toBe(true)
    expect(
      exportKeepsDocument('embed', prefs({ embed: { ...DEFAULT_PREFS.embed, flavor: 'wc' } }), doc),
    ).toBe(true)
    expect(
      exportKeepsDocument('embed', prefs({ embed: { ...DEFAULT_PREFS.embed, inline: true } }), doc),
    ).toBe(false)
  })

  it('picks extensions from the options', () => {
    const doc = bounce()
    expect(formatExtension('json', prefs(), doc)).toBe('json')
    // "Images as files" only makes a zip when there are embedded images.
    expect(
      formatExtension('json', prefs({ json: { ...DEFAULT_PREFS.json, images: 'files' } }), doc),
    ).toBe('json')
    expect(
      formatExtension('embed', prefs({ embed: { ...DEFAULT_PREFS.embed, flavor: 'wc' } }), doc),
    ).toBe('lottie')
    expect(
      formatExtension('embed', prefs({ embed: { ...DEFAULT_PREFS.embed, inline: true } }), doc),
    ).toBe('html')
    expect(formatExtension('png', prefs(), doc)).toBe('zip')
  })

  it('suggests and cleans file names', () => {
    expect(defaultBaseName('gif', 'bounce.json', 0)).toBe('bounce')
    expect(defaultBaseName('png', 'Hero Loop.lottie', 0)).toBe('Hero Loop-frames')
    expect(defaultBaseName('framePng', 'a.json', 12.4)).toBe('a-frame-12')
    expect(joinFileName('  my file...  ', 'gif')).toBe('my file.gif')
    expect(joinFileName('', 'json')).toBe('animation.json')
    expect(joinFileName('a/b:c', 'json')).not.toMatch(/[/:]/)
  })
})
