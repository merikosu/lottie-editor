import { describe, expect, it } from 'vitest'
import {
  GifCore,
  flattenAlpha,
  measureGifSamples,
  subsamplePixels,
  type GifCoreOptions,
} from '../gif-core'
import { compositeFrames, decodeGif } from './gif-decode'

const W = 16
const H = 8

type RGBA = [number, number, number, number]

function frame(fill: (x: number, y: number) => RGBA, w = W, h = H): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.set(fill(x, y), (y * w + x) * 4)
  }
  return out
}

const solid = (c: RGBA) => frame(() => c)

function options(patch: Partial<GifCoreOptions> = {}): GifCoreOptions {
  return {
    width: W,
    height: H,
    maxColors: 256,
    dither: false,
    transparent: false,
    alphaThreshold: 128,
    matte: [255, 255, 255],
    repeat: 0,
    optimize: false,
    ...patch,
  }
}

function pixel(rgba: Uint8ClampedArray, x: number, y: number, w = W): number[] {
  const p = (y * w + x) * 4
  return Array.from(rgba.subarray(p, p + 4))
}

function encode(
  frames: Uint8ClampedArray[],
  patch: Partial<GifCoreOptions> = {},
  delays: number[] = [],
) {
  const core = new GifCore(options(patch))
  frames.forEach((f, i) => core.addFrame(f.slice(), delays[i] ?? 4))
  const gif = decodeGif(core.finish())
  return { gif, screens: compositeFrames(gif), core }
}

describe('GifCore: opaque frames', () => {
  it('writes a valid GIF with exact flat colors', () => {
    const red: RGBA = [229, 51, 62, 255]
    const blue: RGBA = [52, 112, 232, 255]
    const { gif, screens } = encode([solid(red), frame((x) => (x < 8 ? red : blue))], {}, [3, 4])
    expect(gif.width).toBe(W)
    expect(gif.height).toBe(H)
    expect(gif.frames).toHaveLength(2)
    expect(gif.frames.map((f) => f.delay)).toEqual([3, 4])
    expect(gif.loopCount).toBe(0)
    expect(pixel(screens[0], 3, 3)).toEqual(red)
    expect(pixel(screens[1], 3, 3)).toEqual(red)
    expect(pixel(screens[1], 12, 3)).toEqual(blue)
  })

  it('writes the loop count', () => {
    expect(encode([solid([0, 0, 0, 255])], { repeat: -1 }).gif.loopCount).toBeNull()
    expect(encode([solid([0, 0, 0, 255])], { repeat: 2 }).gif.loopCount).toBe(2)
  })

  it('respects the palette size', () => {
    const noise = frame((x, y) => [
      (x * 37 + y * 91) % 256,
      (x * 13 + y * 7) % 256,
      (x * y * 11) % 256,
      255,
    ])
    const { gif } = encode([noise], { maxColors: 32 })
    expect(gif.globalPalette!.length).toBeLessThanOrEqual(32)
    const used = new Set(gif.frames[0].indices)
    expect(used.size).toBeLessThanOrEqual(32)
  })

  it('blends partly transparent pixels onto the matte color', () => {
    const { screens } = encode([solid([0, 0, 0, 128])], { matte: [255, 255, 255] })
    const [r, g, b, a] = pixel(screens[0], 0, 0)
    expect(a).toBe(255)
    expect(r).toBeGreaterThan(120)
    expect(r).toBeLessThan(135)
    expect(g).toBe(r)
    expect(b).toBe(r)
  })

  it('uses local palettes per frame when there is no global palette', () => {
    const { gif, screens } = encode([solid([255, 0, 0, 255]), solid([0, 255, 0, 255])])
    expect(gif.frames[1].localPalette).not.toBeNull()
    expect(pixel(screens[1], 5, 5)).toEqual([0, 255, 0, 255])
  })

  it('uses one global palette when given samples', () => {
    const a = solid([255, 0, 0, 255])
    const b = solid([0, 0, 255, 255])
    const core = new GifCore(options())
    core.useGlobalPalette([a, b])
    core.addFrame(a.slice(), 4)
    core.addFrame(b.slice(), 4)
    const gif = decodeGif(core.finish())
    expect(gif.frames.every((f) => f.localPalette === null)).toBe(true)
    const screens = compositeFrames(gif)
    expect(pixel(screens[0], 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(screens[1], 0, 0)).toEqual([0, 0, 255, 255])
  })
})

describe('GifCore: frame differencing', () => {
  const bg: RGBA = [20, 20, 20, 255]
  const dot: RGBA = [250, 200, 10, 255]
  const withDot = (px: number) => frame((x, y) => (x === px && y === 2 ? dot : bg))

  it('stores only changed pixels and shows the same images', () => {
    const frames = [withDot(1), withDot(2), withDot(3)]
    const { gif, screens } = encode(frames, { optimize: true })
    expect(gif.frames).toHaveLength(3)
    const f2 = gif.frames[1]
    expect(f2.disposal).toBe(1)
    const stored = Array.from(f2.indices).filter((i) => i !== f2.transparentIndex).length
    expect(stored).toBe(2) // the old dot is cleared, the new one drawn
    frames.forEach((f, i) => expect(screens[i]).toEqual(f))
  })

  it('merges frames without changes into the previous delay', () => {
    const { gif, screens } = encode(
      [withDot(1), withDot(1), withDot(1), withDot(4)],
      { optimize: true },
      [3, 4, 3, 3],
    )
    expect(gif.frames.map((f) => f.delay)).toEqual([10, 3])
    expect(screens[1]).toEqual(withDot(4))
  })

  it('works with per-frame palettes', () => {
    const frames = [
      solid([255, 0, 0, 255]),
      frame((x) => (x < 4 ? [0, 255, 0, 255] : [255, 0, 0, 255])),
    ]
    const { screens } = encode(frames, { optimize: true })
    expect(screens[1]).toEqual(frames[1])
  })

  it('is not used for transparent GIFs', () => {
    const f = frame((x) => (x < 8 ? [0, 0, 0, 0] : [10, 20, 30, 255]))
    const { gif } = encode([f, f.slice()], { optimize: true, transparent: true })
    expect(gif.frames).toHaveLength(2)
    expect(gif.frames[1].disposal).toBe(2)
  })
})

describe('GifCore: transparency', () => {
  it('keeps 1-bit alpha with a threshold and a matte', () => {
    const f = frame((x) => {
      if (x < 4) return [0, 0, 0, 0]
      if (x < 8) return [255, 0, 0, 100] // below the threshold
      if (x < 12) return [0, 0, 0, 200] // blended with the matte
      return [0, 0, 255, 255]
    })
    const { gif, screens } = encode([f], {
      transparent: true,
      alphaThreshold: 128,
      matte: [255, 255, 255],
    })
    const fr = gif.frames[0]
    expect(fr.transparentIndex).toBeGreaterThanOrEqual(0)
    expect(fr.disposal).toBe(2)
    expect(pixel(screens[0], 1, 1)[3]).toBe(0)
    expect(pixel(screens[0], 5, 1)[3]).toBe(0)
    const blended = pixel(screens[0], 9, 1)
    expect(blended[3]).toBe(255)
    expect(blended[0]).toBeGreaterThan(40)
    expect(blended[0]).toBeLessThan(60)
    expect(pixel(screens[0], 14, 1)).toEqual([0, 0, 255, 255])
  })

  it('clears transparent pixels between frames', () => {
    const a = frame((x) => (x < 8 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    const b = frame((x) => (x < 8 ? [0, 0, 0, 0] : [255, 0, 0, 255]))
    const { screens } = encode([a, b], { transparent: true })
    expect(pixel(screens[1], 2, 2)[3]).toBe(0)
    expect(pixel(screens[1], 12, 2)).toEqual([255, 0, 0, 255])
  })

  it('handles fully transparent frames', () => {
    const { gif, screens } = encode([solid([0, 0, 0, 0])], { transparent: true })
    expect(gif.frames).toHaveLength(1)
    expect(pixel(screens[0], 0, 0)[3]).toBe(0)
  })

  it('flattenAlpha reports the transparent mask', () => {
    const px = new Uint8ClampedArray([10, 10, 10, 0, 10, 10, 10, 255, 0, 0, 0, 64])
    const mask = flattenAlpha(px, true, 32, [255, 255, 255])
    expect(Array.from(mask!)).toEqual([1, 0, 0])
    expect(px[11]).toBe(255)
    expect(flattenAlpha(new Uint8ClampedArray([1, 2, 3, 255]), true, 128, [0, 0, 0])).toBeNull()
  })
})

describe('GifCore: dithering', () => {
  it('approximates gradients better than nearest-color mapping', () => {
    const w = 64
    const h = 16
    const gradient = frame(
      (x) => [
        Math.round((x / (w - 1)) * 255),
        Math.round((x / (w - 1)) * 255),
        Math.round((x / (w - 1)) * 255),
        255,
      ],
      w,
      h,
    )
    const columnError = (dither: boolean) => {
      const core = new GifCore(options({ width: w, height: h, maxColors: 2, dither }))
      core.useGlobalPalette([frame((x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]), w, h)])
      core.addFrame(gradient.slice(), 4)
      const [screen] = compositeFrames(decodeGif(core.finish()))
      let error = 0
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let y = 0; y < h; y++) sum += screen[(y * w + x) * 4]
        error += Math.abs(sum / h - gradient[x * 4])
      }
      return error / w
    }
    expect(columnError(true)).toBeLessThan(columnError(false) / 2)
  })
})

describe('GifCore: edge cases', () => {
  it('writes a valid file without frames', () => {
    const gif = decodeGif(new GifCore(options()).finish())
    expect(gif.frames).toHaveLength(1)
  })

  it('rejects frames of the wrong size', () => {
    const core = new GifCore(options())
    expect(() => core.addFrame(new Uint8ClampedArray(8), 4)).toThrow()
  })

  it('subsamples large frames for palettes', () => {
    const big = new Uint8ClampedArray(1000 * 4).fill(7)
    const small = subsamplePixels(big, 100)
    expect(small.length / 4).toBeLessThanOrEqual(100)
    expect(small.length % 4).toBe(0)
    expect(subsamplePixels(big, 5000)).not.toBe(big)
  })
})

describe('measureGifSamples', () => {
  const bg: RGBA = [20, 20, 20, 255]
  const withDot = (px: number) => frame((x, y) => (x === px && y === 2 ? [250, 200, 10, 255] : bg))

  it('measures a whole frame and a cheap differenced frame', () => {
    const pairs = [
      [withDot(1), withDot(2)],
      [withDot(5), withDot(6)],
    ] as const
    const sizes = measureGifSamples(options({ optimize: true }), pairs, [3, 4], true)
    const single = encode([withDot(1)], { optimize: true }).core.finish().length
    expect(sizes.first).toBeGreaterThan(0)
    expect(Math.abs(sizes.first - single)).toBeLessThan(64)
    expect(sizes.next).toBeGreaterThan(0)
    expect(sizes.next).toBeLessThan(sizes.first)
  })

  it('agrees with a real encode of the sampled frames', () => {
    const frames = [withDot(1), withDot(2), withDot(3), withDot(4)]
    const sizes = measureGifSamples(
      options({ optimize: true }),
      [[frames[0], frames[1]]],
      [4, 4],
      false,
    )
    const real = encode(frames, { optimize: true }).core.finish().length
    const predicted = sizes.first + sizes.next * (frames.length - 1)
    expect(Math.abs(predicted - real) / real).toBeLessThan(0.2)
  })

  it('uses the first size for samples without a following frame', () => {
    const sizes = measureGifSamples(options(), [[withDot(1), null]], [4, 4], true)
    expect(sizes.next).toBe(sizes.first)
    expect(measureGifSamples(options(), [], [4, 4], true)).toEqual({ first: 0, next: 0 })
  })

  it('leaves the samples untouched', () => {
    const a = frame(() => [0, 0, 0, 100])
    const copy = a.slice()
    measureGifSamples(
      options({ transparent: true, alphaThreshold: 128 }),
      [[a, null]],
      [4, 4],
      true,
    )
    expect(a).toEqual(copy)
  })

  it('shares one palette between encoders', () => {
    const core = new GifCore(options())
    expect(core.sharedPalette).toBeNull()
    core.useGlobalPalette([solid([255, 0, 0, 255])])
    const other = new GifCore(options())
    other.usePalette(core.sharedPalette!)
    other.addFrame(solid([255, 0, 0, 255]), 4)
    const gif = decodeGif(other.finish())
    expect(gif.frames[0].localPalette).toBeNull()
    expect(pixel(compositeFrames(gif)[0], 0, 0)).toEqual([255, 0, 0, 255])
  })
})
