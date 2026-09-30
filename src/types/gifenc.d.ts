// Type declarations for gifenc@1.0.3 (the package ships no types).
// Written against node_modules/gifenc/src/{index,palettize,pnnquant2,stream}.js.
declare module 'gifenc' {
  /** One palette entry: [r, g, b] (rgb565 / rgb444) or [r, g, b, a] (rgba4444). Bytes 0..255. */
  export type GifColor = number[]
  /** Up to 256 colors. quantize() returns RGB triples, or RGBA quads when format === 'rgba4444'. */
  export type GifPalette = GifColor[]
  /** Pixel-binning format used by quantize() and applyPalette(). Default 'rgb565'. */
  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444'
  /**
   * RGBA8888 pixels. NOTE: gifenc reads `new Uint32Array(rgba.buffer)` - the WHOLE underlying
   * buffer, ignoring byteOffset/byteLength. Pass arrays that own their buffer (e.g. ImageData.data),
   * never a subarray view, and the buffer byteLength must be a multiple of 4.
   */
  export type GifRGBA = Uint8Array | Uint8ClampedArray

  export interface QuantizeOptions {
    /** Default 'rgb565'. Use 'rgba4444' to get alpha in the palette. */
    format?: GifColorFormat
    /** rgba4444 only: snap palette alpha to 0x00 / 0xff. `true` = threshold 127, or a number threshold. Default false. */
    oneBitAlpha?: boolean | number
    /** rgba4444 only: palette colors with alpha <= clearAlphaThreshold become clearAlphaColor with alpha 0. Default true. */
    clearAlpha?: boolean
    /** Default 0. */
    clearAlphaThreshold?: number
    /** Default 0x00 (the value written to r, g and b). */
    clearAlphaColor?: number
    /** Undocumented; default true (sqrt-weighting of bin counts, auto-disabled for few colors). */
    useSqrt?: boolean
  }

  export interface PrequantizeOptions {
    /** Rounding step for r/g/b. Default 5. */
    roundRGB?: number
    /** Rounding step for alpha. Default 10. */
    roundAlpha?: number
    /** Snap alpha to 0/255. `true` = threshold 127, or a number threshold. Default null. */
    oneBitAlpha?: boolean | number | null
  }

  /** Arguments are plain arrays like [r, g, b] or [r, g, b, a]. */
  export type GifDistanceFn = (a: ArrayLike<number>, b: ArrayLike<number>) => number

  export interface GIFEncoderOptions {
    /** Default true: header + logical screen descriptor + global palette are written with the first frame. */
    auto?: boolean
    /** Initial byte capacity of the growable output buffer. Default 4096. */
    initialCapacity?: number
  }

  export interface WriteFrameOptions {
    /** Required for the first frame (becomes the global color table); later frames get a local color table if given. */
    palette?: GifPalette
    /** Only used when auto === false: write logical screen descriptor + global palette (+ NETSCAPE loop ext). */
    first?: boolean
    /** Enable 1-bit transparency for this frame. Default false. */
    transparent?: boolean
    /** Palette index treated as transparent. Default 0. A negative value disables transparency. */
    transparentIndex?: number
    /** Frame delay in MILLISECONDS; stored as Math.round(delay / 10) centiseconds. Default 0. */
    delay?: number
    /** Only read on the first frame: -1 = play once (no NETSCAPE2.0 block), 0 = loop forever, n > 0 = n extra loops. Default 0. */
    repeat?: number
    /** Undocumented. Bits per primary color written into the logical screen descriptor. Default 8. */
    colorDepth?: number
    /** GIF disposal method 0-7. Default -1 = auto (2 "restore to background" when transparent, else 0). */
    dispose?: number
  }

  export interface GIFStream {
    readonly buffer: ArrayBuffer
    reset(): void
    /** No copy. */
    bytesView(): Uint8Array<ArrayBuffer>
    /** Copy. */
    bytes(): Uint8Array<ArrayBuffer>
    writeByte(byte: number): void
    writeBytes(data: ArrayLike<number>, offset?: number, byteLength?: number): void
    writeBytesView(data: Uint8Array, offset?: number, byteLength?: number): void
  }

  export interface GIFEncoderInstance {
    /** Rewinds the cursor to 0 (and, in auto mode, re-arms header writing). */
    reset(): void
    /** Writes the 0x3B trailer. Required before bytes(). */
    finish(): void
    /** Copy of the encoded bytes. */
    bytes(): Uint8Array<ArrayBuffer>
    /** View into the internal buffer (no copy; invalidated by further writes). */
    bytesView(): Uint8Array<ArrayBuffer>
    readonly buffer: ArrayBuffer
    readonly stream: GIFStream
    /** Writes "GIF89a". Only needed with { auto: false }. */
    writeHeader(): void
    /** `index` = one palette index per pixel (length width * height), e.g. from applyPalette(). */
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance
  export default GIFEncoder

  /** Pairwise-nearest-neighbour quantizer (PnnQuant port). Returns <= maxColors unique colors. */
  export function quantize(rgba: GifRGBA, maxColors: number, options?: QuantizeOptions): GifPalette
  /** Rounds colors IN PLACE to reduce the number of unique colors before quantize(). */
  export function prequantize(rgba: GifRGBA, options?: PrequantizeOptions): void
  /** Maps every pixel to its nearest palette index (euclidean RGB(A)), with a per-format cache. */
  export function applyPalette(
    rgba: GifRGBA,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array<ArrayBuffer>
  /** Index of the nearest color, or -1 for an empty list. */
  export function nearestColorIndex(
    colors: ArrayLike<ArrayLike<number>>,
    pixel: ArrayLike<number>,
    distanceFn?: GifDistanceFn,
  ): number
  /** [index, squaredDistance] */
  export function nearestColorIndexWithDistance(
    colors: ArrayLike<ArrayLike<number>>,
    pixel: ArrayLike<number>,
    distanceFn?: GifDistanceFn,
  ): [number, number]
  export function nearestColor<T extends ArrayLike<number>>(
    colors: ArrayLike<T>,
    pixel: ArrayLike<number>,
    distanceFn?: GifDistanceFn,
  ): T
  /** Mutates `palette`: replaces entries within `threshold` (default 5) of a known color by that exact color. */
  export function snapColorsToPalette(
    palette: GifPalette,
    knownColors: GifColor[],
    threshold?: number,
  ): void
}
