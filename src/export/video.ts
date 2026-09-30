/**
 * MP4 and WebM encoding with WebCodecs through mediabunny.
 *
 * Frames are rendered on the main thread into a canvas (lottie-web needs the DOM) and handed to
 * the browser's hardware or software encoder; awaiting `add()` applies the encoder's
 * backpressure, so memory stays flat for long videos. mediabunny is loaded on first use.
 *
 * Verified behaviour (export lab, Chrome 154 / Safari 26):
 * - H.264 and HEVC need even dimensions; VP9 accepts odd ones (we always use even sizes).
 * - Safari's H.264 encoder never finishes flushing in 'quality' latency mode (High profile);
 *   'realtime' works and, because every add() is awaited, drops no frames.
 * - VP9 alpha ('keep') is written as Matroska side data: it plays transparent in Chrome and
 *   Firefox; Safari plays the video on black.
 */
import type * as Mediabunny from 'mediabunny'
import type { Quality as QualityClass, VideoCodec } from 'mediabunny'
import { KEY_FRAME_INTERVAL_S } from './plan'

export type VideoContainer = 'mp4' | 'webm'
export type VideoQuality = 'low' | 'medium' | 'high'

/** Codecs to try, best supported first. */
export const CODEC_PREFERENCE: Record<VideoContainer, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
}

/**
 * Bits per pixel per frame of each quality level, for H.264. Calibrated on flat, sharp-edged
 * vector animation (the user's 60 fps sticker at 1080 × 1080): "high" shows no edge artifacts,
 * "low" is soft but clean. mediabunny's own presets are not used: its VP9 quantizer mode ignores
 * the level in Chrome (every level ~20 Mbit/s), and its bitrates ignore the frame rate.
 */
const BITS_PER_PIXEL: Record<VideoQuality, number> = { low: 0.035, medium: 0.06, high: 0.1 }

/** Bitrate needed relative to H.264 for the same quality. */
const CODEC_EFFICIENCY: Partial<Record<VideoCodec, number>> = {
  avc: 1,
  hevc: 0.75,
  vp9: 0.8,
  vp8: 1.2,
  av1: 0.6,
}

const MIN_BITRATE = 200_000
const MAX_BITRATE = 60_000_000

const atLeastOne = (v: number) => (Number.isFinite(v) && v > 1 ? v : 1)

/** Target bitrate (bits per second) for a codec, output size, frame rate and quality level. */
export function videoBitrate(
  codec: VideoCodec,
  width: number,
  height: number,
  fps: number,
  quality: VideoQuality,
): number {
  const pixelsPerSecond = atLeastOne(width) * atLeastOne(height) * atLeastOne(fps)
  const bits = pixelsPerSecond * BITS_PER_PIXEL[quality] * (CODEC_EFFICIENCY[codec] ?? 1)
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, bits)) / 1000) * 1000
}

/** Human names of the codecs we may pick. */
export const CODEC_NAMES: Partial<Record<VideoCodec, string>> = {
  avc: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
}

export type VideoSupportReason = 'no-webcodecs' | 'no-codec' | 'error'

export interface VideoSupport {
  codec: VideoCodec | null
  reason: VideoSupportReason | null
}

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

/** Safari (and every iOS browser): WebKit without Chromium. */
function isWebKit(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua)
}

function latencyFor(codec: VideoCodec): 'quality' | 'realtime' {
  return codec === 'avc' && isWebKit() ? 'realtime' : 'quality'
}

let mediabunny: Promise<typeof Mediabunny> | null = null
function loadMediabunny(): Promise<typeof Mediabunny> {
  mediabunny ??= import('mediabunny')
  return mediabunny
}

const supportCache = new Map<string, Promise<VideoSupport>>()

/**
 * The codec this browser can encode for a container at a size and frame rate (cached), or why
 * it cannot.
 */
export function detectVideoSupport(
  container: VideoContainer,
  opts: { width: number; height: number; fps: number },
): Promise<VideoSupport> {
  if (!hasWebCodecs()) return Promise.resolve({ codec: null, reason: 'no-webcodecs' })
  const key = `${container}:${opts.width}x${opts.height}@${Math.round(opts.fps * 1000)}`
  let pending = supportCache.get(key)
  if (!pending) {
    pending = (async (): Promise<VideoSupport> => {
      try {
        const { getFirstEncodableVideoCodec, Quality } = await loadMediabunny()
        const codec = await getFirstEncodableVideoCodec(CODEC_PREFERENCE[container], {
          width: opts.width,
          height: opts.height,
          frameRate: opts.fps,
          // Bitrate mode, as encoding uses: quantizer support must not decide availability.
          quality: new Quality({
            bitrate: videoBitrate('avc', opts.width, opts.height, opts.fps, 'high'),
          }),
        })
        return codec ? { codec, reason: null } : { codec: null, reason: 'no-codec' }
      } catch (err) {
        console.warn('Video support detection failed', err)
        return { codec: null, reason: 'error' }
      }
    })()
    supportCache.set(key, pending)
  }
  return pending
}

export interface EncodeVideoOptions {
  container: VideoContainer
  codec: VideoCodec
  /** Canvas that holds frame i after `renderFrame(i)` resolves (even width and height). */
  canvas: HTMLCanvasElement
  renderFrame: (index: number) => Promise<void>
  frameCount: number
  fps: number
  quality: VideoQuality
  /** Keep the alpha channel (WebM only). */
  transparent: boolean
  onFrame?: (done: number) => void
  /** Called once all frames are queued, while the encoder flushes. */
  onFinishing?: () => void
  /** Yields to the UI between frames when due. */
  yieldNow?: () => Promise<void>
  signal?: AbortSignal
}

export interface EncodedVideo {
  blob: Blob
  codec: VideoCodec
}

/** What decides the encoded stream. */
interface StreamSettings {
  container: VideoContainer
  codec: VideoCodec
  canvas: HTMLCanvasElement
  fps: number
  quality: VideoQuality
  transparent: boolean
}

/** A muxer and a canvas source: bitrate, key frames and alpha as every export uses them. */
async function openStream(o: StreamSettings) {
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat } =
    await loadMediabunny()
  const format = o.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
  const bitrate = videoBitrate(o.codec, o.canvas.width, o.canvas.height, o.fps, o.quality)
  const quality: QualityClass = new Quality({ bitrate, bitrateMode: 'variable' })
  const output = new Output({ format, target: new BufferTarget() })
  const transparent = o.transparent && o.container === 'webm'
  const source = new CanvasSource(o.canvas, {
    codec: o.codec,
    quality,
    alpha: transparent ? 'keep' : 'discard',
    // A key frame every 2 s keeps seeking snappy in players and editors.
    keyFrameInterval: KEY_FRAME_INTERVAL_S,
    latencyMode: latencyFor(o.codec),
  })
  output.addVideoTrack(source, { frameRate: o.fps, canBeTransparent: transparent })
  return { format, output, source }
}

export async function encodeVideo(o: EncodeVideoOptions): Promise<EncodedVideo> {
  o.signal?.throwIfAborted()
  const { format, output, source } = await openStream(o)
  try {
    await output.start()
    for (let i = 0; i < o.frameCount; i++) {
      o.signal?.throwIfAborted()
      await o.renderFrame(i)
      await source.add(i / o.fps, 1 / o.fps)
      o.onFrame?.(i + 1)
      await o.yieldNow?.()
    }
    o.signal?.throwIfAborted()
    o.onFinishing?.()
    source.close()
    await output.finalize()
  } catch (err) {
    // Closes the encoders and releases queued frames; safe in any state.
    await output.cancel().catch(() => undefined)
    throw err
  }
  const buffer = output.target.buffer
  if (!buffer) throw new Error('The video encoder produced no data')
  return { blob: new Blob([buffer], { type: format.mimeType }), codec: o.codec }
}
