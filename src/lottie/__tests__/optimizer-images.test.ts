/**
 * The image technique's decisions (target size, formats, transparency, keep-if-larger) with a
 * mocked OffscreenCanvas / createImageBitmap environment. Real encoding is covered by the
 * browser smoke test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageDisplayScales } from '../optimizer/techniques/images'
import type { Animation } from '../types'
import {
  doc,
  imageAsset,
  imageLayer,
  ks,
  p,
  precompAsset,
  precompLayer,
  PNG_2X2,
  resetInd,
  type J,
} from './fixtures/optimizer/builders'
import { runOnly } from './fixtures/optimizer/harness'

interface MockOptions {
  /** Pixel size of the decoded bitmap. */
  width: number
  height: number
  /** Any transparent pixel. */
  alpha: boolean
  /** Encoded sizes per MIME type (per pixel of the canvas); a missing type falls back to PNG. */
  bytesPerPixel: Record<string, number>
}

const encodes: { type: string; w: number; h: number; quality?: number }[] = []

function installMock(o: MockOptions): void {
  encodes.length = 0
  class MockCanvas {
    readonly width: number
    readonly height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
    getContext() {
      return {
        drawImage() {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255)
          if (o.alpha) data[3] = 0
          return { data }
        },
      }
    }
    convertToBlob({ type, quality }: { type: string; quality?: number }): Promise<Blob> {
      const actual = type in o.bytesPerPixel ? type : 'image/png'
      encodes.push({ type, w: this.width, h: this.height, quality })
      const size = Math.max(
        1,
        Math.round((o.bytesPerPixel[actual] ?? 1) * this.width * this.height),
      )
      return Promise.resolve(new Blob([new Uint8Array(size)], { type: actual }))
    }
  }
  vi.stubGlobal('OffscreenCanvas', MockCanvas)
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: o.width, height: o.height, close() {} }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A 200 KB "PNG": a real PNG header followed by padding (the mocked decoder ignores content). */
const BIG_PNG = (() => {
  const head = Uint8Array.from(atob(PNG_2X2.split(',')[1]), (c) => c.charCodeAt(0))
  const bytes = new Uint8Array(200_000)
  bytes.set(head)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(bin)}`
})()

/** A document showing a 1000×1000 image asset (declared 1000×1000) scaled to `scale` %. */
function imageDoc(scale: number, uri = PNG_2X2): Animation {
  resetInd()
  return doc([imageLayer('img', { ks: ks({ s: p([scale, scale, 100]) }) })], {
    assets: [imageAsset('img', uri, { w: 1000, h: 1000 })],
  })
}

const asset = (a: Animation) => (a.assets as unknown as J[]).find((x) => x.id === 'img')!

describe('images', () => {
  it('computes the largest display scale through precompositions', () => {
    resetInd()
    const d = doc(
      [
        precompLayer('c', { ks: ks({ s: p([200, 200, 100]) }) }),
        imageLayer('img', { ks: ks({ s: p([10, 10, 100]) }) }),
      ],
      {
        assets: [
          precompAsset('c', [imageLayer('img', { ind: 1, ks: ks({ s: p([50, 50, 100]) }) })]),
          imageAsset('img'),
        ],
      },
    )
    expect(imageDisplayScales(d as never).get('img')).toBeCloseTo(1)
  })

  it('downscales to the displayed size × maxScale and picks the smallest format', async () => {
    installMock({
      width: 1000,
      height: 1000,
      alpha: false,
      bytesPerPixel: { 'image/webp': 0.1, 'image/jpeg': 0.2 },
    })
    // Shown at 25 %: 250 px, × maxScale 2 → 500 px.
    const { animation, report } = await runOnly(imageDoc(25, BIG_PNG), ['images'], {
      image: { format: 'auto', quality: 0.9, maxScale: 2 },
    })
    const r = report.images[0]
    expect(r.action).toBe('downscaled')
    expect(r.after).toMatchObject({ mime: 'image/webp', width: 500, height: 500 })
    expect(asset(animation).p).toMatch(/^data:image\/webp;base64,/)
    // Display size never changes.
    expect(asset(animation).w).toBe(1000)
    expect(encodes.every((e) => e.quality === 0.9)).toBe(true)
    expect(report.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['webp', 'imagesDownscaled']),
    )
  })

  it('never uses JPEG for transparent images and keeps the original when nothing is smaller', async () => {
    installMock({
      width: 1000,
      height: 1000,
      alpha: true,
      bytesPerPixel: { 'image/jpeg': 0.000001 },
    })
    // WebP is not encodable here (falls back to PNG, rejected); JPEG is skipped for alpha.
    const { animation, report } = await runOnly(imageDoc(100), ['images'], {
      image: { format: 'auto', quality: 0.9, maxScale: 0 },
    })
    expect(encodes.map((e) => e.type)).toEqual(['image/webp'])
    expect(report.images[0].action).toBe('kept')
    expect(asset(animation).p).toBe(PNG_2X2)
  })

  it('skips SVG, animated and slot-bound images', async () => {
    installMock({ width: 10, height: 10, alpha: false, bytesPerPixel: { 'image/webp': 0.01 } })
    resetInd()
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+'
    const d = doc([imageLayer('a'), imageLayer('b')], {
      assets: [imageAsset('a', svg), imageAsset('b', PNG_2X2, { sid: 'logo' })],
    })
    const { report } = await runOnly(d, ['images'])
    expect(report.images.map((r) => [r.id, r.action, r.reason])).toEqual([
      ['a', 'skipped', 'svg'],
      ['b', 'skipped', 'slot'],
    ])
  })
})
