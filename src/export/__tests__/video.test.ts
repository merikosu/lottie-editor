import { describe, expect, it } from 'vitest'
import { CODEC_NAMES, CODEC_PREFERENCE, videoBitrate, type VideoQuality } from '../video'

const vp9At = (q: VideoQuality) => videoBitrate('vp9', 1920, 1080, 30, q)

describe('videoBitrate', () => {
  it('scales with pixels and frame rate', () => {
    const base = videoBitrate('avc', 1080, 1080, 30, 'high')
    expect(videoBitrate('avc', 1080, 1080, 60, 'high')).toBeCloseTo(base * 2, -4)
    expect(videoBitrate('avc', 2160, 2160, 30, 'high')).toBeCloseTo(base * 4, -4)
  })

  it('orders the quality levels', () => {
    expect(vp9At('low')).toBeLessThan(vp9At('medium'))
    expect(vp9At('medium')).toBeLessThan(vp9At('high'))
  })

  it('gives efficient codecs fewer bits', () => {
    expect(videoBitrate('vp9', 1080, 1080, 60, 'high')).toBeLessThan(
      videoBitrate('avc', 1080, 1080, 60, 'high'),
    )
    expect(videoBitrate('av1', 1080, 1080, 60, 'high')).toBeLessThan(
      videoBitrate('vp9', 1080, 1080, 60, 'high'),
    )
    expect(videoBitrate('vp8', 1080, 1080, 60, 'high')).toBeGreaterThan(
      videoBitrate('avc', 1080, 1080, 60, 'high'),
    )
  })

  it('matches the calibrated reference (60 fps sticker at 1080 × 1080)', () => {
    // ~7 Mbit/s H.264 and ~5.6 Mbit/s VP9 showed no edge artifacts on the reference clip.
    expect(videoBitrate('avc', 1080, 1080, 60, 'high')).toBe(6_998_000)
    expect(videoBitrate('vp9', 1080, 1080, 60, 'high')).toBe(5_599_000)
  })

  it('stays within sane limits and returns whole kilobits', () => {
    expect(videoBitrate('avc', 2, 2, 1, 'low')).toBe(200_000)
    expect(videoBitrate('avc', 8192, 8192, 60, 'high')).toBe(60_000_000)
    expect(videoBitrate('hevc', 0, -5, Number.NaN, 'medium')).toBe(200_000)
    expect(videoBitrate('vp9', 1280, 720, 24, 'medium') % 1000).toBe(0)
  })

  it('names every preferred codec', () => {
    for (const codec of [...CODEC_PREFERENCE.mp4, ...CODEC_PREFERENCE.webm])
      expect(CODEC_NAMES[codec]).toBeTruthy()
  })
})
