/**
 * GIF encoding core (no DOM): palette building, optional Floyd–Steinberg dithering, 1-bit
 * transparency with a matte color, and frame differencing. LZW compression is gifenc's.
 *
 * Runs inside the GIF worker, or on the main thread when workers are unavailable.
 *
 * - Palettes are built from opaque pixels only (gifenc's PnnQuant in rgb565 bins, which keeps
 *   flat colors exact); a transparent "key" entry is appended when frames need one.
 * - Opaque GIFs store only the pixels that changed since the previous frame (unchanged pixels
 *   become the transparent key, frames are not disposed). Flat vector animations shrink a lot.
 *   Frames without any change are merged into the previous frame's delay.
 * - Transparent GIFs keep full frames (disposed to the background before the next frame), since
 *   a transparent pixel cannot mean both "clear" and "unchanged".
 */
import { GIFEncoder, quantize, type GIFEncoderInstance, type GifPalette } from 'gifenc'

export interface GifCoreOptions {
  width: number
  height: number
  /** Palette size including the transparent entry when one is needed (2–256). */
  maxColors: number
  /** Floyd–Steinberg dithering. */
  dither: boolean
  /** Keep 1-bit transparency (pixels with alpha below `alphaThreshold` become transparent). */
  transparent: boolean
  /** 0–255. */
  alphaThreshold: number
  /** RGB (0–255) that partly transparent pixels are blended onto. */
  matte: [number, number, number]
  /** gifenc repeat: -1 plays once, 0 loops forever, n > 0 repeats n more times. */
  repeat: number
  /** Store only changed pixels (ignored for transparent GIFs). */
  optimize: boolean
}

/** Longest delay a GIF frame can store (centiseconds, 16 bits). */
const MAX_DELAY = 65535
/** Cache resolution for nearest-color lookups: 6 bits per channel. */
const CACHE_BITS = 6
const CACHE_SIZE = 1 << (CACHE_BITS * 3)

interface PendingFrame {
  index: Uint8Array
  /** Local color table (undefined: the global one). */
  palette: GifPalette | undefined
  delay: number
  transparentIndex: number
  dispose: number
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * Applies the transparency rules to RGBA pixels IN PLACE and returns the mask of transparent
 * pixels (null when every pixel is opaque). Opaque output never has partial alpha: partly
 * transparent pixels are blended onto `matte`.
 */
export function flattenAlpha(
  rgba: Uint8ClampedArray,
  transparent: boolean,
  threshold: number,
  matte: readonly [number, number, number],
): Uint8Array | null {
  const pixels = rgba.length >> 2
  let mask: Uint8Array | null = null
  const [mr, mg, mb] = matte
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const a = rgba[p + 3]
    if (a === 255) continue
    if (transparent && a < threshold) {
      mask ??= new Uint8Array(pixels)
      mask[i] = 1
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 0
      rgba[p + 3] = 0
      continue
    }
    const f = a / 255
    rgba[p] = rgba[p] * f + mr * (1 - f)
    rgba[p + 1] = rgba[p + 1] * f + mg * (1 - f)
    rgba[p + 2] = rgba[p + 2] * f + mb * (1 - f)
    rgba[p + 3] = 255
  }
  return mask
}

/** Copies the opaque pixels into a new buffer (gifenc reads whole ArrayBuffers). */
function opaquePixels(rgba: Uint8ClampedArray, mask: Uint8Array | null): Uint8Array {
  if (!mask && rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength) {
    return new Uint8Array(rgba.buffer)
  }
  const pixels = rgba.length >> 2
  let count = pixels
  if (mask) for (let i = 0; i < pixels; i++) count -= mask[i]
  const out = new Uint8Array(count * 4)
  for (let i = 0, o = 0; i < pixels; i++) {
    if (mask && mask[i]) continue
    const p = i * 4
    out[o] = rgba[p]
    out[o + 1] = rgba[p + 1]
    out[o + 2] = rgba[p + 2]
    out[o + 3] = 255
    o += 4
  }
  return out
}

/** Quantizes opaque pixels to at most `colors` RGB entries (at least one entry). */
export function buildPalette(pixels: Uint8Array, colors: number): GifPalette {
  if (pixels.length < 4) return [[0, 0, 0]]
  const palette = quantize(pixels, Math.max(1, Math.min(256, colors)), { format: 'rgb565' })
  return palette.length ? palette.map((c) => [c[0], c[1], c[2]]) : [[0, 0, 0]]
}

/**
 * Every `stride`-th pixel of an RGBA buffer, so palette samples from large frames stay small.
 * Returns a buffer that owns its memory.
 */
export function subsamplePixels(rgba: Uint8ClampedArray, maxPixels: number): Uint8ClampedArray {
  const pixels = rgba.length >> 2
  if (pixels <= maxPixels) return rgba.slice()
  const stride = Math.ceil(pixels / Math.max(1, maxPixels))
  const count = Math.ceil(pixels / stride)
  const out = new Uint8ClampedArray(count * 4)
  for (let i = 0, o = 0; i < pixels; i += stride, o += 4) {
    const p = i * 4
    out[o] = rgba[p]
    out[o + 1] = rgba[p + 1]
    out[o + 2] = rgba[p + 2]
    out[o + 3] = rgba[p + 3]
  }
  return out
}

/** Nearest palette entry (squared RGB distance) among the first `count` entries. */
function nearest(palette: GifPalette, count: number, r: number, g: number, b: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < count; i++) {
    const c = palette[i]
    const dr = c[0] - r
    let d = dr * dr
    if (d >= bestDist) continue
    const dg = c[1] - g
    d += dg * dg
    if (d >= bestDist) continue
    const db = c[2] - b
    d += db * db
    if (d < bestDist) {
      bestDist = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

/** Maps pixels to palette indices through a cache keyed by 6-bit channels. */
class ColorMapper {
  private readonly cache = new Int16Array(CACHE_SIZE)
  private palette: GifPalette = []
  private count = 0

  /** Switches palettes; the cache is kept when the palette is the same (global palettes). */
  setPalette(palette: GifPalette, count: number): void {
    if (palette === this.palette && count === this.count) return
    this.palette = palette
    this.count = count
    this.cache.fill(-1)
  }

  lookup(r: number, g: number, b: number): number {
    const shift = 8 - CACHE_BITS
    const key = ((r >> shift) << (CACHE_BITS * 2)) | ((g >> shift) << CACHE_BITS) | (b >> shift)
    let idx = this.cache[key]
    if (idx < 0) {
      idx = nearest(this.palette, this.count, r, g, b)
      this.cache[key] = idx
    }
    return idx
  }
}

export class GifCore {
  private readonly opts: GifCoreOptions
  private readonly gif: GIFEncoderInstance
  private readonly mapper = new ColorMapper()
  private readonly keyed: boolean
  private readonly contentColors: number
  private globalPalette: GifPalette | null = null
  private screen: Uint32Array | null = null
  private pending: PendingFrame | null = null
  private written = 0
  private added = 0
  private finished = false
  private errCurrent: Float32Array | null = null
  private errNext: Float32Array | null = null

  constructor(opts: GifCoreOptions) {
    const width = Math.max(1, Math.min(65535, Math.floor(opts.width)))
    const height = Math.max(1, Math.min(65535, Math.floor(opts.height)))
    this.opts = { ...opts, width, height, optimize: opts.optimize && !opts.transparent }
    this.keyed = this.opts.transparent || this.opts.optimize
    const max = Math.max(2, Math.min(256, Math.round(opts.maxColors)))
    this.contentColors = this.keyed ? max - 1 : max
    this.gif = GIFEncoder({ initialCapacity: Math.min(64 << 20, width * height + 4096) })
  }

  /** Number of frames added so far (merged frames included). */
  get frameCount(): number {
    return this.added
  }

  /** The palette from `useGlobalPalette`, for other encoders with the same options. */
  get sharedPalette(): GifPalette | null {
    return this.globalPalette
  }

  /** Uses a palette another encoder with the same options built (`sharedPalette`). */
  usePalette(palette: GifPalette): void {
    this.globalPalette = palette
  }

  /** Builds one palette for every frame from sample frames (RGBA, any pixel count). */
  useGlobalPalette(samples: readonly Uint8ClampedArray[]): void {
    const parts: Uint8Array[] = []
    let length = 0
    for (const sample of samples) {
      const copy = sample.slice()
      const mask = flattenAlpha(
        copy,
        this.opts.transparent,
        this.opts.alphaThreshold,
        this.opts.matte,
      )
      const opaque = opaquePixels(copy, mask)
      parts.push(opaque)
      length += opaque.length
    }
    const all = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      all.set(part, offset)
      offset += part.length
    }
    this.globalPalette = this.withKey(buildPalette(all, this.contentColors))
  }

  /** Adds a frame (RGBA of width × height, modified in place) shown for `delayCs` centiseconds. */
  addFrame(rgba: Uint8ClampedArray, delayCs: number): void {
    if (this.finished) throw new Error('GIF already finished')
    const { width, height } = this.opts
    if (rgba.length !== width * height * 4)
      throw new Error('Frame size does not match the GIF size')
    const delay = Math.max(1, Math.round(delayCs))
    const mask = flattenAlpha(
      rgba,
      this.opts.transparent,
      this.opts.alphaThreshold,
      this.opts.matte,
    )

    const local = this.globalPalette
      ? null
      : this.withKey(buildPalette(opaquePixels(rgba, mask), this.contentColors))
    const palette = this.globalPalette ?? local!
    const key = this.keyed ? palette.length - 1 : -1
    const colorCount = this.keyed ? palette.length - 1 : palette.length
    this.mapper.setPalette(palette, colorCount)

    const index = this.opts.dither
      ? this.mapDithered(rgba, mask, palette, colorCount, key)
      : this.mapNearest(rgba, mask, key)

    let changed = true
    if (this.opts.optimize) changed = this.diffAgainstScreen(index, palette, key)
    this.added++

    if (!changed && this.pending) {
      this.pending.delay = Math.min(MAX_DELAY, this.pending.delay + delay)
      return
    }
    this.flushPending()
    this.pending = {
      index,
      palette: local ?? undefined,
      delay,
      transparentIndex: key,
      dispose: this.opts.transparent ? 2 : this.opts.optimize ? 1 : 0,
    }
  }

  /** Writes the remaining frame and the trailer; returns the file bytes. */
  finish(): Uint8Array<ArrayBuffer> {
    if (!this.finished) {
      this.flushPending()
      if (this.written === 0) {
        // No frames at all: a valid 1-frame transparent GIF is better than a broken file.
        const size = this.opts.width * this.opts.height
        this.gif.writeFrame(new Uint8Array(size), this.opts.width, this.opts.height, {
          palette: [
            [0, 0, 0],
            [0, 0, 0],
          ],
          transparent: true,
          transparentIndex: 0,
          repeat: this.opts.repeat,
        })
      }
      this.gif.finish()
      this.finished = true
    }
    return this.gif.bytes()
  }

  /* ------------------------------------------------------------------------ */

  private withKey(palette: GifPalette): GifPalette {
    const content = palette.slice(0, this.contentColors)
    return this.keyed ? [...content, [0, 0, 0]] : content
  }

  private mapNearest(rgba: Uint8ClampedArray, mask: Uint8Array | null, key: number): Uint8Array {
    const pixels = rgba.length >> 2
    const out = new Uint8Array(pixels)
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
      out[i] = mask && mask[i] ? key : this.mapper.lookup(rgba[p], rgba[p + 1], rgba[p + 2])
    }
    return out
  }

  private mapDithered(
    rgba: Uint8ClampedArray,
    mask: Uint8Array | null,
    palette: GifPalette,
    colorCount: number,
    key: number,
  ): Uint8Array {
    const { width, height } = this.opts
    const out = new Uint8Array(width * height)
    const rowLength = (width + 2) * 3
    if (!this.errCurrent || this.errCurrent.length !== rowLength) {
      this.errCurrent = new Float32Array(rowLength)
      this.errNext = new Float32Array(rowLength)
    }
    let cur = this.errCurrent
    let next = this.errNext!
    cur.fill(0)
    for (let y = 0; y < height; y++) {
      next.fill(0)
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (mask && mask[i]) {
          // Error never crosses transparent pixels (edges would sparkle).
          out[i] = key
          continue
        }
        const p = i * 4
        const e = (x + 1) * 3
        const r = clampByte(rgba[p] + cur[e])
        const g = clampByte(rgba[p + 1] + cur[e + 1])
        const b = clampByte(rgba[p + 2] + cur[e + 2])
        const idx = colorCount > 0 ? this.mapper.lookup(r | 0, g | 0, b | 0) : 0
        out[i] = idx
        const c = palette[idx]
        const er = r - c[0]
        const eg = g - c[1]
        const eb = b - c[2]
        // Floyd–Steinberg: 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right.
        cur[e + 3] += er * 0.4375
        cur[e + 4] += eg * 0.4375
        cur[e + 5] += eb * 0.4375
        next[e - 3] += er * 0.1875
        next[e - 2] += eg * 0.1875
        next[e - 1] += eb * 0.1875
        next[e] += er * 0.3125
        next[e + 1] += eg * 0.3125
        next[e + 2] += eb * 0.3125
        next[e + 3] += er * 0.0625
        next[e + 4] += eg * 0.0625
        next[e + 5] += eb * 0.0625
      }
      const swap = cur
      cur = next
      next = swap
    }
    this.errCurrent = cur
    this.errNext = next
    return out
  }

  /**
   * Replaces pixels whose displayed color would not change by the transparent key and updates
   * the screen. Returns false when nothing changed.
   */
  private diffAgainstScreen(index: Uint8Array, palette: GifPalette, key: number): boolean {
    const packed = palette.map((c) => (c[0] << 16) | (c[1] << 8) | c[2])
    const first = this.screen === null
    const screen = (this.screen ??= new Uint32Array(index.length))
    let changed = first
    for (let i = 0; i < index.length; i++) {
      const color = packed[index[i]]
      if (!first && screen[i] === color) {
        index[i] = key
      } else {
        screen[i] = color
        changed = true
      }
    }
    return changed
  }

  private flushPending(): void {
    const frame = this.pending
    if (!frame) return
    this.pending = null
    const first = this.written === 0
    const palette = first ? (this.globalPalette ?? frame.palette) : frame.palette
    this.gif.writeFrame(frame.index, this.opts.width, this.opts.height, {
      palette,
      delay: frame.delay * 10,
      repeat: this.opts.repeat,
      transparent: frame.transparentIndex >= 0,
      transparentIndex: Math.max(0, frame.transparentIndex),
      dispose: frame.dispose,
    })
    this.written++
  }
}

/* -------------------------------------------------------------------------- */
/*                                Size sampling                               */
/* -------------------------------------------------------------------------- */

/** GIF sizes measured on sample frames. */
export interface GifSampleSizes {
  /** Average size of a GIF holding one sample frame (header, palette and trailer included). */
  first: number
  /** Average size one more frame adds after differencing against the frame before it. */
  next: number
}

/** A sample frame and, when there is one, the frame that follows it (RGBA of the GIF size). */
export type GifSamplePair = readonly [Uint8ClampedArray, Uint8ClampedArray | null]

/**
 * Encodes sample frames with the export's options to measure what a frame costs: a whole first
 * frame, and a following frame (unchanged pixels become transparent). With `globalPalette` one
 * palette is built from all samples and shared, as the export does. The samples are not changed.
 */
export function measureGifSamples(
  options: GifCoreOptions,
  pairs: readonly GifSamplePair[],
  delays: readonly [number, number],
  globalPalette: boolean,
): GifSampleSizes {
  if (pairs.length === 0) return { first: 0, next: 0 }
  let palette: GifPalette | null = null
  if (globalPalette) {
    const builder = new GifCore(options)
    builder.useGlobalPalette(pairs.flatMap(([a, b]) => (b ? [a, b] : [a])))
    palette = builder.sharedPalette
  }
  const encode = (frames: Uint8ClampedArray[]) => {
    const core = new GifCore(options)
    if (palette) core.usePalette(palette)
    frames.forEach((frame, k) => core.addFrame(frame.slice(), delays[k] ?? delays[0]))
    return core.finish().length
  }
  let first = 0
  let following = 0
  let followingCount = 0
  for (const [a, b] of pairs) {
    const one = encode([a])
    first += one
    if (b) {
      following += Math.max(0, encode([a, b]) - one)
      followingCount++
    }
  }
  const firstAverage = first / pairs.length
  return { first: firstAverage, next: followingCount ? following / followingCount : firstAverage }
}
